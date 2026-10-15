import AVFoundation
import AudioToolbox
import CoreGraphics
import CoreImage
import CoreMedia
import Metal
import XCTest
@testable import App

final class NativeMovieWriterTests: XCTestCase {
    private func scratchFolder() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("ClearWaterMovieWriterTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    private func coloredFrame() -> CIImage {
        let rgba = Data([40, 100, 170, 255])
        let provider = CGDataProvider(data: rgba as CFData)!
        let image = CGImage(width: 1, height: 1, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: 4,
            space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.last.rawValue),
            provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)!
        return CIImage(cgImage: image)
    }

    private func awaitFinish(_ writer: ClearWaterMovieWriter, timeout: TimeInterval = 30) throws -> ClearWaterMovieWriter.Metadata {
        let done = expectation(description: "movie writer finishes")
        var result: Result<ClearWaterMovieWriter.Metadata, Error>?
        writer.finish { result = $0; done.fulfill() }
        wait(for: [done], timeout: timeout)
        return try XCTUnwrap(result).get()
    }

    func testProductionWriterEncodesCorrectedH264AndPreservesSourceTiming() throws {
        guard MTLCreateSystemDefaultDevice() != nil else { throw XCTSkip("Metal is unavailable on this test device") }
        let processor = try ClearWaterBalancedProcessor()
        let folder = try scratchFolder(); defer { try? FileManager.default.removeItem(at: folder) }
        let output = folder.appendingPathComponent("capture.mp4")
        var recipe = NativeBalancedMath.defaultCameraRecipe()
        recipe.strength = 1; recipe.auto.gains = [2.2, 1, 1]; recipe.auto.redMix = 0
        recipe.auto.haze = 0; recipe.auto.highlights = 0
        let writer = try ClearWaterMovieWriter(outputURL: output, sourceSize: CGSize(width:1280,height:720), profile: .standard, audioEnabled: false,
            recipe: recipe, processor: processor, maximumDuration: 2)
        recipe.auto.gains = [1,1,1]
        XCTAssertEqual(writer.recipe.auto.gains, [2.2,1,1], "The writer freezes the camera recipe at start.")
        try writer.start()
        let frame = coloredFrame()
        let start = CMTime(value: 600, timescale: 300)
        for i in 0..<9 {
            let pts = CMTimeAdd(start, CMTime(value: CMTimeValue(i), timescale: 30))
            let deadline = Date().addingTimeInterval(3)
            while true {
                switch try writer.appendVideo(frame, presentationTime: pts) {
                case .appended: break
                case .droppedBackpressure:
                    guard Date() < deadline else { XCTFail("Writer stayed backpressured for a frame."); throw ClearWaterMovieWriter.WriterError.videoAppendFailed }
                    Thread.sleep(forTimeInterval: 0.01)
                    continue
                case .limitReached(let reason): XCTFail("Unexpected writer stop: \(reason)"); throw ClearWaterMovieWriter.WriterError.videoAppendFailed
                }
                break
            }
        }
        let metadata = try awaitFinish(writer)
        XCTAssertEqual(metadata.width, 1280); XCTAssertEqual(metadata.height, 720)
        XCTAssertEqual(metadata.codec, "h264"); XCTAssertEqual(metadata.frameCount, 9)
        XCTAssertEqual(metadata.nominalFrameRate, 30, accuracy: 0.1)
        XCTAssertGreaterThan(metadata.bytes, 0); XCTAssertGreaterThan(metadata.duration, 0.2)
        XCTAssertLessThanOrEqual(metadata.bytes, 500 * 1024 * 1024)

        let asset = AVURLAsset(url: output)
        let track = try XCTUnwrap(asset.tracks(withMediaType: .video).first)
        XCTAssertEqual(track.naturalSize.width, 1280); XCTAssertEqual(track.naturalSize.height, 720)
        let reader = try AVAssetReader(asset: asset)
        let trackOutput = AVAssetReaderTrackOutput(track: track, outputSettings: nil)
        XCTAssertTrue(reader.canAdd(trackOutput)); reader.add(trackOutput); XCTAssertTrue(reader.startReading())
        var times: [Double] = []
        while let sample = trackOutput.copyNextSampleBuffer() {
            times.append(CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sample)))
        }
        let presentationTimes = times.sorted()
        XCTAssertEqual(presentationTimes.count, 9)
        XCTAssertTrue(zip(presentationTimes, presentationTimes.dropFirst()).allSatisfy { $0.1 > $0.0 })
        for delta in zip(presentationTimes, presentationTimes.dropFirst()).map({ $0.1-$0.0 }) { XCTAssertEqual(delta, 1.0/30.0, accuracy: 0.003) }

        let generator = AVAssetImageGenerator(asset: asset); generator.appliesPreferredTrackTransform = true
        let decoded = try generator.copyCGImage(at: CMTime(value: 3, timescale: 30), actualTime: nil)
        var pixel = [UInt8](repeating: 0, count: 4)
        pixel.withUnsafeMutableBytes { raw in
            let context = CGContext(data: raw.baseAddress, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
                space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
            context.interpolationQuality = .none
            context.draw(decoded, in: CGRect(x: -CGFloat(decoded.width)/2, y: -CGFloat(decoded.height)/2, width: CGFloat(decoded.width), height: CGFloat(decoded.height)))
        }
        XCTAssertGreaterThan(Int(pixel[0]), 65, "The encoded frame must include the native Balanced red gain, not the raw source color.")
    }

    private func silentAudio(presentationTime: CMTime) throws -> CMSampleBuffer {
        var asbd = AudioStreamBasicDescription(mSampleRate: 48_000, mFormatID: kAudioFormatLinearPCM,
            mFormatFlags: kLinearPCMFormatFlagIsSignedInteger | kLinearPCMFormatFlagIsPacked,
            mBytesPerPacket: 2, mFramesPerPacket: 1, mBytesPerFrame: 2, mChannelsPerFrame: 1,
            mBitsPerChannel: 16, mReserved: 0)
        var format: CMAudioFormatDescription?
        XCTAssertEqual(CMAudioFormatDescriptionCreate(allocator: kCFAllocatorDefault, asbd: &asbd,
            layoutSize: 0, layout: nil, magicCookieSize: 0, magicCookie: nil, extensions: nil,
            formatDescriptionOut: &format), noErr)
        let sampleCount = 1600, byteCount = sampleCount * 2
        var block: CMBlockBuffer?
        XCTAssertEqual(CMBlockBufferCreateWithMemoryBlock(allocator: kCFAllocatorDefault, memoryBlock: nil,
            blockLength: byteCount, blockAllocator: kCFAllocatorDefault, customBlockSource: nil,
            offsetToData: 0, dataLength: byteCount, flags: 0, blockBufferOut: &block), kCMBlockBufferNoErr)
        let data = try XCTUnwrap(block)
        XCTAssertEqual(CMBlockBufferFillDataBytes(with: 0, blockBuffer: data, offsetIntoDestination: 0,
            dataLength: byteCount), kCMBlockBufferNoErr)
        var timing = CMSampleTimingInfo(duration: CMTime(value: 1, timescale: 48_000),
            presentationTimeStamp: presentationTime, decodeTimeStamp: .invalid)
        var sampleSize = 2
        var sample: CMSampleBuffer?
        XCTAssertEqual(CMSampleBufferCreateReady(allocator: kCFAllocatorDefault, dataBuffer: data,
            formatDescription: try XCTUnwrap(format), sampleCount: sampleCount, sampleTimingEntryCount: 1,
            sampleTimingArray: &timing, sampleSizeEntryCount: 1, sampleSizeArray: &sampleSize,
            sampleBufferOut: &sample), noErr)
        return try XCTUnwrap(sample)
    }

    func testProductionWriterMuxesOptionalAACWithTheVideoTimeline() throws {
        guard MTLCreateSystemDefaultDevice() != nil else { throw XCTSkip("Metal is unavailable on this test device") }
        let folder = try scratchFolder(); defer { try? FileManager.default.removeItem(at: folder) }
        let output = folder.appendingPathComponent("audio-video.mp4")
        let writer = try ClearWaterMovieWriter(outputURL: output, sourceSize: CGSize(width: 640, height: 480),
            profile: .standard, audioEnabled: true, recipe: NativeBalancedMath.defaultCameraRecipe(),
            processor: try ClearWaterBalancedProcessor(), maximumDuration: 2)
        try writer.start()
        for index in 0..<18 {
            let pts = CMTime(value: CMTimeValue(300 + index), timescale: 30)
            var appended = false
            let deadline = Date().addingTimeInterval(3)
            repeat {
                if try writer.appendVideo(coloredFrame(), presentationTime: pts) == .appended { appended = true }
                else { Thread.sleep(forTimeInterval: 0.01) }
            } while !appended && Date() < deadline
            XCTAssertTrue(appended)
            XCTAssertEqual(try writer.appendAudio(silentAudio(presentationTime: pts)), .appended)
            Thread.sleep(forTimeInterval: 1.0 / 30.0)
        }
        _ = try awaitFinish(writer)
        let asset = AVURLAsset(url: output)
        let video = try XCTUnwrap(asset.tracks(withMediaType: .video).first)
        let audio = try XCTUnwrap(asset.tracks(withMediaType: .audio).first)
        let description = try XCTUnwrap(audio.formatDescriptions.first) as! CMFormatDescription
        XCTAssertEqual(CMFormatDescriptionGetMediaSubType(description), kAudioFormatMPEG4AAC)
        XCTAssertGreaterThan(CMTimeGetSeconds(audio.timeRange.duration), 0.5)
        XCTAssertLessThan(abs(CMTimeGetSeconds(audio.timeRange.start) - CMTimeGetSeconds(video.timeRange.start)), 0.05)
        XCTAssertLessThan(abs(CMTimeGetSeconds(audio.timeRange.duration) - CMTimeGetSeconds(video.timeRange.duration)), 0.08)
    }

    func testZeroFrameFinishFailsAndRemovesOutput() throws {
        guard MTLCreateSystemDefaultDevice() != nil else { throw XCTSkip("Metal is unavailable on this test device") }
        let folder = try scratchFolder(); defer { try? FileManager.default.removeItem(at: folder) }
        let output = folder.appendingPathComponent("empty.mp4")
        let writer = try ClearWaterMovieWriter(outputURL: output, sourceSize: CGSize(width:1280,height:720), profile: .standard, audioEnabled: false,
            recipe: NativeBalancedMath.defaultCameraRecipe(), processor: try ClearWaterBalancedProcessor())
        try writer.start()
        let done = expectation(description: "empty movie rejected")
        writer.finish { result in
            if case .failure = result { done.fulfill() }
        }
        wait(for: [done], timeout: 5)
        XCTAssertFalse(FileManager.default.fileExists(atPath: output.path))
    }

    func testDurationLimitStopsAtOriginalTimestampAndReportsReason() throws {
        guard MTLCreateSystemDefaultDevice() != nil else { throw XCTSkip("Metal is unavailable on this test device") }
        let folder = try scratchFolder(); defer { try? FileManager.default.removeItem(at: folder) }
        let output = folder.appendingPathComponent("limited.mp4")
        let writer = try ClearWaterMovieWriter(outputURL: output, sourceSize: CGSize(width:1280,height:720), profile: .standard, audioEnabled: false,
            recipe: NativeBalancedMath.defaultCameraRecipe(), processor: try ClearWaterBalancedProcessor(), maximumDuration: 0.15)
        try writer.start(); let frame = coloredFrame(); let start = CMTime(value: 300, timescale: 30)
        XCTAssertEqual(try writer.appendVideo(frame, presentationTime: start), .appended)
        XCTAssertEqual(try writer.appendVideo(frame, presentationTime: CMTimeAdd(start, CMTime(value: 3, timescale: 30))), .appended)
        XCTAssertEqual(try writer.appendVideo(frame, presentationTime: CMTimeAdd(start, CMTime(value: 6, timescale: 30))), .limitReached("duration-limit"))
        let metadata = try awaitFinish(writer)
        XCTAssertEqual(metadata.stopReason, "duration-limit")
        XCTAssertEqual(metadata.frameCount, 2)
        XCTAssertLessThan(metadata.duration, 0.15)
    }

    func testCancelIsIdempotentAndRemovesStagedMovie() throws {
        guard MTLCreateSystemDefaultDevice() != nil else { throw XCTSkip("Metal is unavailable on this test device") }
        let folder = try scratchFolder(); defer { try? FileManager.default.removeItem(at: folder) }
        let output = folder.appendingPathComponent("cancelled.mp4")
        let writer = try ClearWaterMovieWriter(outputURL: output, sourceSize: CGSize(width:640,height:480), profile: .standard,
            audioEnabled: false, recipe: NativeBalancedMath.defaultCameraRecipe(), processor: try ClearWaterBalancedProcessor())
        try writer.start()
        let cancelled = expectation(description: "cancel completes")
        let repeated = expectation(description: "repeat cancel completes")
        writer.cancel { cancelled.fulfill() }
        writer.cancel { repeated.fulfill() }
        wait(for: [cancelled,repeated], timeout: 5)
        XCTAssertFalse(FileManager.default.fileExists(atPath: output.path))
    }

    func testByteBudgetRejectsBeforeFrameAllocationAndLeavesNoMovie() throws {
        guard MTLCreateSystemDefaultDevice() != nil else { throw XCTSkip("Metal is unavailable on this test device") }
        let folder = try scratchFolder(); defer { try? FileManager.default.removeItem(at: folder) }
        let output = folder.appendingPathComponent("over-budget.mp4")
        let writer = try ClearWaterMovieWriter(outputURL: output, sourceSize: CGSize(width:640,height:480), profile: .standard,
            audioEnabled: false, recipe: NativeBalancedMath.defaultCameraRecipe(), processor: try ClearWaterBalancedProcessor(), maximumBytes: 1024)
        try writer.start()
        let result = try writer.appendVideo(coloredFrame(), presentationTime: CMTime(value: 0, timescale: 30))
        XCTAssertEqual(result, .limitReached("byte-limit"))
        let finished = expectation(description: "over-budget empty movie rejected")
        writer.finish { result in if case .failure = result { finished.fulfill() } }
        wait(for: [finished], timeout: 5)
        XCTAssertFalse(FileManager.default.fileExists(atPath: output.path))
    }

    func testProfilesCapLongAndShortSidesWithoutUpscaling() {
        XCTAssertEqual(ClearWaterMovieWriter.QualityProfile.high.outputSize(for: CGSize(width:3024,height:4032)), CGSize(width:1080,height:1440))
        XCTAssertEqual(ClearWaterMovieWriter.QualityProfile.standard.outputSize(for: CGSize(width:640,height:480)), CGSize(width:640,height:480))
        XCTAssertEqual(ClearWaterMovieWriter.QualityProfile.standard.outputSize(for: CGSize(width:4032,height:3024)), CGSize(width:960,height:720))
    }

    func testEditorRecipeAfterCaptureIsNeutralAndZeroStrength() {
        let recipe = NativeBalancedMath.editorRecipeAfterCapture()
        XCTAssertEqual(recipe.version, 1); XCTAssertEqual(recipe.engine, "balanced"); XCTAssertEqual(recipe.strength, 0)
        XCTAssertEqual(recipe.manual, NativeBalancedAdjustments())
    }
}
