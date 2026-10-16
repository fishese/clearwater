import AVFoundation
import CoreImage
import CoreVideo
import Foundation

/// Single-owner real-time writer. Calls may arrive from capture callbacks; all
/// AVAssetWriter state and append operations are serialized on this object's queue.
final class ClearWaterMovieWriter {
    enum QualityProfile: Equatable {
        case standard, high
        var maximumLongSide: CGFloat { self == .high ? 1920 : 1280 }
        var maximumShortSide: CGFloat { self == .high ? 1080 : 720 }
        var videoBitRate: Int { self == .high ? 12_000_000 : 5_000_000 }
        var audioBitRate: Int { self == .high ? 192_000 : 128_000 }
        var fps: Int { 30 }
        func outputSize(for source: CGSize) -> CGSize {
            let long = max(source.width, source.height), short = min(source.width, source.height)
            guard long > 0, short > 0 else { return .zero }
            let scale = min(1, min(maximumLongSide/long, maximumShortSide/short))
            func even(_ value: CGFloat) -> CGFloat { max(2, floor(value*scale/2)*2) }
            return CGSize(width: even(source.width), height: even(source.height))
        }
    }

    enum FrameResult: Equatable { case appended, droppedBackpressure, limitReached(String) }
    enum AudioResult: Equatable { case appended, ignoredLate, limitReached(String) }
    struct Metadata {
        let width: Int; let height: Int; let duration: Double; let bytes: Int64
        let codec: String; let nominalFrameRate: Double; let frameCount: Int
        let stopReason: String?
    }
    enum WriterError: Error {
        case invalidConfiguration, startFailed, notWriting, zeroFrames, invalidTimestamp
        case nonMonotonicTimestamp, videoAppendFailed, audioAppendFailed, audioBackpressure
        case audioUnavailable, allocationFailed, durationLimit, byteLimit, cancelled
        case writerFailed(String), invalidOutput
    }

    let outputURL: URL
    let profile: QualityProfile
    let size: CGSize
    let recipe: NativeBalancedRecipe

    private let maximumDuration: Double
    private let maximumBytes: Int64
    private let processor: ClearWaterBalancedProcessor
    private let writer: AVAssetWriter
    private let videoInput: AVAssetWriterInput
    private let adaptor: AVAssetWriterInputPixelBufferAdaptor
    private let audioInput: AVAssetWriterInput?
    private let queue = DispatchQueue(label: "clearwater.movie-writer", qos: .userInitiated)
    private let queueKey = DispatchSpecificKey<UInt8>()
    private var state: State = .configured
    private enum State { case configured, writing, finishing, finished(Result<Metadata, Error>), cancelled, failed(Error) }
    private var firstVideoPTS: CMTime?
    private var lastVideoPTS: CMTime?
    private var lastAudioPTS: CMTime?
    private var queuedAudio: [CMSampleBuffer] = []
    private var frameCount = 0
    private var consecutiveDrops = 0
    private var stopReason: String?
    private var finishCallbacks: [(Result<Metadata, Error>) -> Void] = []
    private var didStartSession = false

