import UIKit
import Capacitor

@objc(ClearWaterExportPlugin)
public class ClearWaterExportPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ClearWaterExportPlugin"
    public let jsName = "ClearWaterExport"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "beginExport", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeExportChunk", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finishExport", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "shareExport", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "discardExport", returnType: CAPPluginReturnPromise)
    ]

    private static let maximumBytes = 512 * 1024 * 1024
    private static let maximumChunkBytes = 256 * 1024

    private struct WriteSession {
        let partialURL: URL
        let fileHandle: FileHandle
        let expectedBytes: Int
        let fileExtension: String
        let outputBaseName: String
        var receivedBytes: Int = 0
    }

    private let stateLock = NSLock()
    private var writes: [String: WriteSession] = [:]
    private var readyExports: [String: URL] = [:]
    private var activeShareID: String?

    private var exportDirectory: URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("ClearWaterExports", isDirectory: true)
    }

    public override func load() {
        super.load()
        // This directory is exclusively for transient share-sheet exports. A previous
        // process may have been killed while the activity controller was open.
        try? FileManager.default.removeItem(at: exportDirectory)
        try? FileManager.default.createDirectory(at: exportDirectory, withIntermediateDirectories: true)
    }

    @objc func beginExport(_ call: CAPPluginCall) {
        guard let size = call.getInt("size"), size > 0, size <= Self.maximumBytes else {
            let suppliedType = call.getString("type") ?? ""
            let code = suppliedType.hasPrefix("video/") ? "too-large" : "photo-too-large"
            let actual = call.getInt("size") ?? 0
            let token = "cw-limit/\(code)/bytes/\(max(0, actual))/\(Self.maximumBytes)"
            NSLog("ClearWaterExport %@", token)
            call.reject(token)
            return
        }
        guard let type = call.getString("type"),
              let fileExtension = Self.extensions[type] else {
            call.reject("This file type cannot be shared.")
            return
        }
        let suppliedName = call.getString("name") ?? "ClearWater-Export"
        let component = URL(fileURLWithPath: suppliedName).lastPathComponent
        let rawBaseName = String((component as NSString).deletingPathExtension.prefix(100))
        let safeScalars = rawBaseName.unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) && $0 != "/" && $0 != "\\" }
        let baseName = String(String.UnicodeScalarView(safeScalars))
        let safeBaseName = baseName.isEmpty ? "ClearWater-Export" : baseName

        let id = UUID().uuidString.lowercased()
        let itemDirectory = exportDirectory.appendingPathComponent(id, isDirectory: true)
        let partialURL = itemDirectory.appendingPathComponent("export.partial", isDirectory: false)
        do {
            try FileManager.default.createDirectory(at: itemDirectory, withIntermediateDirectories: true)
            guard FileManager.default.createFile(atPath: partialURL.path, contents: nil) else {
                try? FileManager.default.removeItem(at: itemDirectory)
                call.reject("Could not create a temporary photo export.")
                return
            }
            let handle = try FileHandle(forWritingTo: partialURL)
            stateLock.lock()
            writes[id] = WriteSession(partialURL: partialURL, fileHandle: handle, expectedBytes: size,
                                      fileExtension: fileExtension,
                                      outputBaseName: safeBaseName)
            stateLock.unlock()
            call.resolve(["id": id])
        } catch {
            try? FileManager.default.removeItem(at: itemDirectory)
            call.reject("Could not prepare the photo export.", "EXPORT_IO", error)
        }
    }

    @objc func writeExportChunk(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let encoded = call.getString("data"),
              encoded.utf8.count <= ((Self.maximumChunkBytes + 2) / 3) * 4,
              let data = Data(base64Encoded: encoded), !data.isEmpty,
              data.count <= Self.maximumChunkBytes else {
            call.reject("The photo export chunk is invalid.")
            return
        }

        stateLock.lock()
        guard var session = writes[id] else {
            stateLock.unlock()
            call.reject("The photo export is no longer available.")
            return
        }
        guard session.receivedBytes + data.count <= session.expectedBytes else {
            stateLock.unlock()
            call.reject("The photo export exceeds its declared size.")
            return
        }
        do {
            try session.fileHandle.write(contentsOf: data)
            session.receivedBytes += data.count
            writes[id] = session
            stateLock.unlock()
            call.resolve()
        } catch {
            writes.removeValue(forKey: id)
            stateLock.unlock()
            try? session.fileHandle.close()
            try? FileManager.default.removeItem(at: session.partialURL.deletingLastPathComponent())
            call.reject("Could not write the temporary photo export.", "EXPORT_IO", error)
        }
    }

    @objc func finishExport(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("The photo export ID is missing.")
            return
        }
        let abort = call.getBool("abort") ?? false
        stateLock.lock()
        guard let session = writes.removeValue(forKey: id) else {
            stateLock.unlock()
            // Abort is intentionally idempotent so JS cleanup can race a failed write.
            if abort { call.resolve(); return }
            call.reject("The photo export is no longer available.")
            return
        }
        stateLock.unlock()

        do {
            try session.fileHandle.close()
            if abort {
                try? FileManager.default.removeItem(at: session.partialURL.deletingLastPathComponent())
                call.resolve()
                return
            }
            guard session.receivedBytes == session.expectedBytes else {
                try? FileManager.default.removeItem(at: session.partialURL.deletingLastPathComponent())
                call.reject("The photo export was incomplete.")
                return
            }
            let finalName = "\(session.outputBaseName).\(session.fileExtension)"
            let finalURL = session.partialURL.deletingLastPathComponent().appendingPathComponent(finalName, isDirectory: false)
            try FileManager.default.moveItem(at: session.partialURL, to: finalURL)
            stateLock.lock()
            readyExports[id] = finalURL
            stateLock.unlock()
            call.resolve()
        } catch {
            try? FileManager.default.removeItem(at: session.partialURL.deletingLastPathComponent())
            call.reject("Could not finalize the photo export.", "EXPORT_IO", error)
        }
    }

    @objc func shareExport(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("The photo export ID is missing.")
            return
        }
        stateLock.lock()
        let url = readyExports[id]
        guard let url, FileManager.default.fileExists(atPath: url.path) else {
            stateLock.unlock()
            call.reject("The photo export is no longer available.")
            return
        }
        guard activeShareID == nil else {
            stateLock.unlock()
            call.reject("Another share sheet is already open.")
            return
        }
        activeShareID = id
        stateLock.unlock()
        guard let presenter = bridge?.viewController else {
            cleanup(id: id)
            call.reject("Could not open the iOS share sheet.")
            return
        }

        DispatchQueue.main.async {
            let activity = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            if let popover = activity.popoverPresentationController {
                popover.sourceView = presenter.view
                popover.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 1, height: 1)
                popover.permittedArrowDirections = []
            }
            activity.completionWithItemsHandler = { [weak self] activityType, completed, _, error in
                self?.cleanup(id: id)
                if let error {
                    call.reject("The photo could not be shared.", "SHARE_FAILED", error)
                    return
                }
                var result: [String: Any] = ["completed": completed]
                if let activityType { result["activityType"] = activityType.rawValue }
                call.resolve(result)
            }
            self.topViewController(from: presenter).present(activity, animated: true)
        }
    }

    @objc func discardExport(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else { call.resolve(); return }
        cleanup(id: id)
        call.resolve()
    }

    private func topViewController(from controller: UIViewController) -> UIViewController {
        if let presented = controller.presentedViewController { return topViewController(from: presented) }
        return controller
    }

    private func cleanup(id: String) {
        stateLock.lock()
        let session = writes.removeValue(forKey: id)
        let url = readyExports.removeValue(forKey: id)
        if activeShareID == id { activeShareID = nil }
        stateLock.unlock()
        if let session {
            try? session.fileHandle.close()
            try? FileManager.default.removeItem(at: session.partialURL.deletingLastPathComponent())
        }
        let itemDirectory = exportDirectory.appendingPathComponent(id, isDirectory: true).standardizedFileURL
        if let url, url.deletingLastPathComponent().standardizedFileURL == itemDirectory {
            try? FileManager.default.removeItem(at: itemDirectory)
        } else if session != nil {
            try? FileManager.default.removeItem(at: itemDirectory)
        }
    }

    private static let extensions: [String: String] = [
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/heic": "heic",
        "image/heif": "heif",
        "image/dng": "dng",
        "image/x-adobe-dng": "dng",
        "video/mp4": "mp4",
        "video/quicktime": "mov",
        "application/json": "json"
    ]
}
