import Capacitor
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
        CAPPluginMethod(name: "shareCapture", returnType: CAPPluginReturnPromise)
    ]
    private var cameraController: ClearWaterCameraViewController?
    private var openCall: CAPPluginCall?
    private var activeShare: String?
    private var activeShareURL: URL?
    private var activeShareDirectory: URL?
    private let store = ClearWaterCaptureStore.shared

    @objc func open(_ call: CAPPluginCall) {
        guard call.getInt("schemaVersion") == 1 else { call.reject("Unsupported camera bridge schema.", "CAMERA_SCHEMA"); return }
        guard cameraController == nil, let presenter = bridge?.viewController else { call.reject("The camera is already open or unavailable.", "CAMERA_BUSY"); return }
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
        notifyListeners("captureCompleted", data: descriptor, retainUntilConsumed: true)
    }
    func cameraViewController(_ controller: ClearWaterCameraViewController, didFail message: String, captureID: UUID?) {
        var data: [String: Any] = ["message": message]; if let captureID { data["id"] = captureID.uuidString.lowercased() }
        notifyListeners("captureError", data: data, retainUntilConsumed: true)
    }
    func cameraViewController(_ controller: ClearWaterCameraViewController, recordingState: String) {
        notifyListeners("recordingState", data: ["state": recordingState])
    }
    func cameraViewController(_ controller: ClearWaterCameraViewController, saveCaptureToPhotos id: UUID, completion: @escaping (Bool, String?) -> Void) {
        saveToPhotos(id: id.uuidString.lowercased(), completion: completion)
    }
    func cameraViewControllerDidClose(_ controller: ClearWaterCameraViewController) {
        cameraController = nil; openCall?.resolve(); openCall = nil
    }
    private enum PluginError: Error { case invalidArgument, shareBusy, captureMissing }
}
