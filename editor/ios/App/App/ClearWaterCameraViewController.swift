import AVFoundation
import CoreImage
import CoreVideo
import ImageIO
import MetalKit
import UIKit

enum ClearWaterCameraOrientation {
    static func angleDegrees(for orientation: UIDeviceOrientation) -> CGFloat? {
        switch orientation {
        case .portrait: return 90
        case .portraitUpsideDown: return 270
        // UIDeviceOrientation is the opposite handedness of the interface
        // orientation enum used by the older camera UI mapping.
        case .landscapeLeft: return 0
        case .landscapeRight: return 180
        default: return nil
        }
    }
    static func sampleSize(width: CGFloat, height: CGFloat, maximum: CGFloat = 256) -> CGSize {
        guard width > 0, height > 0, maximum > 0 else { return .zero }
        let scale = min(1, maximum / max(width, height))
        return CGSize(width: max(1, (width * scale).rounded()), height: max(1, (height * scale).rounded()))
    }
    static func jpegSample(source: CIImage, context: CIContext, maximum: CGFloat = 256) -> (data: Data, width: Int, height: Int)? {
        let size = sampleSize(width: source.extent.width, height: source.extent.height, maximum: maximum)
        guard size.width > 0, size.height > 0 else { return nil }
        let width = Int(size.width), height = Int(size.height)
        let target = CGRect(x: 0, y: 0, width: width, height: height)
        let extent = source.extent
        let scaled = source.transformed(by: CGAffineTransform(translationX: -extent.minX, y: -extent.minY))
            .transformed(by: CGAffineTransform(scaleX: CGFloat(width) / extent.width, y: CGFloat(height) / extent.height))
            .cropped(to: target)
        guard let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
              let image = context.createCGImage(scaled, from: target, format: .RGBA8, colorSpace: colorSpace) else { return nil }
        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(output, "public.jpeg" as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.9] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { return nil }
        return (output as Data, width, height)
    }
    static func exifOrientation(fromPortraitAngle angle: CGFloat) -> Int32 {
        switch Int(angle.rounded()) {
        case 0: return 8
        case 180: return 6
        case 270: return 3
        default: return 1
        }
    }
    static func orientedVideoSize(_ portraitSourceSize: CGSize, angle: CGFloat) -> CGSize {
        if angle == 0 || angle == 180 { return CGSize(width: portraitSourceSize.height, height: portraitSourceSize.width) }
        return portraitSourceSize
    }
    static func orientedCaptureImage(_ source: CIImage, angle: CGFloat, mirrored: Bool) -> CIImage {
        let unmirrored = mirrored ? source.oriented(forExifOrientation: 2) : source
        return unmirrored.oriented(forExifOrientation: exifOrientation(fromPortraitAngle: angle))
    }
}

struct ClearWaterCameraOptions {
    let locale: String
    let strings: [String: String]
    let strength: Double
    let quality: String
    let minutes: Int
    let microphoneEnabled: Bool
    let saveEnhancedPhotos: Bool
    let embedded: Bool
    let facing: AVCaptureDevice.Position
    init(locale: String, strings: [String: String], settings: [String: Any]) {
        self.locale = ["en", "zh-HK", "ja"].contains(locale) ? locale : "en"
        self.strings = strings
        strength = min(100, max(0, (settings["strength"] as? NSNumber)?.doubleValue ?? 80)) / 100
        let quality = settings["quality"] as? String ?? "standard"
        self.quality = quality == "standard" ? "standard" : "high"
        let minutes = (settings["minutes"] as? NSNumber)?.intValue ?? 1
        self.minutes = [1, 3, 5].contains(minutes) ? minutes : 1
        microphoneEnabled = settings["microphoneEnabled"] as? Bool ?? false
        saveEnhancedPhotos = settings["saveEnhancedPhotos"] as? Bool ?? false
        embedded = settings["embedded"] as? Bool ?? false
        facing = (settings["facing"] as? String) == "user" ? .front : .back
    }
    func text(_ key: String, _ fallback: String) -> String { strings[key] ?? fallback }
}

protocol ClearWaterCameraViewControllerDelegate: AnyObject {
    func cameraViewController(_ controller: ClearWaterCameraViewController, didComplete descriptor: [String: Any])
    func cameraViewController(_ controller: ClearWaterCameraViewController, didFail message: String, captureID: UUID?)
    func cameraViewController(_ controller: ClearWaterCameraViewController, recordingState: String)
    func cameraViewControllerDidClose(_ controller: ClearWaterCameraViewController)
    func cameraViewController(_ controller: ClearWaterCameraViewController, saveCaptureToPhotos id: UUID, completion: @escaping (Bool, String?) -> Void)
}

