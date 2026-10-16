import Capacitor
import AVFoundation
import Photos
import UIKit

@objc(ClearWaterCameraPlugin)
public final class ClearWaterCameraPlugin: CAPPlugin, CAPBridgedPlugin, ClearWaterCameraViewControllerDelegate {
    public let identifier = "ClearWaterCameraPlugin"
    public let jsName = "ClearWaterCamera"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "drainCaptures", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listCaptures", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getCapture", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "acknowledgeCapture", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setCaptureRecipe", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setCaptureVisible", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteCapture", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveCaptureToPhotos", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "shareCapture", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getLaunchMode", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setPreviewBounds", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setCorrection", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listLenses", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setLens", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setZoom", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sampleFrame", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "capturePhoto", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "releaseCapture", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startRecording", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopRecording", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopSession", returnType: CAPPluginReturnPromise)
    ]
    private var cameraController: ClearWaterCameraViewController?
    private var openCall: CAPPluginCall?
    private var activeShare: String?
    private var activeShareURL: URL?
    private var activeShareDirectory: URL?
    private let store = ClearWaterCaptureStore.shared
    private var embeddedController: ClearWaterCameraViewController?
    private var pendingPhotoCall: CAPPluginCall?
    private var pendingRecordingStartCall: CAPPluginCall?
    private var pendingStopSessionCalls: [CAPPluginCall] = []
    private var embeddedRecordingActive = false
    private var previousIdleTimerDisabled: Bool?
    private var previousWebViewOpaque: Bool?
    private var previousWebViewBackground: UIColor?
    private var previousScrollBackground: UIColor?
    private var previousCameraActive: Bool?
    private var launchObserver: NSObjectProtocol?

    public override func load() {
        super.load()
        launchObserver = NotificationCenter.default.addObserver(forName: .clearWaterLaunchMode, object: nil, queue: .main) { [weak self] _ in
            guard let self, self.hasListeners("launchMode"), let mode = ClearWaterLaunchRouting.consume() else { return }
            self.notifyListeners("launchMode", data: ["mode": mode])
        }
    }
    deinit { if let launchObserver { NotificationCenter.default.removeObserver(launchObserver) } }

    @objc func getLaunchMode(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let mode = self.hasListeners("launchMode") ? ClearWaterLaunchRouting.consume() : nil
            call.resolve(["mode": mode as Any? ?? NSNull()])
        }
    }
    @objc func startSession(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.startSessionOnMain(call) }
    }
    private func startSessionOnMain(_ call: CAPPluginCall) {
        guard call.getObject("recipe") != nil, let bounds = cameraBounds(call.getObject("bounds")),
              embeddedController == nil, cameraController == nil, let presenter = bridge?.viewController else {
            call.reject("Camera session options are invalid or a session is already active.", "CAMERA_BUSY"); return
        }
        var settings = call.getObject("settings") ?? [:]
        settings["embedded"] = true
        settings["facing"] = call.getString("facing") ?? "environment"
        settings["quality"] = call.getString("quality") ?? "standard"
        let options = ClearWaterCameraOptions(locale: "en", strings: [:], settings: settings)
        do {
            let controller = try ClearWaterCameraViewController(options: options)
            controller.delegate = self
            try controller.setEmbeddedRecipe(call.getObject("recipe") ?? [:])
            let host = presenter as? CAPBridgeViewController
            let webView = host?.webView
            previousIdleTimerDisabled = UIApplication.shared.isIdleTimerDisabled
            UIApplication.shared.isIdleTimerDisabled = true
            if let webView {
                previousWebViewOpaque = webView.isOpaque
                previousWebViewBackground = webView.backgroundColor
                previousScrollBackground = webView.scrollView.backgroundColor
                webView.isOpaque = false; webView.backgroundColor = .clear; webView.scrollView.backgroundColor = .clear
            }
            if let host = host as? ClearWaterBridgeViewController {
                previousCameraActive = host.cameraActive
                host.cameraActive = true
            }
            presenter.addChild(controller)
            controller.view.frame = bounds
            if let webView { presenter.view.insertSubview(controller.view, belowSubview: webView) }
            else { presenter.view.addSubview(controller.view) }
            controller.didMove(toParent: presenter)
            embeddedController = controller
            controller.embeddedReady { result in
                guard self.embeddedController === controller else { call.reject("Camera start was cancelled.", "CAMERA_CLOSED"); return }
                switch result {
                case .success(let info): call.resolve(info)
                case .failure(let error): controller.embeddedStopSession(); call.reject("The native camera could not start.", "CAMERA_START_FAILED", error)
                }
            }
        } catch { call.reject("Native camera setup failed.", "CAMERA_START_FAILED", error) }
    }
    @objc func setPreviewBounds(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let flatBounds: [String: Any] = ["x": call.getDouble("x") ?? 0, "y": call.getDouble("y") ?? 0,
                "width": call.getDouble("width") ?? 0, "height": call.getDouble("height") ?? 0]
            guard let bounds = self.cameraBounds(flatBounds), let controller = self.embeddedController else { call.reject("No camera session is active.", "CAMERA_CLOSED"); return }
            controller.setEmbeddedBounds(bounds); call.resolve()
        }
    }
    @objc func setCorrection(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            do { guard let recipe = call.getObject("recipe"), let controller = self.embeddedController else { throw PluginError.invalidArgument }
                try controller.setEmbeddedRecipe(recipe); call.resolve()
            } catch { call.reject("Camera correction settings are invalid.", "CAMERA_RECIPE", error) }
        }
    }
    @objc func listLenses(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let controller = self.embeddedController else { call.reject("No camera session is active.", "CAMERA_CLOSED"); return }
            call.resolve(["lenses": controller.embeddedInfo()["lenses"] ?? []])
        }
    }
    @objc func setLens(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let id = call.getString("lensId"), let controller = self.embeddedController else { call.reject("Lens selection is invalid.", "CAMERA_LENS"); return }
            controller.embeddedSetLens(id) { result in
                guard self.embeddedController === controller else { call.reject("Lens change was cancelled.", "CAMERA_CLOSED"); return }
                switch result { case .success(let info): call.resolve(info); case .failure(let error): call.reject("The selected lens is unavailable.", "CAMERA_LENS", error) }
            }
        }
    }
    @objc func setZoom(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let ratio = call.getDouble("ratio"), let controller = self.embeddedController else { call.reject("Zoom setting is invalid.", "CAMERA_ZOOM"); return }
            controller.embeddedSetZoom(CGFloat(ratio)) { result in
                DispatchQueue.main.async {
                    guard self.embeddedController === controller else { call.reject("Zoom change was cancelled.", "CAMERA_CLOSED"); return }
                    switch result { case .success(let value): call.resolve(["zoom": value]); case .failure(let error): call.reject("Zoom could not be changed.", "CAMERA_ZOOM", error) }
                }
            }
        }
    }
    @objc func sampleFrame(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let sample = self.embeddedController?.embeddedSampleFrame() else { call.reject("A camera sample is not ready.", "CAMERA_SAMPLE"); return }
            call.resolve(sample)
        }
    }
    @objc func capturePhoto(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let controller = self.embeddedController, self.pendingPhotoCall == nil else { call.reject("A photo capture is already active or the camera is closed.", "CAMERA_BUSY"); return }
            guard controller.embeddedCapturePhoto() else { call.reject("Photo capture is unavailable until the camera is ready.", "CAMERA_NOT_READY"); return }
            self.pendingPhotoCall = call
        }
    }
    @objc func releaseCapture(_ call: CAPPluginCall) { call.resolve() }
    @objc func startRecording(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let controller = self.embeddedController, let recipe = call.getObject("recipe") else { call.reject("Recording options are invalid.", "RECORDING_START"); return }
            let begin: (Bool) -> Void = { granted in
                guard self.embeddedController === controller else { call.reject("Recording start was cancelled.", "CAMERA_CLOSED"); return }
                guard granted || !(call.getBool("microphone") ?? false) else { call.reject("Microphone permission was not granted.", "AUDIO_PERMISSION"); return }
                guard self.pendingRecordingStartCall == nil else { call.reject("A recording is already starting.", "CAMERA_BUSY"); return }
                do { self.pendingRecordingStartCall = call; try controller.embeddedStartRecording(maxMs: call.getInt("maxMs") ?? 60_000, maxBytes: Int64(call.getInt("maxBytes") ?? 64 * 1024 * 1024), microphone: call.getBool("microphone") ?? false, recipe: recipe) }
                catch { self.pendingRecordingStartCall = nil; call.reject("Recording could not start.", "RECORDING_START", error) }
            }
            if (call.getBool("microphone") ?? false) && AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined {
                AVCaptureDevice.requestAccess(for: .audio) { granted in DispatchQueue.main.async { begin(granted) } }
            } else { begin(AVCaptureDevice.authorizationStatus(for: .audio) == .authorized) }
        }
    }
    @objc func stopRecording(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let controller = self.embeddedController else { call.reject("No camera session is active.", "CAMERA_CLOSED"); return }
            controller.embeddedStopRecording(discard: call.getBool("discard") ?? false); call.resolve()
        }
    }
    @objc func stopSession(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let controller = self.embeddedController else { call.resolve(); return }
            self.pendingStopSessionCalls.append(call); controller.embeddedStopSession()
        }
    }
    private func cameraBounds(_ value: [String: Any]?) -> CGRect? {
        guard let value, let x = (value["x"] as? NSNumber)?.doubleValue, let y = (value["y"] as? NSNumber)?.doubleValue,
              let width = (value["width"] as? NSNumber)?.doubleValue, let height = (value["height"] as? NSNumber)?.doubleValue,
              x.isFinite, y.isFinite, width.isFinite, height.isFinite, width > 0, height > 0 else { return nil }
        return CGRect(x: x, y: y, width: width, height: height)
    }
    private func restoreEmbeddedHost() {
        if let host = bridge?.viewController as? ClearWaterBridgeViewController { host.cameraActive = previousCameraActive ?? false }
        UIApplication.shared.isIdleTimerDisabled = previousIdleTimerDisabled ?? false
        if let webView = (bridge?.viewController as? CAPBridgeViewController)?.webView {
            webView.isOpaque = previousWebViewOpaque ?? true
            webView.backgroundColor = previousWebViewBackground
            webView.scrollView.backgroundColor = previousScrollBackground
        }
        previousIdleTimerDisabled = nil; previousWebViewOpaque = nil; previousWebViewBackground = nil; previousScrollBackground = nil; previousCameraActive = nil
    }

    @objc func open(_ call: CAPPluginCall) {
        guard call.getInt("schemaVersion") == 1 else { call.reject("Unsupported camera bridge schema.", "CAMERA_SCHEMA"); return }
        guard cameraController == nil, embeddedController == nil, let presenter = bridge?.viewController else { call.reject("The camera is already open or unavailable.", "CAMERA_BUSY"); return }
        let suppliedStrings = call.getObject("strings") ?? [:]
        let strings = suppliedStrings.reduce(into: [String: String]()) { if let value = $1.value as? String { $0[$1.key] = value } }
        let options = ClearWaterCameraOptions(locale: call.getString("locale") ?? "en", strings: strings, settings: call.getObject("settings") ?? [:])
        DispatchQueue.main.async {
            do {
                let controller = try ClearWaterCameraViewController(options: options)
                controller.delegate = self; controller.modalPresentationStyle = .fullScreen
                self.cameraController = controller; self.openCall = call
                presenter.present(controller, animated: true)
            } catch { call.reject("Native Balanced camera processing is unavailable on this device.", "CAMERA_PROCESSOR_UNAVAILABLE", error) }
        }
    }
    @objc func drainCaptures(_ call: CAPPluginCall) {
        do { call.resolve(["captures": try store.drainCaptures()]) } catch { call.reject("Could not read camera captures.", "CAPTURE_STORE", error) }
    }
    @objc func listCaptures(_ call: CAPPluginCall) {
        do { call.resolve(["captures": try store.listCaptures()]) } catch { call.reject("Could not read camera captures.", "CAPTURE_STORE", error) }
    }
    @objc func getCapture(_ call: CAPPluginCall) {
        withID(call) { id in
            let capture = try self.store.getCapture(id: id)
            call.resolve(["capture": capture])
        }
    }
    @objc func acknowledgeCapture(_ call: CAPPluginCall) { withID(call) { try self.store.acknowledgeCapture(id: $0); call.resolve() } }
    @objc func setCaptureRecipe(_ call: CAPPluginCall) {
        withID(call) { id in guard let recipe = call.getObject("recipe") else { throw PluginError.invalidArgument }; try self.store.setCaptureRecipe(id: id, recipe: recipe); call.resolve() }
    }
    @objc func setCaptureVisible(_ call: CAPPluginCall) {
        withID(call) { id in guard let visible = call.getBool("visible") else { throw PluginError.invalidArgument }; try self.store.setCaptureVisible(id: id, visible: visible); call.resolve() }
    }
    @objc func deleteCapture(_ call: CAPPluginCall) { withID(call) { try self.store.deleteCapture(id: $0); call.resolve() } }
    @objc func saveCaptureToPhotos(_ call: CAPPluginCall) {
        withID(call) { id in self.saveToPhotos(id: id) { saved, error in
            var result: [String: Any] = ["saved": saved]; if let error { result["error"] = error }; call.resolve(result)
        } }
    }
    @objc func shareCapture(_ call: CAPPluginCall) {
        withID(call) { id in
            guard let variant = call.getString("variant"), ["source", "enhanced"].contains(variant), let presenter = self.bridge?.viewController else { throw PluginError.invalidArgument }
            let capture = try self.store.getCapture(id: id)
            let kind = capture["kind"] as? String
            let originalURL = try variant == "enhanced" && kind == "photo" ? self.store.enhancedPhotoURL(id: id) : self.store.sourceURL(id: id)
            let shareKey = "\(id):\(variant)"; guard self.activeShare == nil else { throw PluginError.shareBusy }
            self.cleanupStaleShareOperations()
            let url = try self.namedShareURL(source: originalURL, id: id, kind: kind ?? "photo", variant: variant)
            self.activeShare = shareKey
            self.activeShareURL = url
            self.activeShareDirectory = url.deletingLastPathComponent()
            DispatchQueue.main.async {
                let activity = UIActivityViewController(activityItems: [url], applicationActivities: nil)
                if let popover = activity.popoverPresentationController { popover.sourceView = presenter.view; popover.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 1, height: 1); popover.permittedArrowDirections = [] }
                activity.completionWithItemsHandler = { type, completed, _, error in
                    self.activeShare = nil
                    if let activeShareDirectory = self.activeShareDirectory { try? FileManager.default.removeItem(at: activeShareDirectory) }
                    self.activeShareURL = nil
                    self.activeShareDirectory = nil
                    if let error { call.reject("The capture could not be shared.", "SHARE_FAILED", error); return }
                    var result: [String: Any] = ["completed": completed]; if let type { result["activityType"] = type.rawValue }; call.resolve(result)
                }
                presenter.present(activity, animated: true)
            }
        }
    }
    /// Give share providers a stable, user-facing filename without loading media into RAM.
    /// A per-operation directory makes crash leftovers safe to clean on the next share.
    private func namedShareURL(source: URL, id: String, kind: String, variant: String) throws -> URL {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("ClearWaterShare", isDirectory: true)
        let directory = root.appendingPathComponent(UUID().uuidString.lowercased(), isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let suffix = kind == "photo" && variant == "source" ? "_original" : ""
        let destination = directory.appendingPathComponent("ClearWater_\(id)\(suffix).\(source.pathExtension)")
        do { try FileManager.default.linkItem(at: source, to: destination) }
        catch {
            do { try FileManager.default.copyItem(at: source, to: destination) }
            catch { try? FileManager.default.removeItem(at: directory); throw error }
        }
        return destination
    }
    private func cleanupStaleShareOperations() {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("ClearWaterShare", isDirectory: true)
        guard let items = try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil) else { return }
        for item in items { try? FileManager.default.removeItem(at: item) }
    }
    private func withID(_ call: CAPPluginCall, body: @escaping (String) throws -> Void) {
        guard let id = call.getString("id"), UUID(uuidString: id) != nil else { call.reject("A valid capture ID is required.", "INVALID_CAPTURE_ID"); return }
        do { try body(id.lowercased()) } catch { call.reject("The capture operation failed.", "CAPTURE_STORE", error) }
    }
    private func saveToPhotos(id: String, completion: @escaping (Bool, String?) -> Void) {
        let authorized: (PHAuthorizationStatus) -> Void = { status in
            guard status == .authorized || status == .limited else { completion(false, "Photos permission was not granted."); return }
            do {
                let capture = try self.store.getCapture(id: id)
                let url = try (capture["kind"] as? String) == "video" ? self.store.sourceURL(id: id) : self.store.enhancedPhotoURL(id: id)
                PHPhotoLibrary.shared().performChanges({
                    if capture["kind"] as? String == "video" { PHAssetChangeRequest.creationRequestForAssetFromVideo(atFileURL: url) }
                    else { PHAssetChangeRequest.creationRequestForAssetFromImage(atFileURL: url) }
                }) { success, error in
                    guard success else { completion(false, error?.localizedDescription ?? "Photos could not save the capture."); return }
                    do { try self.store.markPhotosSaved(id: id); completion(true, nil) }
                    catch { completion(true, "The Photos copy was saved, but its private saved status could not be updated.") }
                }
            } catch { completion(false, "The enhanced photo is unavailable.") }
        }
        let status = PHPhotoLibrary.authorizationStatus(for: .addOnly)
        if status == .notDetermined { PHPhotoLibrary.requestAuthorization(for: .addOnly, handler: authorized) } else { authorized(status) }
    }
    func cameraViewController(_ controller: ClearWaterCameraViewController, didComplete descriptor: [String: Any]) {
        guard controller === embeddedController || controller === cameraController else { return }
        if controller === embeddedController, let id = descriptor["id"] as? String,
           let kind = descriptor["kind"] as? String,
           let url = try? store.sourceURL(id: id) {
            var result: [String: Any] = ["iosCaptureId": id, "uri": url.absoluteString,
                "name": descriptor["name"] ?? url.lastPathComponent, "type": descriptor["type"] ?? (kind == "photo" ? "image/jpeg" : "video/mp4"),
                "width": descriptor["width"] ?? 0, "height": descriptor["height"] ?? 0]
            if kind == "photo" {
                if let pendingPhotoCall { pendingPhotoCall.resolve(result); self.pendingPhotoCall = nil }
            } else {
                embeddedRecordingActive = false
                if let duration = descriptor["duration"] { result["duration"] = duration }
                notifyListeners("recordingFinished", data: result, retainUntilConsumed: true)
            }
            notifyListeners("captureCompleted", data: descriptor, retainUntilConsumed: true)
            return
        }
        notifyListeners("captureCompleted", data: descriptor, retainUntilConsumed: true)
    }
    func cameraViewController(_ controller: ClearWaterCameraViewController, didFail message: String, captureID: UUID?) {
        guard controller === embeddedController || controller === cameraController else { return }
        var data: [String: Any] = ["message": message]; if let captureID { data["id"] = captureID.uuidString.lowercased() }
        notifyListeners("captureError", data: data, retainUntilConsumed: true)
        if controller === embeddedController {
            notifyListeners("cameraError", data: ["message": message], retainUntilConsumed: true)
            pendingPhotoCall?.reject(message, "CAMERA_CAPTURE_FAILED"); pendingPhotoCall = nil
            pendingRecordingStartCall?.reject(message, "RECORDING_START"); pendingRecordingStartCall = nil
            if embeddedRecordingActive {
                notifyListeners("recordingFinished", data: ["error": message], retainUntilConsumed: true)
                embeddedRecordingActive = false
            }
        }
    }
    func cameraViewController(_ controller: ClearWaterCameraViewController, recordingState: String) {
        guard controller === embeddedController || controller === cameraController else { return }
        notifyListeners("recordingState", data: ["state": recordingState])
        if controller === embeddedController, recordingState == "recording" {
            embeddedRecordingActive = true
            pendingRecordingStartCall?.resolve(); pendingRecordingStartCall = nil
        } else if controller === embeddedController, recordingState == "ready", embeddedRecordingActive {
            notifyListeners("recordingFinished", data: ["discarded": true], retainUntilConsumed: true)
            embeddedRecordingActive = false
        }
    }
    func cameraViewController(_ controller: ClearWaterCameraViewController, saveCaptureToPhotos id: UUID, completion: @escaping (Bool, String?) -> Void) {
        guard controller === embeddedController || controller === cameraController else { completion(false, "Camera session is closed."); return }
        saveToPhotos(id: id.uuidString.lowercased(), completion: completion)
    }
    func cameraViewControllerDidClose(_ controller: ClearWaterCameraViewController) {
        guard controller === embeddedController || controller === cameraController else { return }
        if controller === embeddedController {
            let closeReason = controller.embeddedSessionCloseReason
            embeddedController = nil; restoreEmbeddedHost()
            pendingPhotoCall?.reject("Camera session closed.", "CAMERA_CLOSED"); pendingPhotoCall = nil
            pendingRecordingStartCall?.reject("Camera session closed.", "CAMERA_CLOSED"); pendingRecordingStartCall = nil
            pendingStopSessionCalls.forEach { $0.resolve() }; pendingStopSessionCalls.removeAll()
            if let closeReason {
                notifyListeners("cameraError", data: ["message": "Camera session ended.", "sessionClosed": true, "reason": closeReason], retainUntilConsumed: true)
            }
        }
        cameraController = nil; openCall?.resolve(); openCall = nil
    }
    private enum PluginError: Error { case invalidArgument, shareBusy, captureMissing }
}