    init(outputURL: URL, sourceSize: CGSize, profile: QualityProfile, audioEnabled: Bool,
         recipe: NativeBalancedRecipe, processor: ClearWaterBalancedProcessor,
         maximumDuration: Double = 300, maximumBytes: Int64 = 500 * 1024 * 1024) throws {
        let size = profile.outputSize(for: sourceSize)
        guard recipe.version == 1, recipe.engine == "balanced", maximumDuration > 0,
              maximumBytes > 0, size.width >= 2, size.height >= 2 else { throw WriterError.invalidConfiguration }
        self.outputURL = outputURL; self.profile = profile; self.size = size; self.recipe = recipe
        self.maximumDuration = min(maximumDuration, 600); self.maximumBytes = min(maximumBytes, 500 * 1024 * 1024)
        self.processor = processor
        guard !FileManager.default.fileExists(atPath: outputURL.path) else { throw WriterError.invalidConfiguration }
        let newWriter: AVAssetWriter
        do { newWriter = try AVAssetWriter(outputURL: outputURL, fileType: .mp4) }
        catch { throw WriterError.startFailed }
        let width = Int(size.width), height = Int(size.height)
        let compression: [String: Any] = [AVVideoAverageBitRateKey: profile.videoBitRate,
            AVVideoExpectedSourceFrameRateKey: profile.fps, AVVideoMaxKeyFrameIntervalKey: profile.fps * 2,
            AVVideoProfileLevelKey: profile == .high ? AVVideoProfileLevelH264HighAutoLevel : AVVideoProfileLevelH264MainAutoLevel]
        let newVideoInput = AVAssetWriterInput(mediaType: .video, outputSettings: [AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: width, AVVideoHeightKey: height, AVVideoCompressionPropertiesKey: compression])
        newVideoInput.expectsMediaDataInRealTime = true
        guard newWriter.canAdd(newVideoInput) else { throw WriterError.invalidConfiguration }
        newWriter.add(newVideoInput)
        let attributes: [String: Any] = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: width, kCVPixelBufferHeightKey as String: height,
            kCVPixelBufferIOSurfacePropertiesKey as String: [:], kCVPixelBufferMetalCompatibilityKey as String: true]
        let newAdaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: newVideoInput, sourcePixelBufferAttributes: attributes)
        let newAudioInput: AVAssetWriterInput?
        if audioEnabled {
            let input = AVAssetWriterInput(mediaType: .audio, outputSettings: [AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVSampleRateKey: 48_000, AVNumberOfChannelsKey: 1, AVEncoderBitRateKey: profile.audioBitRate])
            input.expectsMediaDataInRealTime = true
            guard newWriter.canAdd(input) else { throw WriterError.audioUnavailable }
            newWriter.add(input); newAudioInput = input
        } else { newAudioInput = nil }
        writer = newWriter; videoInput = newVideoInput; adaptor = newAdaptor; audioInput = newAudioInput
        queue.setSpecific(key: queueKey, value: 1)
    }

    func start() throws {
        try sync {
            guard case .configured = state else { throw WriterError.invalidConfiguration }
            guard writer.startWriting() else { state = .failed(writer.error ?? WriterError.startFailed); throw writer.error ?? WriterError.startFailed }
            state = .writing
        }
    }

    /// Correction and aspect-fill crop are applied here before the encoded sample enters the writer.
    /// Backpressure drops this frame at its original PTS; accepted frames are never retimed.
    func appendVideo(_ source: CIImage, presentationTime pts: CMTime) throws -> FrameResult {
        try sync {
            guard case .writing = state else { if case .finishing = state { return .droppedBackpressure }; throw WriterError.notWriting }
            guard pts.isValid, pts.isNumeric, CMTimeGetSeconds(pts).isFinite else { throw WriterError.invalidTimestamp }
            guard source.extent.width > 0, source.extent.height > 0 else { throw WriterError.invalidConfiguration }
            if let lastVideoPTS, CMTimeCompare(pts, lastVideoPTS) <= 0 { throw WriterError.nonMonotonicTimestamp }
            if !didStartSession {
                writer.startSession(atSourceTime: pts); firstVideoPTS = pts; didStartSession = true
                flushQueuedAudio()
                guard case .writing = state else { throw WriterError.notWriting }
            }
            if let firstVideoPTS {
                let elapsed = CMTimeGetSeconds(CMTimeSubtract(pts, firstVideoPTS))
                if elapsed + 1.0/Double(profile.fps) > maximumDuration { stopReason = "duration-limit"; return .limitReached(stopReason!) }
            }
            let frameAllowance = Int64(Double(profile.videoBitRate) / Double(profile.fps) / 8 * 2)
            if estimatedFileBytes() + frameAllowance >= maximumBytes { stopReason = "byte-limit"; return .limitReached(stopReason!) }
            guard videoInput.isReadyForMoreMediaData else { return recordVideoBackpressure() }
            guard let pool = adaptor.pixelBufferPool else { throw WriterError.allocationFailed }
            var destination: CVPixelBuffer?
            let status = CVPixelBufferPoolCreatePixelBufferWithAuxAttributes(kCFAllocatorDefault, pool,
                [kCVPixelBufferPoolAllocationThresholdKey as String: 4] as CFDictionary, &destination)
            guard status == kCVReturnSuccess, let destination else {
                if status == kCVReturnWouldExceedAllocationThreshold { return recordVideoBackpressure() }
                let error = WriterError.allocationFailed; fail(error); throw error
            }
            let width = Int(size.width), height = Int(size.height)
            let scale = max(CGFloat(width) / source.extent.width, CGFloat(height) / source.extent.height)
            let scaled = source.transformed(by: CGAffineTransform(translationX: -source.extent.origin.x, y: -source.extent.origin.y))
                .transformed(by: CGAffineTransform(scaleX: scale, y: scale))
            let cropWidth = CGFloat(width)
            let cropHeight = CGFloat(height)
            let cropX = (scaled.extent.width - cropWidth) / CGFloat(2)
            let cropY = (scaled.extent.height - cropHeight) / CGFloat(2)
            let crop = CGRect(x: cropX, y: cropY, width: cropWidth, height: cropHeight)
            do { try processor.render(source: scaled.cropped(to: crop), into: destination, recipe: recipe) }
            catch { fail(error); throw error }
            guard adaptor.append(destination, withPresentationTime: pts) else {
                let error = writer.error ?? WriterError.videoAppendFailed; fail(error); throw error
            }
            lastVideoPTS = pts; frameCount += 1; consecutiveDrops = 0
            if estimatedFileBytes() >= maximumBytes { stopReason = "byte-limit"; return .limitReached(stopReason!) }
            return .appended
        }
    }

    /// Audio arriving before the first video frame is held in a fixed queue, then
    /// samples before the chosen video start PTS are trimmed to keep one real timeline.
    func appendAudio(_ sample: CMSampleBuffer) throws -> AudioResult {
        try sync {
            guard audioInput != nil else { throw WriterError.audioUnavailable }
            guard case .writing = state else { if case .finishing = state { return .ignoredLate }; throw WriterError.notWriting }
            let pts = CMSampleBufferGetPresentationTimeStamp(sample)
            guard pts.isValid, pts.isNumeric else { throw WriterError.invalidTimestamp }
            guard didStartSession, let start = firstVideoPTS else {
                guard queuedAudio.count < 64 else { fail(WriterError.audioBackpressure); throw WriterError.audioBackpressure }
                queuedAudio.append(sample); return .appended
            }
            if CMTimeCompare(pts,start) < 0 { return .ignoredLate }
            let elapsed = CMTimeGetSeconds(CMTimeSubtract(pts,start))
            let rawSampleDuration = CMTimeGetSeconds(CMSampleBufferGetDuration(sample))
            guard rawSampleDuration.isFinite else { throw WriterError.invalidTimestamp }
            let sampleDuration = max(0, rawSampleDuration)
            if elapsed + sampleDuration > maximumDuration { stopReason = "duration-limit"; return .limitReached(stopReason!) }
            let audioAllowance = Int64(sampleDuration * Double(profile.audioBitRate) / 8 * 2 + 1024)
            if estimatedFileBytes() + audioAllowance >= maximumBytes { stopReason = "byte-limit"; return .limitReached(stopReason!) }
            try appendAudioNow(sample, pts: pts)
            return .appended
        }
    }

    func finish(completion: @escaping (Result<Metadata, Error>) -> Void) {
        queue.async {
            self.finishCallbacks.append(completion)
            switch self.state {
            case .finished(let result): self.deliver(result)
            case .cancelled: self.deliver(.failure(WriterError.cancelled))
            case .failed(let error): self.deliver(.failure(error))
            case .finishing: break
            case .configured:
                self.fail(WriterError.zeroFrames)
                self.complete(.failure(WriterError.zeroFrames))
            case .writing:
                guard self.frameCount > 0, self.didStartSession else { self.fail(WriterError.zeroFrames); self.complete(.failure(WriterError.zeroFrames)); return }
                // The pixel-buffer adaptor infers an open-ended last sample from
                // preceding timestamps. Explicitly end at one frame after the last
                // accepted image so a dropped-frame gap cannot extend the clip.
                if let last = self.lastVideoPTS, let first = self.firstVideoPTS {
                    let frameEnd = CMTimeAdd(last, CMTime(value: 1, timescale: Int32(self.profile.fps)))
                    let limitEnd = CMTimeAdd(first, CMTime(seconds: self.maximumDuration, preferredTimescale: 60_000))
                    let end = CMTimeCompare(frameEnd, limitEnd) < 0 ? frameEnd : limitEnd
                    self.writer.endSession(atSourceTime: end)
                }
                self.state = .finishing; self.videoInput.markAsFinished(); self.audioInput?.markAsFinished()
                self.writer.finishWriting { self.queue.async { self.finishWritingCompleted() } }
            }
        }
    }

    func cancel(completion: (() -> Void)? = nil) {
        queue.async {
            if case .finished = self.state { completion?(); return }
            if case .cancelled = self.state { completion?(); return }
            self.writer.cancelWriting(); self.state = .cancelled; self.queuedAudio.removeAll()
            self.processor.purgeIntermediatePools()
            try? FileManager.default.removeItem(at: self.outputURL)
            self.deliver(.failure(WriterError.cancelled)); completion?()
        }
    }

    private func appendAudioNow(_ sample: CMSampleBuffer, pts: CMTime) throws {
        guard let audioInput else { throw WriterError.audioUnavailable }
        if let lastAudioPTS, CMTimeCompare(pts,lastAudioPTS) < 0 { throw WriterError.nonMonotonicTimestamp }
        guard audioInput.isReadyForMoreMediaData else { fail(WriterError.audioBackpressure); throw WriterError.audioBackpressure }
        guard audioInput.append(sample) else { let error = writer.error ?? WriterError.audioAppendFailed; fail(error); throw error }
        lastAudioPTS = pts
        if estimatedFileBytes() >= maximumBytes { stopReason = "byte-limit" }
    }

    private func recordVideoBackpressure() -> FrameResult {
        consecutiveDrops += 1
        // Bound a stalled recording so it cannot silently produce an empty file.
        if consecutiveDrops >= profile.fps * 3 {
            let error = WriterError.writerFailed("Video writer remained backpressured for three seconds.")
            fail(error)
            return .limitReached("writer-backpressure")
        }
        return .droppedBackpressure
    }

    private func flushQueuedAudio() {
        guard let start = firstVideoPTS else { return }
        let pending = queuedAudio; queuedAudio.removeAll(keepingCapacity: false)
        for sample in pending {
            let pts = CMSampleBufferGetPresentationTimeStamp(sample)
            if CMTimeCompare(pts,start) >= 0 {
                let elapsed = CMTimeGetSeconds(CMTimeSubtract(pts,start))
                let duration = max(0, CMTimeGetSeconds(CMSampleBufferGetDuration(sample)))
                if elapsed + duration > maximumDuration { stopReason = "duration-limit"; break }
                let allowance = Int64(duration * Double(profile.audioBitRate) / 8 * 2 + 1024)
                if estimatedFileBytes() + allowance >= maximumBytes { stopReason = "byte-limit"; break }
                do { try appendAudioNow(sample, pts: pts) } catch { fail(error); return }
            }
        }
    }

    private func finishWritingCompleted() {
        guard case .finishing = state else { return }
        guard writer.status == .completed else { let error = writer.error ?? WriterError.writerFailed("AVAssetWriter did not complete."); fail(error); complete(.failure(error)); return }
        do {
            let attrs = try FileManager.default.attributesOfItem(atPath: outputURL.path)
            let bytes = (attrs[.size] as? NSNumber)?.int64Value ?? 0
            guard bytes > 0, bytes <= maximumBytes else { throw WriterError.byteLimit }
            let asset = AVURLAsset(url: outputURL), tracks = asset.tracks(withMediaType: .video)
            guard let track = tracks.first else { throw WriterError.invalidOutput }
            let transformed = track.naturalSize.applying(track.preferredTransform)
            let width = Int(abs(transformed.width)), height = Int(abs(transformed.height))
            let duration = CMTimeGetSeconds(asset.duration)
            guard width > 0, height > 0, duration.isFinite, duration > 0, duration <= maximumDuration + 1.0/Double(profile.fps) else { throw WriterError.invalidOutput }
            let subtype = track.formatDescriptions.first.map { CMFormatDescriptionGetMediaSubType($0 as! CMFormatDescription) }
            let codec = subtype == kCMVideoCodecType_H264 ? "h264" : "unknown"
            guard codec == "h264" else { throw WriterError.invalidOutput }
            let result = Metadata(width: width, height: height, duration: duration, bytes: bytes,
                codec: codec, nominalFrameRate: Double(track.nominalFrameRate), frameCount: frameCount, stopReason: stopReason)
            processor.purgeIntermediatePools()
            state = .finished(.success(result)); deliver(.success(result))
        } catch { fail(error); complete(.failure(error)) }
    }

    private func estimatedFileBytes() -> Int64 {
        guard let attrs = try? FileManager.default.attributesOfItem(atPath: outputURL.path),
              let size = (attrs[.size] as? NSNumber)?.int64Value else { return 0 }
        return size
    }

    private func fail(_ error: Error) {
        writer.cancelWriting(); state = .failed(error); queuedAudio.removeAll()
        processor.purgeIntermediatePools()
        try? FileManager.default.removeItem(at: outputURL)
    }

    private func complete(_ result: Result<Metadata, Error>) { state = .finished(result); deliver(result) }
    private func deliver(_ result: Result<Metadata, Error>) {
        let callbacks = finishCallbacks; finishCallbacks.removeAll()
        for callback in callbacks { DispatchQueue.main.async { callback(result) } }
    }
    private func sync<T>(_ body: () throws -> T) rethrows -> T {
        if DispatchQueue.getSpecific(key: queueKey) != nil { return try body() }
        return try queue.sync(execute: body)
    }
}