/// Camera/session callbacks and encoding use bounded serial queues. Late capture frames are dropped.
final class ClearWaterCameraViewController: UIViewController, MTKViewDelegate,
    AVCapturePhotoCaptureDelegate, AVCaptureVideoDataOutputSampleBufferDelegate,
    AVCaptureAudioDataOutputSampleBufferDelegate {
    weak var delegate: ClearWaterCameraViewControllerDelegate?
    private let options: ClearWaterCameraOptions
    private let session = AVCaptureSession()
    private let sessionQueue = DispatchQueue(label: "clearwater.camera.session")
    private let mediaQueue = DispatchQueue(label: "clearwater.camera.media")
    private let storageQueue = DispatchQueue(label: "clearwater.camera.storage", qos: .userInitiated)
    private let frameLock = NSLock()
    private let recipeLock = NSLock()
    private let ciContext: CIContext
    private let renderCommandQueue: MTLCommandQueue
    private let metalView: MTKView
    private let processor: ClearWaterBalancedProcessor
    private let photoOutput = AVCapturePhotoOutput()
    private let videoOutput = AVCaptureVideoDataOutput()
    private let audioOutput = AVCaptureAudioDataOutput()
    private var cameraInput: AVCaptureDeviceInput?
    private var audioInput: AVCaptureDeviceInput?
    private var pressureObservation: NSKeyValueObservation?
    private var observers: [NSObjectProtocol] = []
    // cameraPosition and cameraInput are owned by sessionQueue.
    private var cameraPosition: AVCaptureDevice.Position = .back
    private var hardwareWhiteBalanceLocked = false
    private let lifecycleLock = NSLock()
    private var closeFlag = false
    private var closeFinishFlag = false
    private(set) var embeddedSessionCloseReason: String?
    private var backgroundFlag = false
    private var audioEnabledFlag = false
    private var pickedNeutralFlag = false
    private var closeRequested: Bool {
        get { lifecycleLock.lock(); defer { lifecycleLock.unlock() }; return closeFlag }
        set { lifecycleLock.lock(); closeFlag = newValue; lifecycleLock.unlock() }
    }
    private func claimCloseFinish() -> Bool {
        lifecycleLock.lock(); defer { lifecycleLock.unlock() }
        guard !closeFinishFlag else { return false }
        closeFinishFlag = true
        return true
    }
    private var backgrounded: Bool {
        get { lifecycleLock.lock(); defer { lifecycleLock.unlock() }; return backgroundFlag }
        set { lifecycleLock.lock(); backgroundFlag = newValue; lifecycleLock.unlock() }
    }
    private var audioEnabled: Bool {
        get { lifecycleLock.lock(); defer { lifecycleLock.unlock() }; return audioEnabledFlag }
        set { lifecycleLock.lock(); audioEnabledFlag = newValue; lifecycleLock.unlock() }
    }
    private var pickedNeutral: Bool {
        get { lifecycleLock.lock(); defer { lifecycleLock.unlock() }; return pickedNeutralFlag }
        set { lifecycleLock.lock(); pickedNeutralFlag = newValue; lifecycleLock.unlock() }
    }
    private var backgroundTask: UIBackgroundTaskIdentifier = .invalid
    private var configured = false
    private var runtimeRecoveryAttempts = 0
    private var captureInFlight = false
    private var currentRecipe: NativeBalancedRecipe
    private var clipRecipe: NativeBalancedRecipe?
    private var photoRecipes: [Int64: NativeBalancedRecipe] = [:]
    private var photoCaptureAvailable = false
    private var pendingRecordingMessage: String?
    private var latestRendered: CIImage?
    private var latestSource: CIImage?
    // Preview buffers are reused with a hard allocation threshold; resolution changes
    // on camera flip drop the prior pool rather than retaining full-frame IOSurfaces.
    private var previewPool: CVPixelBufferPool?
    private var previewPoolSize: CGSize?
    private var previewFailureReported = false
    private var pendingOrientationAngle: CGFloat?
    private var orientationLocked = false
    private var captureOrientationAngle: CGFloat = 90
    private var clipOrientationAngle: CGFloat = 90
    private var clipWasFrontCamera = false
    private var pickerArmed = false
    private var loupeView: UIImageView?
    private var pendingNeutralPatch: Data?
    private var state = "starting"
    private var photoButton: UIButton!
    private var recordButton: UIButton!
    private var pickerButton: UIButton!
    private var strengthSlider: UISlider!
    private var statusLabel: UILabel!
    private var durationLabel: UILabel!
    private var countersLabel: UILabel!
    private var resetButton: UIButton!
    private var elapsedTimer: Timer?
    private var recordingStartedAt: TimeInterval?
    private var savedPhotoCount = 0
    private var savedVideoCount = 0
    private var micButton: UIButton!
    // Writer state is confined to mediaQueue.
    private var movieWriter: ClearWaterMovieWriter?
    private var writerAcceptingFrames = false
    private var writerIncludesAudio = false
    private var recordingStartPTS: CMTime?
    private var acceptedVideoFrames = 0
    private var videoURL: URL?
    private var captureID: UUID?
    private var embeddedCaptureDuration: Double?
    private var embeddedCaptureBytes: Int64?
    private var lastAnalysisTime = 0.0
    private var videoByteLimit: Int64 {
        if let embeddedCaptureBytes { return embeddedCaptureBytes }
        let standard: [Int64] = [64, 192, 320]
        let high: [Int64] = [128, 384, 500]
        let index = options.minutes == 1 ? 0 : options.minutes == 3 ? 1 : 2
        return (options.quality == "high" ? high[index] : standard[index]) * 1024 * 1024
    }

    init(options: ClearWaterCameraOptions) throws {
        self.options = options
        audioEnabledFlag = options.microphoneEnabled
        cameraPosition = options.facing
        processor = try ClearWaterBalancedProcessor()
        var initialRecipe = NativeBalancedMath.defaultCameraRecipe()
        initialRecipe.strength = options.strength
        currentRecipe = initialRecipe
        guard let device = MTLCreateSystemDefaultDevice() else { throw ClearWaterProcessorError.metalUnavailable }
        guard let commandQueue = device.makeCommandQueue() else { throw ClearWaterProcessorError.metalUnavailable }
        renderCommandQueue = commandQueue
        ciContext = CIContext(mtlDevice: device, options: [.workingColorSpace: CGColorSpace(name: CGColorSpace.sRGB)!, .outputColorSpace: CGColorSpace(name: CGColorSpace.sRGB)!, .cacheIntermediates: false])
        metalView = MTKView(frame: .zero, device: device)
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { nil }
    override var prefersStatusBarHidden: Bool { true }
    private func text(_ key: String, _ fallback: String) -> String { options.text(key, fallback) }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        setupUI()
        metalView.translatesAutoresizingMaskIntoConstraints = false
        metalView.framebufferOnly = false
        metalView.colorPixelFormat = .bgra8Unorm
        metalView.isPaused = false
        metalView.enableSetNeedsDisplay = false
        metalView.preferredFramesPerSecond = 30
        metalView.delegate = self
        view.insertSubview(metalView, at: 0)
        NSLayoutConstraint.activate([metalView.leadingAnchor.constraint(equalTo: view.leadingAnchor), metalView.trailingAnchor.constraint(equalTo: view.trailingAnchor), metalView.topAnchor.constraint(equalTo: view.topAnchor), metalView.bottomAnchor.constraint(equalTo: view.bottomAnchor)])
        installObservers()
        if options.embedded {
            view.subviews.filter { $0 !== metalView }.forEach { $0.isHidden = true }
        }
        setState("starting")
        requestCamera()
    }
    override func viewDidLayoutSubviews() { super.viewDidLayoutSubviews(); updateOrientation() }
    deinit { observers.forEach(NotificationCenter.default.removeObserver); UIDevice.current.endGeneratingDeviceOrientationNotifications(); elapsedTimer?.invalidate() }

    private func setupUI() {
        let top = UIStackView(); top.axis = .horizontal; top.alignment = .center; top.distribution = .equalSpacing; top.translatesAutoresizingMaskIntoConstraints = false
        let close = button("xmark", text("Close camera", "Close camera"), 60, #selector(closeTapped))
        pickerButton = button("eyedropper", text("Pick white balance", "Pick white balance"), 60, #selector(pickerTapped))
        micButton = button(audioEnabled ? "mic.fill" : "mic.slash.fill", text("Microphone", "Microphone"), 60, #selector(microphoneTapped))
        let flip = button("arrow.triangle.2.circlepath.camera", text("Flip camera", "Flip camera"), 60, #selector(flipTapped))
        [close, pickerButton, micButton, flip].forEach(top.addArrangedSubview)
        view.addSubview(top)
        let strength = UIStackView(); strength.axis = .vertical; strength.spacing = 4; strength.translatesAutoresizingMaskIntoConstraints = false
        let title = UILabel(); title.text = text("Restoration strength", "Restoration strength"); title.textColor = .white; title.font = .systemFont(ofSize: 14, weight: .medium)
        strengthSlider = UISlider(); strengthSlider.minimumValue = 0; strengthSlider.maximumValue = 100; strengthSlider.value = Float(options.strength * 100); strengthSlider.accessibilityLabel = title.text; strengthSlider.addTarget(self, action: #selector(strengthChanged), for: .valueChanged)
        strength.addArrangedSubview(title); strength.addArrangedSubview(strengthSlider); view.addSubview(strength)
        let bottom = UIStackView(); bottom.axis = .horizontal; bottom.alignment = .center; bottom.distribution = .equalSpacing; bottom.translatesAutoresizingMaskIntoConstraints = false
        resetButton = button("arrow.counterclockwise", text("Reset white balance", "Reset white balance"), 64, #selector(resetTapped))
        photoButton = button("circle.inset.filled", text("Take photo", "Take photo"), 88, #selector(photoTapped))
        recordButton = button("record.circle", text("Start recording", "Start recording"), 68, #selector(recordTapped))
        [resetButton, photoButton, recordButton].forEach(bottom.addArrangedSubview); view.addSubview(bottom)
        statusLabel = UILabel(); statusLabel.textColor = .white; statusLabel.textAlignment = .center; statusLabel.font = .systemFont(ofSize: 14, weight: .semibold); statusLabel.numberOfLines = 2; statusLabel.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(statusLabel)
        durationLabel = UILabel(); durationLabel.textColor = .white; durationLabel.textAlignment = .center; durationLabel.font = .monospacedDigitSystemFont(ofSize: 15, weight: .semibold); durationLabel.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(durationLabel)
        countersLabel = UILabel(); countersLabel.textColor = .white; countersLabel.textAlignment = .center; countersLabel.font = .systemFont(ofSize: 13, weight: .medium); countersLabel.translatesAutoresizingMaskIntoConstraints = false; countersLabel.numberOfLines = 1; view.addSubview(countersLabel)
        let safe = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([top.leadingAnchor.constraint(equalTo: safe.leadingAnchor, constant: 8), top.trailingAnchor.constraint(equalTo: safe.trailingAnchor, constant: -8), top.topAnchor.constraint(equalTo: safe.topAnchor, constant: 8), strength.leadingAnchor.constraint(equalTo: safe.leadingAnchor, constant: 28), strength.trailingAnchor.constraint(equalTo: safe.trailingAnchor, constant: -28), strength.bottomAnchor.constraint(equalTo: bottom.topAnchor, constant: -26), bottom.leadingAnchor.constraint(equalTo: safe.leadingAnchor, constant: 24), bottom.trailingAnchor.constraint(equalTo: safe.trailingAnchor, constant: -24), bottom.bottomAnchor.constraint(equalTo: safe.bottomAnchor, constant: -18), statusLabel.centerXAnchor.constraint(equalTo: safe.centerXAnchor), statusLabel.topAnchor.constraint(equalTo: top.bottomAnchor, constant: 18), countersLabel.centerXAnchor.constraint(equalTo: safe.centerXAnchor), countersLabel.bottomAnchor.constraint(equalTo: durationLabel.topAnchor, constant: -5), durationLabel.centerXAnchor.constraint(equalTo: safe.centerXAnchor), durationLabel.bottomAnchor.constraint(equalTo: strength.topAnchor, constant: -6)])
        updateCounters()
        let pan = UIPanGestureRecognizer(target: self, action: #selector(previewDragged(_:)))
        pan.cancelsTouchesInView = false
        metalView.addGestureRecognizer(pan)
    }
    private func button(_ symbol: String, _ label: String, _ size: CGFloat, _ action: Selector) -> UIButton {
        let b = UIButton(type: .system); b.tintColor = .white; b.backgroundColor = UIColor.black.withAlphaComponent(0.52); b.layer.cornerRadius = size / 2; b.layer.borderWidth = 1; b.layer.borderColor = UIColor.white.withAlphaComponent(0.65).cgColor; b.setImage(UIImage(systemName: symbol), for: .normal); b.accessibilityLabel = label; b.translatesAutoresizingMaskIntoConstraints = false; NSLayoutConstraint.activate([b.widthAnchor.constraint(equalToConstant: size), b.heightAnchor.constraint(equalToConstant: size)]); b.addTarget(self, action: action, for: .touchUpInside); return b
    }
    private func installObservers() {
        let n = NotificationCenter.default
        UIDevice.current.beginGeneratingDeviceOrientationNotifications()
        observers.append(n.addObserver(forName: UIDevice.orientationDidChangeNotification, object: nil, queue: .main) { [weak self] _ in self?.requestOrientationUpdate() })
        observers.append(n.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in self?.enterBackground() })
        observers.append(n.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { [weak self] _ in self?.enterForeground() })
        observers.append(n.addObserver(forName: .AVCaptureSessionWasInterrupted, object: session, queue: .main) { [weak self] _ in self?.interrupted() })
        observers.append(n.addObserver(forName: .AVCaptureSessionInterruptionEnded, object: session, queue: .main) { [weak self] _ in self?.restartIfActive() })
        observers.append(n.addObserver(forName: .AVCaptureSessionRuntimeError, object: session, queue: .main) { [weak self] note in self?.sessionRuntimeError(note) })
        observers.append(n.addObserver(forName: ProcessInfo.thermalStateDidChangeNotification, object: nil, queue: .main) { [weak self] _ in self?.checkThermalState() })
        observers.append(n.addObserver(forName: UIApplication.didReceiveMemoryWarningNotification, object: nil, queue: .main) { [weak self] _ in self?.processor.purgeIntermediatePools() })
    }
    private func requestCamera() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: configureAndStart()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] ok in DispatchQueue.main.async { guard let self else { return }; ok ? self.configureAndStart() : self.fail(self.text("Camera permission is required.", "Camera permission is required.")) } }
        default: fail(text("Enable camera access in Settings.", "Enable camera access in Settings."))
        }
    }
    private func configureAndStart() {
        sessionQueue.async { [weak self] in
            guard let self, !self.backgrounded, !self.closeRequested else { return }
            do {
                if !self.configured { try self.configureSession() }
                self.session.startRunning()
                DispatchQueue.main.async {
                    guard !self.backgrounded, !self.closeRequested,
                          !["capturing", "startingRecording", "recording", "finalising"].contains(self.state) else { return }
                    self.setState("ready")
                }
            } catch {
                DispatchQueue.main.async {
                    guard !self.backgrounded, !self.closeRequested else { return }
                    self.fail(self.text("The camera could not start.", "The camera could not start."))
                }
            }
        }
    }
    private func configureSession() throws {
        session.beginConfiguration()
        session.sessionPreset = .inputPriority
        session.automaticallyConfiguresCaptureDeviceForWideColor = false
        defer { session.commitConfiguration() }
        let input = try AVCaptureDeviceInput(device: selectCamera())
        guard session.canAddInput(input), session.canAddOutput(photoOutput), session.canAddOutput(videoOutput) else { throw CameraError.unavailable }
        session.addInput(input); cameraInput = input; session.addOutput(photoOutput); session.addOutput(videoOutput)
        try configureDeviceFormat(input.device)
        let hasPhotoCapture = configurePhotoDimensions(for: input.device)
        DispatchQueue.main.async { self.photoCaptureAvailable = hasPhotoCapture }
        observeSystemPressure(input.device)
        photoOutput.maxPhotoQualityPrioritization = .quality
        videoOutput.alwaysDiscardsLateVideoFrames = true
        videoOutput.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
        videoOutput.setSampleBufferDelegate(self, queue: mediaQueue)
        if audioEnabled { try addAudioIfGranted() }
        configured = true
        requestOrientationUpdate()
    }
    private func configureDeviceFormat(_ device: AVCaptureDevice) throws {
        try device.lockForConfiguration()
        defer { device.unlockForConfiguration() }
        let supported = device.formats.filter { format in
            let dimensions = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
            let pixels = Int(dimensions.width) * Int(dimensions.height)
            return dimensions.width > 0 && dimensions.height > 0 && pixels <= 1920 * 1080 &&
                format.videoSupportedFrameRateRanges.contains(where: { $0.minFrameRate <= 30 && $0.maxFrameRate >= 30 }) &&
                format.supportedColorSpaces.contains(.sRGB)
        }
        if let best = supported.max(by: { a, b in
            let da = CMVideoFormatDescriptionGetDimensions(a.formatDescription), db = CMVideoFormatDescriptionGetDimensions(b.formatDescription)
            let aPhoto = supportedPhotoPixelCount(for: a), bPhoto = supportedPhotoPixelCount(for: b)
            if aPhoto != bPhoto { return aPhoto < bPhoto }
            return Int(da.width) * Int(da.height) < Int(db.width) * Int(db.height)
        }) { device.activeFormat = best }
        guard device.activeFormat.videoSupportedFrameRateRanges.contains(where: { $0.minFrameRate <= 30 && $0.maxFrameRate >= 30 }) else { throw CameraError.unavailable }
        device.activeVideoMinFrameDuration = CMTime(value: 1, timescale: 30)
        device.activeVideoMaxFrameDuration = CMTime(value: 1, timescale: 30)
        device.automaticallyAdjustsVideoHDREnabled = false
        if device.activeFormat.isVideoHDRSupported { device.isVideoHDREnabled = false }
        if device.activeFormat.supportedColorSpaces.contains(.sRGB) { device.activeColorSpace = .sRGB }
        else { throw CameraError.unavailable }
    }
    private func supportedPhotoPixelCount(for format: AVCaptureDevice.Format) -> Int {
        let limit = 12_500_000
        return format.supportedMaxPhotoDimensions
            .map { Int($0.width) * Int($0.height) }
            .filter { $0 > 0 && $0 <= limit }
            .max() ?? 0
    }
    private func configurePhotoDimensions(for device: AVCaptureDevice) -> Bool {
        let candidates = device.activeFormat.supportedMaxPhotoDimensions.filter {
            $0.width > 0 && $0.height > 0 && Int($0.width) * Int($0.height) <= 12_500_000
        }
        guard let chosen = candidates.max(by: { Int($0.width) * Int($0.height) < Int($1.width) * Int($1.height) }) else { return false }
        photoOutput.maxPhotoDimensions = chosen
        return true
    }
    private func observeSystemPressure(_ device: AVCaptureDevice) {
        pressureObservation?.invalidate()
        pressureObservation = device.observe(\.systemPressureState, options: [.new]) { [weak self] _, change in
            guard let level = change.newValue?.level else { return }
            DispatchQueue.main.async { self?.systemPressureChanged(level) }
        }
    }
    private func systemPressureChanged(_ level: AVCaptureDevice.SystemPressureState.Level) {
        switch level {
        case .serious:
            if state == "ready" { statusLabel.text = text("Camera load is high; recording may be limited.", "Camera load is high; recording may be limited.") }
        case .critical, .shutdown:
            if state == "recording" { stopRecordingWithError(text("Recording stopped because the camera is under heavy load.", "Recording stopped because the camera is under heavy load.")) }
            else if state == "ready" { statusLabel.text = text("Camera load is high; let the device cool before recording.", "Camera load is high; let the device cool before recording.") }
        case .nominal, .fair: break
        default: break
        }
    }
    private func sessionRuntimeError(_ notification: Notification) {
        let error = notification.userInfo?[AVCaptureSessionErrorKey] as? AVError
        guard let error else {
            fail(text("The camera stopped unexpectedly.", "The camera stopped unexpectedly."))
            closeAfterRuntimeFailure(); return
        }
        if error.code == .mediaServicesWereReset, state == "ready", runtimeRecoveryAttempts < 1, !closeRequested, !backgrounded {
            runtimeRecoveryAttempts += 1
            setState("starting")
            releaseHardwareWhiteBalance()
            sessionQueue.async { [weak self] in
                guard let self, !self.backgrounded, !self.closeRequested else { return }
                self.session.stopRunning()
                self.session.beginConfiguration()
                for input in self.session.inputs { self.session.removeInput(input) }
                for output in self.session.outputs { self.session.removeOutput(output) }
                self.cameraInput = nil; self.audioInput = nil; self.configured = false
                self.session.commitConfiguration()
                do { try self.configureSession(); self.session.startRunning(); DispatchQueue.main.async { guard !self.closeRequested, !self.backgrounded, self.state == "starting" else { return }; self.setState("ready") } }
                catch { DispatchQueue.main.async { self.fail(self.text("The camera could not restart.", "The camera could not restart.")); self.closeAfterRuntimeFailure() } }
            }
        } else if state == "recording" {
            if options.embedded { embeddedSessionCloseReason = "runtime-error"; closeRequested = true }
            stopRecordingWithError(text("Recording stopped because the camera was interrupted.", "Recording stopped because the camera was interrupted."))
        } else if ["capturing", "startingRecording", "finalising"].contains(state) {
            if options.embedded { embeddedSessionCloseReason = "runtime-error"; closeRequested = true }
            statusLabel.text = text("Camera interrupted.", "Camera interrupted.")
        } else {
            fail(text("The camera stopped unexpectedly. Close and reopen the camera.", "The camera stopped unexpectedly. Close and reopen the camera."))
            closeAfterRuntimeFailure()
        }
    }
    private func closeAfterRuntimeFailure() {
        guard options.embedded else { return }
        embeddedSessionCloseReason = "runtime-error"; closeRequested = true
        if ["capturing", "startingRecording", "recording", "finalising"].contains(state) { return }
        finishClose()
    }
    private func selectCamera() throws -> AVCaptureDevice {
        let discovery = AVCaptureDevice.DiscoverySession(deviceTypes: [.builtInWideAngleCamera], mediaType: .video, position: cameraPosition)
        guard let camera = discovery.devices.first else { throw CameraError.unavailable }
        return camera
    }
    private func addAudioIfGranted() throws {
        guard audioInput == nil, AVCaptureDevice.authorizationStatus(for: .audio) == .authorized,
              let device = AVCaptureDevice.default(for: .audio) else { return }
        let input = try AVCaptureDeviceInput(device: device)
        guard session.canAddInput(input), session.canAddOutput(audioOutput) else { return }
        session.addInput(input); session.addOutput(audioOutput); audioInput = input
        audioOutput.setSampleBufferDelegate(self, queue: mediaQueue)
    }
    private func updateOrientation() { requestOrientationUpdate() }
    private func requestOrientationUpdate() {
        guard Thread.isMainThread else { DispatchQueue.main.async { [weak self] in self?.requestOrientationUpdate() }; return }
        let angle = ClearWaterCameraOrientation.angleDegrees(for: UIDevice.current.orientation) ?? captureOrientationAngle
        sessionQueue.async { [weak self] in self?.configureOrientation(angle: angle) }
    }
    private func configureOrientation(angle: CGFloat) {
        guard !orientationLocked else { return }
        captureOrientationAngle = angle
        if let c = photoOutput.connection(with: .video), c.isVideoRotationAngleSupported(angle) { c.videoRotationAngle = angle }
        // Keep the source upright for the portrait preview. The writer applies
        // the frozen physical device orientation when recording begins.
        if let c = videoOutput.connection(with: .video), c.isVideoRotationAngleSupported(90) {
            c.videoRotationAngle = 90
            if c.isVideoMirroringSupported {
                c.automaticallyAdjustsVideoMirroring = false
                c.isVideoMirrored = cameraPosition == .front
            }
        }
    }

    func draw(in view: MTKView) {
        frameLock.lock(); let image = latestRendered; frameLock.unlock()
        guard let image, let drawable = view.currentDrawable, let command = renderCommandQueue.makeCommandBuffer() else { return }
        let bounds = CGRect(x: 0, y: 0, width: drawable.texture.width, height: drawable.texture.height)
        let scale = max(bounds.width / image.extent.width, bounds.height / image.extent.height)
        let scaledSize = CGSize(width: image.extent.width * scale, height: image.extent.height * scale)
        let offsetX = (scaledSize.width - bounds.width) / 2, offsetY = (scaledSize.height - bounds.height) / 2
        let scaled = image.transformed(by: CGAffineTransform(translationX: -image.extent.minX, y: -image.extent.minY))
            .transformed(by: CGAffineTransform(scaleX: scale, y: scale))
            .transformed(by: CGAffineTransform(translationX: -offsetX, y: -offsetY))
        let crop = scaled.cropped(to: bounds)
        guard let sRGB = CGColorSpace(name: CGColorSpace.sRGB) else { return }
        ciContext.render(crop, to: drawable.texture, commandBuffer: command, bounds: bounds, colorSpace: sRGB)
        command.present(drawable); command.commit()
    }
    func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard !closeRequested else { return }
        autoreleasepool { processCaptureOutput(output, sampleBuffer: sampleBuffer) }
    }
    private func processCaptureOutput(_ output: AVCaptureOutput, sampleBuffer: CMSampleBuffer) {
        if output === audioOutput { appendAudio(sampleBuffer); return }
        guard output === videoOutput, let sourceBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let source = CIImage(cvPixelBuffer: sourceBuffer)
        let recording = movieWriter != nil && writerAcceptingFrames
        if !recording && !options.embedded { updateAnalysisIfDue(source) }
        let recipe = snapshotRecipe(forClip: recording)
        frameLock.lock(); latestSource = source; frameLock.unlock()
        let size = previewSize(width: CVPixelBufferGetWidth(sourceBuffer), height: CVPixelBufferGetHeight(sourceBuffer))
        if let pool = previewBufferPool(size: size) {
            switch renderPreview(source, recipe: recipe, size: size, pool: pool) {
            case .frame(let processed):
                frameLock.lock(); latestRendered = CIImage(cvPixelBuffer: processed); frameLock.unlock()
            case .backpressure: break // Keep the current drawable and latest source; retry on the next frame.
            case .failure:
                reportPreviewFailure()
            }
        } else {
            reportPreviewFailure()
        }
        if recording, let movieWriter {
            do {
                let writerSource = ClearWaterCameraOrientation.orientedCaptureImage(source, angle: clipOrientationAngle, mirrored: clipWasFrontCamera)
                switch try movieWriter.appendVideo(writerSource, presentationTime: CMSampleBufferGetPresentationTimeStamp(sampleBuffer)) {
                case .appended, .droppedBackpressure: break
                case .limitReached: DispatchQueue.main.async { self.stopRecording(reason: nil) }
                }
            } catch { DispatchQueue.main.async { self.stopRecordingWithError(self.text("The video could not be encoded.", "The video could not be encoded.")) } }
        }
    }
    private enum PreviewRenderResult { case frame(CVPixelBuffer), backpressure, failure }
    private func renderPreview(_ source: CIImage, recipe: NativeBalancedRecipe, size: CGSize, pool: CVPixelBufferPool) -> PreviewRenderResult {
        var destination: CVPixelBuffer?
        let attributes = [kCVPixelBufferPoolAllocationThresholdKey as String: 3] as CFDictionary
        let status = CVPixelBufferPoolCreatePixelBufferWithAuxAttributes(kCFAllocatorDefault, pool, attributes, &destination)
        if status == kCVReturnWouldExceedAllocationThreshold { return .backpressure }
        guard status == kCVReturnSuccess, let destination else { return .failure }
        let w = CGFloat(Int(size.width)), h = CGFloat(Int(size.height))
        let scale = max(w / source.extent.width, h / source.extent.height)
        let fitted = source.transformed(by: CGAffineTransform(translationX: -source.extent.minX, y: -source.extent.minY))
            .transformed(by: CGAffineTransform(scaleX: scale, y: scale))
            .cropped(to: CGRect(x: 0, y: 0, width: w, height: h))
        do { try processor.render(source: fitted, into: destination, recipe: recipe); return .frame(destination) }
        catch { return .failure }
    }
    private func reportPreviewFailure() {
        guard !previewFailureReported else { return }
        previewFailureReported = true
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.fail(self.text("Live restoration is unavailable.", "Live restoration is unavailable."))
        }
    }
    private func previewSize(width: Int, height: Int) -> CGSize {
        let longSide = CGFloat(max(width, height)), shortSide = CGFloat(min(width, height))
        let scale = min(1, min(1280 / longSide, 720 / shortSide))
        return CGSize(width: max(2, floor(CGFloat(width) * scale)), height: max(2, floor(CGFloat(height) * scale)))
    }
    private func previewBufferPool(size: CGSize) -> CVPixelBufferPool? {
        guard size != previewPoolSize || previewPool == nil else { return previewPool }
        previewPool = nil; previewPoolSize = size
        let attributes: [String: Any] = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: Int(size.width), kCVPixelBufferHeightKey as String: Int(size.height),
            kCVPixelBufferIOSurfacePropertiesKey as String: [:], kCVPixelBufferMetalCompatibilityKey as String: true]
        var pool: CVPixelBufferPool?
        guard CVPixelBufferPoolCreate(kCFAllocatorDefault, [kCVPixelBufferPoolMinimumBufferCountKey as String: 2] as CFDictionary,
            attributes as CFDictionary, &pool) == kCVReturnSuccess else { return nil }
        previewPool = pool
        return pool
    }
    private func updateAnalysisIfDue(_ source: CIImage) {
        let now = ProcessInfo.processInfo.systemUptime
        guard !pickedNeutral, now - lastAnalysisTime >= 0.5 else { return }
        lastAnalysisTime = now
        guard let data = analysisPixels(source),
              let analysis = try? NativeBalancedMath.analyse(rgba: data, width: 64, height: 48) else { return }
        recipeLock.lock()
        guard !pickedNeutral else { recipeLock.unlock(); return }
        let previous = currentRecipe
        currentRecipe = NativeBalancedMath.makeCameraRecipe(analysis: analysis, strength: previous.strength, previous: previous)
        recipeLock.unlock()
    }
    func analysisPixels(_ source: CIImage) -> Data? {
        let width = 64, height = 48, bounds = CGRect(x: 0, y: 0, width: 64, height: 48)
        let extent = source.extent
        guard extent.width > 0, extent.height > 0 else { return nil }
        // Statistics cover the whole source frame, as in the shared camera path.
        let scaled = source.transformed(by: CGAffineTransform(translationX: -extent.minX, y: -extent.minY))
            .transformed(by: CGAffineTransform(scaleX: bounds.width / extent.width, y: bounds.height / extent.height))
            .cropped(to: bounds)
        guard let cg = ciContext.createCGImage(scaled, from: bounds) else { return nil }
        let data = NSMutableData(length: width * height * 4)!
        guard let context = CGContext(data: data.mutableBytes, width: width, height: height, bitsPerComponent: 8,
            bytesPerRow: width * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        context.draw(cg, in: bounds)
        return data as Data
    }
    private func render(_ source: CIImage, recipe: NativeBalancedRecipe, size: CGSize, pool: CVPixelBufferPool?) -> CVPixelBuffer? {
        let w = max(1, Int(size.width)), h = max(1, Int(size.height))
        var destination: CVPixelBuffer?
        if let pool {
            let attributes = [kCVPixelBufferPoolAllocationThresholdKey as String: 3] as CFDictionary
            guard CVPixelBufferPoolCreatePixelBufferWithAuxAttributes(kCFAllocatorDefault, pool, attributes, &destination) == kCVReturnSuccess else { return nil }
        }
        else {
            let attrs: [String: Any] = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA, kCVPixelBufferWidthKey as String: w, kCVPixelBufferHeightKey as String: h, kCVPixelBufferIOSurfacePropertiesKey as String: [:], kCVPixelBufferMetalCompatibilityKey as String: true]
            guard CVPixelBufferCreate(kCFAllocatorDefault, w, h, kCVPixelFormatType_32BGRA, attrs as CFDictionary, &destination) == kCVReturnSuccess else { return nil }
        }
        guard let destination else { return nil }
        let scale = max(CGFloat(w) / source.extent.width, CGFloat(h) / source.extent.height)
        let fitted = source.transformed(by: CGAffineTransform(scaleX: scale, y: scale)).cropped(to: CGRect(x: 0, y: 0, width: w, height: h))
        do { try processor.render(source: fitted, into: destination, recipe: recipe); return destination } catch { return nil }
    }
    private func snapshotRecipe(forClip: Bool = false) -> NativeBalancedRecipe {
        recipeLock.lock(); defer { recipeLock.unlock() }
        if forClip, let clipRecipe { return clipRecipe }
        return currentRecipe
    }

    // Shared React camera bridge. The controller remains the sole owner of the
    // capture session, renderer and writer in both embedded and legacy UI modes.
    func setEmbeddedRecipe(_ value: [String: Any]) throws {
        let data = try JSONSerialization.data(withJSONObject: value)
        let recipe = try JSONDecoder().decode(NativeBalancedRecipe.self, from: data)
        guard recipe.version == 1, recipe.engine == "balanced", recipe.hasValidCameraColour() else { throw NativeBalancedMathError.invalidRecipe }
        recipeLock.lock(); let previouslyPicked = currentRecipe.manual.neutral != [1, 1, 1]; currentRecipe = recipe; recipeLock.unlock()
        let nowPicked = recipe.manual.neutral != [1, 1, 1]
        pickedNeutral = nowPicked
        if nowPicked && !previouslyPicked {
            lockHardwareWhiteBalance { [weak self] locked in
                guard let self, self.pickedNeutral else { return }
                self.hardwareWhiteBalanceLocked = locked
            }
        } else if !nowPicked && previouslyPicked {
            releaseHardwareWhiteBalance()
        }
    }
    func setEmbeddedBounds(_ bounds: CGRect) { view.frame = bounds; view.setNeedsLayout(); view.layoutIfNeeded() }
    func embeddedReady(_ completion: @escaping (Result<[String: Any], Error>) -> Void) {
        guard options.embedded else { completion(.failure(CameraError.unavailable)); return }
        guard !closeRequested, !backgrounded else { completion(.failure(CameraError.cancelled)); return }
        if state == "ready" { completion(.success(nativeInfo())); return }
        if state == "error" { completion(.failure(CameraError.unavailable)); return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
            guard let self else { completion(.failure(CameraError.unavailable)); return }
            self.embeddedReady(completion)
        }
    }
    func embeddedInfo() -> [String: Any] { nativeInfo() }
    private func nativeInfo() -> [String: Any] {
        let device = cameraInput?.device
        let dimensions = photoOutput.maxPhotoDimensions
        frameLock.lock(); let frameSize = latestSource?.extent.size; frameLock.unlock()
        let formatSize = device.map { CMVideoFormatDescriptionGetDimensions($0.activeFormat.formatDescription) }
        var previewWidth = Int(frameSize?.width ?? CGFloat(formatSize?.width ?? 0))
        var previewHeight = Int(frameSize?.height ?? CGFloat(formatSize?.height ?? 0))
        if frameSize == nil && (captureOrientationAngle == 90 || captureOrientationAngle == 270) { swap(&previewWidth, &previewHeight) }
        let zoom = device?.videoZoomFactor ?? 1
        var photoWidth = Int(dimensions.width), photoHeight = Int(dimensions.height)
        if captureOrientationAngle == 90 || captureOrientationAngle == 270 { swap(&photoWidth, &photoHeight) }
        return ["width": max(1, previewWidth), "height": max(1, previewHeight),
                "photoWidth": photoWidth, "photoHeight": photoHeight, "zoom": zoom,
                "minZoom": device?.minAvailableVideoZoomFactor ?? 1, "maxZoom": device?.maxAvailableVideoZoomFactor ?? 1,
                "lensId": device?.uniqueID ?? "", "lenses": availableLenses()]
    }
    private func availableLenses() -> [[String: Any]] {
        let types: [AVCaptureDevice.DeviceType] = [.builtInUltraWideCamera, .builtInWideAngleCamera, .builtInTelephotoCamera, .builtInTrueDepthCamera, .builtInDualCamera, .builtInDualWideCamera, .builtInTripleCamera]
        let devices = AVCaptureDevice.DiscoverySession(deviceTypes: types, mediaType: .video, position: .back).devices +
            AVCaptureDevice.DiscoverySession(deviceTypes: types, mediaType: .video, position: .front).devices
        return devices.map { device in
            let facingDevices = devices.filter { $0.position == device.position }
            let wide = facingDevices.first(where: { $0.deviceType == .builtInWideAngleCamera })?.activeFormat.videoFieldOfView ?? 0
            let field = device.activeFormat.videoFieldOfView
            let radians = Double.pi / 360
            let intrinsic = wide > 0 && field > 0 ? tan(Double(wide) * radians) / tan(Double(field) * radians) : 1.0
            let label = String(format: "%.1fx", intrinsic)
            return ["id": device.uniqueID, "label": label, "facing": device.position == .front ? "user" : "environment", "intrinsicZoom": intrinsic]
        }
    }
    func embeddedSetZoom(_ ratio: CGFloat, completion: @escaping (Result<CGFloat, Error>) -> Void) {
        sessionQueue.async { [weak self] in
            guard let self, let device = self.cameraInput?.device else { completion(.failure(CameraError.unavailable)); return }
            do {
                try device.lockForConfiguration(); defer { device.unlockForConfiguration() }
                let value = min(device.maxAvailableVideoZoomFactor, max(device.minAvailableVideoZoomFactor, ratio))
                device.videoZoomFactor = value
                completion(.success(value))
            } catch { completion(.failure(error)) }
        }
    }
    func embeddedSetLens(_ id: String, completion: @escaping (Result<[String: Any], Error>) -> Void) {
        let types: [AVCaptureDevice.DeviceType] = [.builtInUltraWideCamera, .builtInWideAngleCamera, .builtInTelephotoCamera, .builtInTrueDepthCamera, .builtInDualCamera, .builtInDualWideCamera, .builtInTripleCamera]
        let devices = AVCaptureDevice.DiscoverySession(deviceTypes: types, mediaType: .video, position: .back).devices +
            AVCaptureDevice.DiscoverySession(deviceTypes: types, mediaType: .video, position: .front).devices
        guard state == "ready", let device = devices.first(where: { $0.uniqueID == id }) else { completion(.failure(CameraError.unavailable)); return }
        setState("starting")
        releaseHardwareWhiteBalance()
        sessionQueue.async { [weak self] in
            guard let self else { return }
            self.session.stopRunning(); self.session.beginConfiguration()
            do {
                if let old = self.cameraInput { self.session.removeInput(old) }
                let input = try AVCaptureDeviceInput(device: device)
                guard self.session.canAddInput(input) else { throw CameraError.unavailable }
                self.session.addInput(input); self.cameraInput = input; self.cameraPosition = device.position
                try self.configureDeviceFormat(device)
                let hasPhoto = self.configurePhotoDimensions(for: device)
                self.observeSystemPressure(device); self.session.commitConfiguration(); self.requestOrientationUpdate(); self.session.startRunning()
                DispatchQueue.main.async { self.photoCaptureAvailable = hasPhoto; self.setState("ready"); completion(.success(self.nativeInfo())) }
            } catch { self.session.commitConfiguration(); DispatchQueue.main.async { self.setState("ready"); completion(.failure(error)) } }
        }
    }
    func embeddedSampleFrame() -> [String: Any]? {
        frameLock.lock(); let source = latestSource; frameLock.unlock()
        guard let source else { return nil }
        guard let sample = ClearWaterCameraOrientation.jpegSample(source: source, context: ciContext) else { return nil }
        return ["data": sample.data.base64EncodedString(), "width": sample.width, "height": sample.height]
    }
    func embeddedCapturePhoto() -> Bool {
        guard state == "ready", photoCaptureAvailable, !captureInFlight, !closeRequested, !backgrounded else { return false }
        photoTapped(); return state == "capturing"
    }
    func embeddedStartRecording(maxMs: Int, maxBytes: Int64, microphone: Bool, recipe: [String: Any]) throws {
        guard state == "ready", !closeRequested, !backgrounded else { throw CameraError.unavailable }
        if microphone && AVCaptureDevice.authorizationStatus(for: .audio) != .authorized { throw CameraError.unavailable }
        try setEmbeddedRecipe(recipe)
        audioEnabled = microphone; embeddedCaptureDuration = max(1, Double(maxMs) / 1000); embeddedCaptureBytes = max(1, maxBytes)
        startRecording()
    }
    func embeddedStopRecording(discard: Bool) {
        guard state == "recording" else { return }
        if discard {
            mediaQueue.async { [weak self] in
                guard let self else { return }
                self.writerAcceptingFrames = false
                self.movieWriter?.cancel {
                    if let id = self.captureID { ClearWaterCaptureStore.shared.discardStagedCapture(id: id) }
                    if let url = self.videoURL { try? FileManager.default.removeItem(at: url) }
                    self.mediaQueue.async { self.clearWriter() }
                    DispatchQueue.main.async { self.setState("ready"); self.delegate?.cameraViewController(self, recordingState: "ready") }
                }
            }
        } else { stopRecording(reason: nil) }
    }
    func embeddedStopSession() { closeTapped() }

    @objc private func photoTapped() {
        guard state == "ready", photoCaptureAvailable, !captureInFlight else { return }
        let frozenRecipe = snapshotRecipe()
        captureInFlight = true; photoButton.isEnabled = false; setState("capturing")
        sessionQueue.async {
            self.orientationLocked = true
            let settings = AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.jpeg])
            settings.photoQualityPrioritization = .quality
            settings.maxPhotoDimensions = self.photoOutput.maxPhotoDimensions
            self.recipeLock.lock()
            self.photoRecipes[settings.uniqueID] = frozenRecipe
            self.recipeLock.unlock()
            self.photoOutput.capturePhoto(with: settings, delegate: self)
        }
    }
    func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        autoreleasepool { processPhoto(photo, error: error) }
    }
    func photoOutput(_ output: AVCapturePhotoOutput, didFinishCaptureFor resolvedSettings: AVCaptureResolvedPhotoSettings, error: Error?) {
        guard let error else { return }
        recipeLock.lock()
        let outstanding = photoRecipes.removeValue(forKey: resolvedSettings.uniqueID) != nil
        recipeLock.unlock()
        if outstanding { photoFailed(error) }
    }
    private func processPhoto(_ photo: AVCapturePhoto, error: Error?) {
        recipeLock.lock(); let recipe = photoRecipes.removeValue(forKey: photo.resolvedSettings.uniqueID) ?? currentRecipe; recipeLock.unlock()
        if let error { photoFailed(error); return }
        guard let sourceData = photo.fileDataRepresentation(), let image = CIImage(data: sourceData, options: [.applyOrientationProperty: true]),
              let dims = imageDimensions(image), let enhanced = renderedJPEG(image, sourceData: sourceData, recipe: recipe), let thumb = thumbnail(enhanced) else { photoFailed(CameraError.processing); return }
        let id = ClearWaterCaptureStore.shared.newCaptureID()
        storageQueue.async { [weak self] in
            do {
                let descriptor = try ClearWaterCaptureStore.shared.commitPhoto(id: id, originalData: sourceData, enhancedData: enhanced, thumbnailData: thumb, width: dims.width, height: dims.height, recipe: try NativeBalancedMath.recipeDictionary(recipe))
                DispatchQueue.main.async {
                    guard let self else { return }; self.captureInFlight = false; self.setState("ready")
                    self.savedPhotoCount += 1; self.updateCounters()
                    self.delegate?.cameraViewController(self, didComplete: descriptor)
                    self.unlockCaptureOrientation()
                    if self.closeRequested { self.finishClose(); return }
                    if self.options.saveEnhancedPhotos {
                        self.delegate?.cameraViewController(self, saveCaptureToPhotos: id) { saved, warning in
                            DispatchQueue.main.async {
                                guard !self.closeRequested else { return }
                                if saved {
                                    self.statusLabel.text = self.text("Photo saved to ClearWater and Photos.", "Photo saved to ClearWater and Photos.")
                                    if let warning { self.statusLabel.text?.append(" \(warning)") }
                                } else {
                                    self.statusLabel.text = self.text("Photo saved privately. Photos copy failed; you can retry later.", "Photo saved privately. Photos copy failed; you can retry later.")
                                }
                            }
                        }
                    }
                }
            } catch { self?.photoFailed(error) }
            self?.processor.purgeIntermediatePools()
        }
    }
    private func renderedJPEG(_ image: CIImage, sourceData: Data, recipe: NativeBalancedRecipe) -> Data? {
        guard let dims = imageDimensions(image), let buffer = render(image, recipe: recipe, size: CGSize(width: dims.width, height: dims.height), pool: nil) else { return nil }
        guard let source = CGImageSourceCreateWithData(sourceData as CFData, nil),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any] else { return nil }
        let output = NSMutableData()
        let rendered = CIImage(cvPixelBuffer: buffer)
        let bounds = rendered.extent.integral
        guard let cg = ciContext.createCGImage(rendered, from: bounds, format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!),
              let destination = CGImageDestinationCreateWithData(output, "public.jpeg" as CFString, 1, nil) else { return nil }
        var metadata = properties
        metadata[kCGImagePropertyOrientation] = 1
        metadata[kCGImagePropertyPixelWidth] = dims.width
        metadata[kCGImagePropertyPixelHeight] = dims.height
        metadata[kCGImageDestinationLossyCompressionQuality] = 0.94
        if var tiff = metadata[kCGImagePropertyTIFFDictionary] as? [CFString: Any] {
            tiff[kCGImagePropertyTIFFOrientation] = 1
            metadata[kCGImagePropertyTIFFDictionary] = tiff
        }
        if var exif = metadata[kCGImagePropertyExifDictionary] as? [CFString: Any] {
            exif[kCGImagePropertyExifPixelXDimension] = dims.width
            exif[kCGImagePropertyExifPixelYDimension] = dims.height
            metadata[kCGImagePropertyExifDictionary] = exif
        }
        CGImageDestinationAddImage(destination, cg, metadata as CFDictionary)
        return CGImageDestinationFinalize(destination) ? output as Data : nil
    }
    private func imageDimensions(_ image: CIImage) -> (width: Int, height: Int)? {
        let e = image.extent.integral; guard e.width > 0, e.height > 0 else { return nil }; return (Int(e.width), Int(e.height))
    }
    private func thumbnail(_ jpeg: Data) -> Data? {
        guard let src = CGImageSourceCreateWithData(jpeg as CFData, nil), let cg = CGImageSourceCreateThumbnailAtIndex(src, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: 480] as CFDictionary) else { return nil }
        let data = NSMutableData(); guard let dest = CGImageDestinationCreateWithData(data, "public.jpeg" as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(dest, cg, [kCGImageDestinationLossyCompressionQuality: 0.75] as CFDictionary); return CGImageDestinationFinalize(dest) ? data as Data : nil
    }
    private func photoFailed(_ error: Error) {
        processor.purgeIntermediatePools()
        unlockCaptureOrientation()
        DispatchQueue.main.async { self.captureInFlight = false; self.setState("ready"); self.delegate?.cameraViewController(self, didFail: self.text("Photo could not be saved.", "Photo could not be saved."), captureID: nil); if self.closeRequested { self.finishClose() } }
    }
    @objc private func recordTapped() {
        if state == "recording" { stopRecording(reason: nil); return }
        guard state == "ready" else { return }
        if audioEnabled && AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined {
            AVCaptureDevice.requestAccess(for: .audio) { [weak self] granted in DispatchQueue.main.async { guard let self else { return }; self.setMicrophoneEnabled(granted); self.startRecording() } }
        } else { startRecording() }
    }
    private func startRecording() {
        guard state == "ready", !closeRequested, !backgrounded else { return }
        if audioEnabled && AVCaptureDevice.authorizationStatus(for: .audio) != .authorized { setMicrophoneEnabled(false) }
        setState("startingRecording")
        recipeLock.lock(); let frozenRecipe = currentRecipe; clipRecipe = frozenRecipe; recipeLock.unlock()
        let profile: ClearWaterMovieWriter.QualityProfile = options.quality == "high" ? .high : .standard
        // Session inputs are only changed on sessionQueue. Wait for optional microphone
        // authorization/input setup before constructing the writer on mediaQueue.
        sessionQueue.async { [weak self] in
            guard let self else { return }
            self.orientationLocked = true
            self.clipOrientationAngle = self.captureOrientationAngle
            self.clipWasFrontCamera = self.cameraPosition == .front
            self.session.beginConfiguration()
            if self.audioEnabled, AVCaptureDevice.authorizationStatus(for: .audio) == .authorized {
                do { try self.addAudioIfGranted() } catch { self.audioEnabled = false }
            }
            let withAudio = self.audioEnabled && self.audioInput != nil
            self.session.commitConfiguration()
            self.frameLock.lock()
            let frameSize = self.latestSource?.extent.size
            self.frameLock.unlock()
            let portraitSourceSize: CGSize
            if let frameSize { portraitSourceSize = frameSize }
            else if let device = self.cameraInput?.device {
                let dimensions = CMVideoFormatDescriptionGetDimensions(device.activeFormat.formatDescription)
                portraitSourceSize = CGSize(width: CGFloat(dimensions.height), height: CGFloat(dimensions.width))
            } else { portraitSourceSize = .zero }
            let sourceSize = ClearWaterCameraOrientation.orientedVideoSize(portraitSourceSize, angle: self.clipOrientationAngle)
            self.mediaQueue.async {
                var stagedCaptureID: UUID?
                do {
                    let id = ClearWaterCaptureStore.shared.newCaptureID()
                    stagedCaptureID = id
                    let url = try ClearWaterCaptureStore.shared.makeVideoOutputURL(id: id)
                    let writer = try ClearWaterMovieWriter(outputURL: url, sourceSize: sourceSize, profile: profile, audioEnabled: withAudio,
                        recipe: frozenRecipe, processor: self.processor, maximumDuration: self.embeddedCaptureDuration ?? Double(self.options.minutes * 60), maximumBytes: self.videoByteLimit)
                    try writer.start()
                    if self.closeRequested || self.backgrounded {
                        writer.cancel {
                            ClearWaterCaptureStore.shared.discardStagedCapture(id: id)
                            DispatchQueue.main.async { self.setState("ready"); self.unlockCaptureOrientation(); if self.closeRequested { self.finishClose() } }
                        }
                        return
                    }
                    self.movieWriter = writer; self.writerIncludesAudio = withAudio; self.captureID = id; self.videoURL = url; self.writerAcceptingFrames = true
                    DispatchQueue.main.async {
                        self.setState("recording"); self.recordButton.setImage(UIImage(systemName: "stop.circle.fill"), for: .normal)
                        self.recordingStartedAt = ProcessInfo.processInfo.systemUptime
                        self.updateElapsedTime()
                        self.elapsedTimer?.invalidate()
                        self.elapsedTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.updateElapsedTime() }
                        self.recordButton.accessibilityLabel = self.text("Stop recording", "Stop recording")
                        self.delegate?.cameraViewController(self, recordingState: "recording")
                    }
                } catch {
                    if let stagedCaptureID { ClearWaterCaptureStore.shared.discardStagedCapture(id: stagedCaptureID) }
                    DispatchQueue.main.async {
                        self.delegate?.cameraViewController(self, didFail: self.text("Recording could not start.", "Recording could not start."), captureID: nil)
                        self.setState("ready")
                        self.unlockCaptureOrientation()
                    }
                }
            }
        }
    }
    private func appendAudio(_ sample: CMSampleBuffer) {
        guard writerAcceptingFrames, writerIncludesAudio, let movieWriter else { return }
        do {
            if case .limitReached = try movieWriter.appendAudio(sample) {
                DispatchQueue.main.async { self.stopRecording(reason: nil) }
            }
        }
        catch { DispatchQueue.main.async { self.stopRecordingWithError(self.text("Audio could not be encoded.", "Audio could not be encoded.")) } }
    }
    private func stopRecording(reason: String?) {
        guard state == "recording" else { return }
        pendingRecordingMessage = reason
        setState("finalising"); mediaQueue.async { [weak self] in
            guard let self else { return }
            self.writerAcceptingFrames = false
            self.finishWriter()
        }
    }
    private func stopRecordingWithError(_ message: String) {
        guard state == "recording" else { return }
        delegate?.cameraViewController(self, didFail: message, captureID: nil)
        stopRecording(reason: message)
    }
    private func finishWriter() {
        guard let writer = movieWriter, let url = videoURL, let id = captureID else {
            if closeRequested { DispatchQueue.main.async { self.finishClose() } }
            else { DispatchQueue.main.async { self.setState("ready") } }
            return
        }
        writer.finish { [weak self] result in
            guard let self else { return }
            switch result {
            case .failure(let error):
                self.failStagedVideo(error, id: id, url: url)
                self.mediaQueue.async { self.clearWriter() }
            case .success(let metadata):
                self.mediaQueue.async {
                    let asset = AVURLAsset(url: url), generator = AVAssetImageGenerator(asset: asset)
                    generator.appliesPreferredTrackTransform = true; generator.maximumSize = CGSize(width: 480, height: 480)
                    guard let image = try? generator.copyCGImage(at: .zero, actualTime: nil), let thumbnail = self.jpegThumbnail(image) else {
                        self.failStagedVideo(CameraError.processing, id: id, url: url); self.clearWriter(); return
                    }
                    let editorRecipe = NativeBalancedMath.editorRecipeAfterCapture()
                    self.storageQueue.async {
                        do {
                            let descriptor = try ClearWaterCaptureStore.shared.commitVideo(id: id, outputURL: url,
                                thumbnailData: thumbnail, width: metadata.width, height: metadata.height,
                                duration: metadata.duration, fps: metadata.nominalFrameRate, codec: metadata.codec,
                                recipe: try NativeBalancedMath.recipeDictionary(editorRecipe))
                            DispatchQueue.main.async {
                                self.savedVideoCount += 1; self.updateCounters()
                                self.delegate?.cameraViewController(self, didComplete: descriptor)
                                self.delegate?.cameraViewController(self, recordingState: "ready")
                                self.setState("ready"); self.endBackgroundTask()
                                if let message = self.pendingRecordingMessage { self.statusLabel.text = message }
                                self.pendingRecordingMessage = nil
                                if self.closeRequested { self.finishClose() }
                            }
                        } catch { self.failStagedVideo(error, id: id, url: url) }
                    }
                    self.clearWriter()
                }
            }
        }
    }
    private func jpegThumbnail(_ image: CGImage) -> Data? {
        let output = NSMutableData(); guard let dest = CGImageDestinationCreateWithData(output, "public.jpeg" as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: 0.75] as CFDictionary); return CGImageDestinationFinalize(dest) ? output as Data : nil
    }
    private func failStagedVideo(_ error: Error, id: UUID?, url: URL?) {
        if let id { try? ClearWaterCaptureStore.shared.discardStagedCapture(id: id) }; if let url { try? FileManager.default.removeItem(at: url) }
        DispatchQueue.main.async { self.delegate?.cameraViewController(self, didFail: self.text("Video could not be saved.", "Video could not be saved."), captureID: id); self.delegate?.cameraViewController(self, recordingState: "ready"); self.setState("ready"); self.endBackgroundTask(); if self.closeRequested { self.finishClose() } }
    }
    private func clearWriter() {
        movieWriter = nil; writerAcceptingFrames = false; writerIncludesAudio = false; captureID = nil; videoURL = nil
        recipeLock.lock(); clipRecipe = nil; recipeLock.unlock()
        DispatchQueue.main.async { self.recordingStartedAt = nil; self.elapsedTimer?.invalidate(); self.elapsedTimer = nil }
        unlockCaptureOrientation()
    }
    private func unlockCaptureOrientation() {
        sessionQueue.async { [weak self] in
            guard let self else { return }
            self.orientationLocked = false
            self.requestOrientationUpdate()
        }
    }
    @objc private func closeTapped() {
        guard !closeRequested else { return }
        if captureInFlight { closeRequested = true; return }
        if state == "recording" || state == "startingRecording" || state == "finalising" {
            closeRequested = true
            if state == "recording" { stopRecording(reason: nil) }
            return
        }
        finishClose()
    }
    @objc private func resetTapped() {
        guard state == "ready" else { return }
        releaseHardwareWhiteBalance()
        pickerArmed = false; pickerButton.tintColor = .white
        statusLabel.text = text("White balance reset", "White balance reset")
    }
    private func updateCounters() {
        let format = text("Photos: %d · Videos: %d", "Photos: %d · Videos: %d")
        countersLabel.text = String(format: format, locale: Locale(identifier: options.locale), savedPhotoCount, savedVideoCount)
    }
    private func updateElapsedTime() {
        guard let started = recordingStartedAt else { durationLabel.text = ""; return }
        let seconds = max(0, Int(ProcessInfo.processInfo.systemUptime - started))
        durationLabel.text = String(format: "%02d:%02d", seconds / 60, seconds % 60)
    }
    private func finishClose() {
        closeRequested = true
        guard claimCloseFinish() else { return }
        releaseHardwareWhiteBalance()
        sessionQueue.async { [weak self] in
            guard let self else { return }
            self.session.stopRunning()
            self.videoOutput.setSampleBufferDelegate(nil, queue: nil)
            self.audioOutput.setSampleBufferDelegate(nil, queue: nil)
            self.pressureObservation?.invalidate(); self.pressureObservation = nil
            if self.configured {
                self.session.beginConfiguration()
                for output in self.session.outputs { self.session.removeOutput(output) }
                for input in self.session.inputs { self.session.removeInput(input) }
                self.cameraInput = nil; self.audioInput = nil; self.configured = false
                self.session.commitConfiguration()
            }
            self.mediaQueue.async {
                self.writerAcceptingFrames = false
                self.latestSource = nil; self.latestRendered = nil
                self.previewPool = nil; self.previewPoolSize = nil
                self.recipeLock.lock(); self.photoRecipes.removeAll(); self.recipeLock.unlock()
                DispatchQueue.main.async {
                    self.metalView.isPaused = true; self.metalView.delegate = nil
                    if self.options.embedded {
                        self.willMove(toParent: nil); self.view.removeFromSuperview(); self.removeFromParent()
                        self.delegate?.cameraViewControllerDidClose(self)
                    } else {
                        self.dismiss(animated: true) { self.delegate?.cameraViewControllerDidClose(self) }
                    }
                }
            }
        }
    }
    @objc private func flipTapped() {
        guard state == "ready" else { return }
        setState("starting")
        releaseHardwareWhiteBalance()
        sessionQueue.async { [weak self] in
            guard let self else { return }; self.session.stopRunning(); self.session.beginConfiguration()
            do {
                if let old = self.cameraInput { self.session.removeInput(old) }
                self.cameraPosition = self.cameraPosition == .back ? .front : .back
                let input = try AVCaptureDeviceInput(device: self.selectCamera())
                guard self.session.canAddInput(input) else { throw CameraError.unavailable }
                self.session.addInput(input); self.cameraInput = input; try self.configureDeviceFormat(input.device)
                let hasPhotoCapture = self.configurePhotoDimensions(for: input.device)
                self.observeSystemPressure(input.device)
                self.session.commitConfiguration(); self.requestOrientationUpdate(); self.session.startRunning()
                DispatchQueue.main.async { self.photoCaptureAvailable = hasPhotoCapture; self.setState("ready") }
            } catch { self.session.commitConfiguration(); DispatchQueue.main.async { self.fail(self.text("The selected camera is unavailable.", "The selected camera is unavailable.")) } }
        }
    }
    @objc private func microphoneTapped() {
        guard state == "ready" else { return }
        let enable = !audioEnabled
        if enable && AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined {
            AVCaptureDevice.requestAccess(for: .audio) { [weak self] granted in DispatchQueue.main.async { self?.setMicrophoneEnabled(granted) } }
        } else { setMicrophoneEnabled(enable) }
    }
    private func setMicrophoneEnabled(_ requested: Bool) {
        let enabled = requested && AVCaptureDevice.authorizationStatus(for: .audio) == .authorized
        audioEnabled = enabled; micButton.setImage(UIImage(systemName: enabled ? "mic.fill" : "mic.slash.fill"), for: .normal)
        sessionQueue.async { [weak self] in
            guard let self else { return }; self.session.beginConfiguration()
            if enabled { do { try self.addAudioIfGranted() } catch { self.audioEnabled = false } }
            else if let input = self.audioInput { self.session.removeInput(input); self.session.removeOutput(self.audioOutput); self.audioInput = nil }
            self.session.commitConfiguration()
        }
    }
    @objc private func pickerTapped() {
        guard state == "ready" else { return }; pickerArmed.toggle()
        pickerButton.tintColor = pickerArmed ? .systemYellow : .white
        statusLabel.text = pickerArmed ? text("Drag over a neutral white or grey area.", "Drag over a neutral white or grey area.") : ""
    }
    @objc private func strengthChanged() {
        guard state == "ready" else { return }
        recipeLock.lock(); currentRecipe.strength = Double(strengthSlider.value / 100); recipeLock.unlock()
    }
    @objc private func previewDragged(_ gesture: UIPanGestureRecognizer) {
        guard pickerArmed else { return }
        let point = gesture.location(in: metalView)
        switch gesture.state {
        case .began, .changed:
            if let patch = neutralPatch(at: point) {
                pendingNeutralPatch = patch.data
                if loupeView == nil {
                    let loupe = UIImageView(); loupe.backgroundColor = .black; loupe.layer.borderWidth = 2
                    loupe.layer.borderColor = UIColor.white.cgColor; loupe.layer.cornerRadius = 48
                    loupe.clipsToBounds = true; loupe.contentMode = .scaleAspectFit
                    loupe.frame = CGRect(x: 0, y: 0, width: 96, height: 96); view.addSubview(loupe); loupeView = loupe
                }
                loupeView?.image = patch.image
                loupeView?.center = CGPoint(x: min(max(50, point.x), metalView.bounds.width - 50), y: max(55, point.y - 80))
            }
        case .ended:
            if let patch = pendingNeutralPatch { applyNeutral(patch) }
            pendingNeutralPatch = nil; loupeView?.removeFromSuperview(); loupeView = nil
        case .cancelled, .failed:
            pendingNeutralPatch = nil; loupeView?.removeFromSuperview(); loupeView = nil
        default: break
        }
    }
    private func neutralPatch(at point: CGPoint) -> (data: Data, image: UIImage)? {
        frameLock.lock(); let source = latestSource; frameLock.unlock()
        guard let source else { return nil }
        let extent = source.extent
        let scale = max(metalView.bounds.width / extent.width, metalView.bounds.height / extent.height)
        let offsetX = max(0, (extent.width * scale - metalView.bounds.width) / 2)
        let offsetY = max(0, (extent.height * scale - metalView.bounds.height) / 2)
        let px = extent.minX + (point.x + offsetX) / scale
        let py = extent.maxY - (point.y + offsetY) / scale
        let patchRect = CGRect(x: px - 4, y: py - 4, width: 9, height: 9).intersection(extent)
        guard let cg = ciContext.createCGImage(source.cropped(to: patchRect), from: patchRect) else { return nil }
        let data = NSMutableData(length: 9 * 9 * 4)!
        guard let context = CGContext(data: data.mutableBytes, width: 9, height: 9, bitsPerComponent: 8, bytesPerRow: 9 * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        context.interpolationQuality = .none; context.draw(cg, in: CGRect(x: 0, y: 0, width: 9, height: 9))
        return (data as Data, UIImage(cgImage: cg))
    }
    private func applyNeutral(_ patch: Data) {
        do {
            recipeLock.lock(); let updated = try NativeBalancedMath.pickNeutral(patchRGBA: patch, recipe: currentRecipe); currentRecipe = updated; pickedNeutral = true; recipeLock.unlock()
            statusLabel.text = text("Software white balance applied", "Software white balance applied")
            lockHardwareWhiteBalance { [weak self] locked in
                guard let self, self.pickedNeutral else { return }
                self.hardwareWhiteBalanceLocked = locked
                if locked { self.statusLabel.text = self.text("White balance locked", "White balance locked") }
            }
            pickerArmed = false; pickerButton.tintColor = .white
        } catch { recipeLock.unlock(); delegate?.cameraViewController(self, didFail: text("White balance could not be applied.", "White balance could not be applied."), captureID: nil) }
    }
    private func lockHardwareWhiteBalance(completion: @escaping (Bool) -> Void) {
        sessionQueue.async { [weak self] in
            guard let self, let device = self.cameraInput?.device, device.isWhiteBalanceModeSupported(.locked) else {
                DispatchQueue.main.async { completion(false) }; return
            }
            let locked: Bool
            do {
                try device.lockForConfiguration()
                let gains = device.deviceWhiteBalanceGains
                device.setWhiteBalanceModeLocked(with: gains, completionHandler: nil)
                device.unlockForConfiguration(); locked = true
            } catch { locked = false }
            DispatchQueue.main.async { completion(locked) }
        }
    }
    private func releaseHardwareWhiteBalance() {
        pickedNeutral = false; hardwareWhiteBalanceLocked = false
        recipeLock.lock(); currentRecipe.manual.neutral = [1, 1, 1]; recipeLock.unlock()
        frameLock.lock(); latestSource = nil; latestRendered = nil; frameLock.unlock()
        sessionQueue.async { [weak self] in
            guard let device = self?.cameraInput?.device else { return }
            do { try device.lockForConfiguration(); if device.isWhiteBalanceModeSupported(.continuousAutoWhiteBalance) { device.whiteBalanceMode = .continuousAutoWhiteBalance }; device.unlockForConfiguration() } catch {}
        }
    }
    private func enterBackground() {
        backgrounded = true
        if options.embedded { closeRequested = true; embeddedSessionCloseReason = "background" }
        if state == "recording" {
            backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "ClearWaterFinalizeMovie") { [weak self] in
                guard let self else { return }
                self.mediaQueue.async { self.movieWriter?.cancel { DispatchQueue.main.async { self.endBackgroundTask() } } }
            }
            stopRecording(reason: nil)
        } else if state == "finalising" {
            backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "ClearWaterFinalizeMovie") { [weak self] in
                guard let self else { return }
                self.mediaQueue.async { self.movieWriter?.cancel { DispatchQueue.main.async { self.endBackgroundTask() } } }
            }
        }
        sessionQueue.async { [weak self] in self?.session.stopRunning() }
        releaseHardwareWhiteBalance()
        if options.embedded && !["recording", "capturing", "startingRecording", "finalising"].contains(state) { finishClose() }
    }
    private func enterForeground() { backgrounded = false; restartIfActive() }
    private func endBackgroundTask() {
        guard backgroundTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(backgroundTask); backgroundTask = .invalid
    }
    private func interrupted() {
        let message = text("Camera interrupted.", "Camera interrupted.")
        if options.embedded { closeRequested = true; embeddedSessionCloseReason = "interrupted" }
        if state == "recording" { stopRecordingWithError(text("Recording stopped because the camera was interrupted.", "Recording stopped because the camera was interrupted.")); return }
        if state == "capturing" || state == "startingRecording" || state == "finalising" { statusLabel.text = message; return }
        setState("error"); statusLabel.text = message
        if options.embedded {
            delegate?.cameraViewController(self, didFail: message, captureID: nil)
            finishClose()
        }
    }
    private func restartIfActive() {
        guard !backgrounded, !closeRequested else { return }; releaseHardwareWhiteBalance(); requestCamera()
    }
    private func checkThermalState() {
        if ProcessInfo.processInfo.thermalState == .critical && state == "recording" { stopRecordingWithError(text("Recording stopped because the device is too hot.", "Recording stopped because the device is too hot.")) }
    }
    private func setState(_ value: String) {
        state = value
        if value != "recording" { elapsedTimer?.invalidate(); elapsedTimer = nil; recordingStartedAt = nil; if value != "finalising" { durationLabel.text = "" } }
        switch value {
        case "ready": statusLabel.text = !photoCaptureAvailable ? text("Still capture is unavailable on this camera.", "Still capture is unavailable on this camera.") : (pickedNeutral ? (hardwareWhiteBalanceLocked ? text("White balance locked", "White balance locked") : text("Software white balance applied", "Software white balance applied")) : ""); durationLabel.text = ""
        case "starting": statusLabel.text = text("Starting camera", "Starting camera")
        case "capturing": statusLabel.text = text("Saving photo", "Saving photo")
        case "startingRecording": statusLabel.text = text("Starting recording", "Starting recording")
        case "recording": statusLabel.text = text("Recording", "Recording")
        case "finalising": statusLabel.text = text("Finishing video", "Finishing video")
        default: break
        }
        photoButton.isEnabled = value == "ready" && photoCaptureAvailable && !captureInFlight
        recordButton.isEnabled = value == "ready" || value == "recording"
        pickerButton.isEnabled = value == "ready"; strengthSlider.isEnabled = value == "ready"; resetButton.isEnabled = value == "ready"
        if value != "recording" && value != "finalising" { recordButton.setImage(UIImage(systemName: "record.circle"), for: .normal); recordButton.accessibilityLabel = text("Start recording", "Start recording") }
    }
    private func fail(_ message: String) { setState("error"); statusLabel.text = message; delegate?.cameraViewController(self, didFail: message, captureID: nil) }
    private enum CameraError: Error { case unavailable, processing, writer, cancelled }
}
