import UIKit
import Capacitor
import UniformTypeIdentifiers

@objc(ClearWaterExportPlugin)
public class ClearWaterExportPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "ClearWaterExportPlugin"
    public let jsName = "ClearWaterExport"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "beginExport", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeExportChunk", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finishExport", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "shareExport", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "discardExport", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "chooseBatchFolder", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveBatchExport", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "releaseBatchFolder", returnType: CAPPluginReturnPromise)
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
    private var batchFolder: (id: String, url: URL)?
    private var pendingFolderCall: CAPPluginCall?

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

    /// Folder access is scoped to the current batch and never exposes a path to JS.
    @objc func chooseBatchFolder(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.pendingFolderCall == nil, let presenter = self.bridge?.viewController else {
                call.reject("Could not open the output folder.")
                return
            }
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder], asCopy: false)
            picker.allowsMultipleSelection = false
            picker.delegate = self
            self.pendingFolderCall = call
            self.topViewController(from: presenter).present(picker, animated: true)
        }
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let call = pendingFolderCall else { return }
        pendingFolderCall = nil
        guard let url = urls.first, url.startAccessingSecurityScopedResource() else {
            call.reject("Could not access the output folder.")
            return
        }
        stateLock.lock()
        let previous = batchFolder
        let id = UUID().uuidString.lowercased()
        batchFolder = (id, url)
        stateLock.unlock()
        previous?.url.stopAccessingSecurityScopedResource()
        call.resolve(["id": id, "name": url.lastPathComponent])
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        guard let call = pendingFolderCall else { return }
        pendingFolderCall = nil
        call.reject("Folder selection cancelled.", "CANCELLED")
    }

    /// Copy a staged photo under a unique name. FileManager.copyItem never
    /// replaces an existing destination, including when another app races us.
    @objc func saveBatchExport(_ call: CAPPluginCall) {
        guard let folderID = call.getString("folderId"), let exportID = call.getString("id"),
              let name = call.getString("name"), Self.validBatchName(name) else {
            call.reject("This file name cannot be saved.")
            return
        }
        DispatchQueue.global(qos: .userInitiated).async { [self] in
        stateLock.lock()
        guard let folder = batchFolder, folder.id == folderID, let source = readyExports[exportID] else {
            stateLock.unlock(); call.reject("The output folder or photo is no longer available."); return
        }
        var coordinationError: NSError?
        var result: Result<String, Error> = .failure(NSError(domain: NSCocoaErrorDomain, code: NSFileWriteUnknownError))
        let coordinator = NSFileCoordinator(filePresenter: nil)
        coordinator.coordinate(writingItemAt: folder.url, options: .forMerging, error: &coordinationError) { directory in
            result = Result { try Self.copyBatchFile(source: source, directory: directory, name: name) }
        }
        stateLock.unlock()
        if let coordinationError { call.reject("Could not save to the selected folder.", "EXPORT_IO", coordinationError); return }
        switch result {
        case .success(let name): call.resolve(["name": name])
        case .failure(let error): call.reject("Could not save to the selected folder.", "EXPORT_IO", error)
        }
        }
    }

    static func validBatchName(_ name: String) -> Bool {
        !name.isEmpty && name != "." && name != ".." && name.utf8.count <= 220 &&
        name == URL(fileURLWithPath: name).lastPathComponent &&
        !name.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) || $0 == "\\" })
    }

    static func copyBatchFile(source: URL, directory: URL, name: String) throws -> String {
        guard validBatchName(name) else { throw NSError(domain: NSCocoaErrorDomain, code: NSFileWriteInvalidFileNameError) }
        let ext = (name as NSString).pathExtension, stem = (name as NSString).deletingPathExtension
        for index in 0..<10000 {
            let suffix = index == 0 ? "" : " (\(index))"
            let candidate = ext.isEmpty ? "\(stem)\(suffix)" : "\(stem)\(suffix).\(ext)"
            do { try FileManager.default.copyItem(at: source, to: directory.appendingPathComponent(candidate)); return candidate }
            catch {
                let nsError = error as NSError
                if nsError.domain == NSCocoaErrorDomain && nsError.code == NSFileWriteFileExistsError { continue }
                throw error
            }
        }
        throw NSError(domain: NSCocoaErrorDomain, code: NSFileWriteFileExistsError)
    }

    @objc func releaseBatchFolder(_ call: CAPPluginCall) {
        let id = call.getString("id")
        stateLock.lock()
        let folder = batchFolder?.id == id ? batchFolder : nil
        if folder != nil { batchFolder = nil }
        stateLock.unlock()
        folder?.url.stopAccessingSecurityScopedResource()
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
        "application/json": "json",
        "application/zip": "zip"
    ]
}
