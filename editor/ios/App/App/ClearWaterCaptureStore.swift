import Foundation

/// Durable app-private storage for native camera captures. Photos-library entries
/// are never identified or modified here; a Photos save is only recorded as a boolean.
final class ClearWaterCaptureStore {
    static let shared = ClearWaterCaptureStore()

    private struct Record: Codable, Equatable {
        var id: String
        var kind: String
        var name: String
        var type: String
        var width: Int
        var height: Int
        var bytes: Int
        var addedAt: Double
        var recipeVersion: Int
        var recipeData: Data
        var visible: Bool
        var pending: Bool
        var photosSaved: Bool
        var duration: Double?
        var fps: Double?
        var codec: String?
    }

    private let lock = NSRecursiveLock()
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()
    private var records: [String: Record] = [:]
    private var loaded = false
    private var manifestWasReadable = false

    private let rootURL: URL?
    private let faultInjector: ((String) throws -> Void)?
    private var root: URL {
        rootURL ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("ClearWater/Captures", isDirectory: true)
    }

    private var manifestURL: URL { root.appendingPathComponent("manifest.json") }

    init(rootURL: URL? = nil, faultInjector: ((String) throws -> Void)? = nil) {
        self.rootURL = rootURL
        self.faultInjector = faultInjector
        encoder.outputFormatting = [.sortedKeys]
    }

    func newCaptureID() -> UUID { UUID() }

    private func uniqueCaptureName(date: Date, extension ext: String) -> String {
        let existing = Set(records.values.map(\.name))
        var suffix = 0
        while true {
            let candidate = CaptureFilename.format(date: date, extension: ext, collisionSuffix: suffix)
            if !existing.contains(candidate) { return candidate }
            suffix += 1
        }
    }

    /// Commits photo original, enhanced retry copy, and thumbnail as one directory rename.
    func commitPhoto(id: UUID, originalData: Data, enhancedData: Data, thumbnailData: Data,
                     width: Int, height: Int, recipe: [String: Any], capturedAt: Date = Date()) throws -> [String: Any] {
        lock.lock(); defer { lock.unlock() }
        try ensureLoaded()
        let key = id.uuidString.lowercased()
        if let existing = records[key] { return try descriptor(for: existing) }
        guard !originalData.isEmpty, !enhancedData.isEmpty, !thumbnailData.isEmpty,
              originalData.count <= 512 * 1024 * 1024, enhancedData.count <= 512 * 1024 * 1024,
              thumbnailData.count <= 5 * 1024 * 1024, width > 0, height > 0, width <= 8192, height <= 8192 else { throw StoreError.invalidCapture }
        let recipeData = try encodeRecipe(recipe)
        let stage = try makeStageDirectory(id: key, kind: "photo")
        do {
            try originalData.write(to: stage.appendingPathComponent("original.jpg"), options: .atomic)
            try enhancedData.write(to: stage.appendingPathComponent("enhanced.jpg"), options: .atomic)
            try thumbnailData.write(to: stage.appendingPathComponent("thumbnail.jpg"), options: .atomic)
            let record = Record(id: key, kind: "photo", name: uniqueCaptureName(date: capturedAt, extension: "jpg"), type: "image/jpeg",
                                width: width, height: height, bytes: originalData.count,
                                addedAt: Date().timeIntervalSince1970 * 1000, recipeVersion: 1,
                                recipeData: recipeData, visible: true, pending: true, photosSaved: false,
                                duration: nil, fps: nil, codec: nil)
            try writeRecord(record, into: stage)
            try FileManager.default.moveItem(at: stage, to: captureDirectory(id: key))
            try faultInjector?("afterCaptureMove")
            records[key] = record
            try writeManifest()
            return try descriptor(for: record)
        } catch {
            try? FileManager.default.removeItem(at: stage)
            throw error
        }
    }

    /// Returns an empty staged URL for AVAssetWriter. Nothing becomes visible until commitVideo succeeds.
    func makeVideoOutputURL(id: UUID) throws -> URL {
        lock.lock(); defer { lock.unlock() }
        try ensureLoaded()
        let key = id.uuidString.lowercased()
        if records[key] != nil { throw StoreError.duplicateCapture }
        let stage = try makeStageDirectory(id: key, kind: "video")
        return stage.appendingPathComponent("recording.mp4", isDirectory: false)
    }

    func discardStagedCapture(id: UUID) {
        lock.lock(); defer { lock.unlock() }
        let key = id.uuidString.lowercased(), stage = stageDirectory(id: id.uuidString.lowercased())
        guard hasValidIntent(at: stage, id: key) else { return }
        try? FileManager.default.removeItem(at: stage)
    }

    /// Commits the already-enhanced MP4 only; no uncorrected video source is retained.
    func commitVideo(id: UUID, outputURL: URL, thumbnailData: Data, width: Int, height: Int,
                     duration: Double, fps: Double, codec: String, recipe: [String: Any], capturedAt: Date = Date()) throws -> [String: Any] {
        lock.lock(); defer { lock.unlock() }
        try ensureLoaded()
        let key = id.uuidString.lowercased()
        if let existing = records[key] { return try descriptor(for: existing) }
        guard width > 0, height > 0, width <= 8192, height <= 8192, duration > 0, duration <= 300,
              fps > 0, fps <= 120, !thumbnailData.isEmpty, thumbnailData.count <= 5 * 1024 * 1024,
              outputURL.standardizedFileURL.deletingLastPathComponent() == stageDirectory(id: key).standardizedFileURL,
              FileManager.default.fileExists(atPath: outputURL.path) else { throw StoreError.invalidCapture }
        let recipeData = try encodeRecipe(recipe)
        let stage = stageDirectory(id: key)
        do {
            let movieURL = stage.appendingPathComponent("enhanced.mp4")
            try FileManager.default.moveItem(at: outputURL, to: movieURL)
            try thumbnailData.write(to: stage.appendingPathComponent("thumbnail.jpg"), options: .atomic)
            let attributes = try FileManager.default.attributesOfItem(atPath: movieURL.path)
            let size = (attributes[.size] as? NSNumber)?.intValue ?? 0
            guard size > 0, size <= 512 * 1024 * 1024 else { throw StoreError.invalidCapture }
            let record = Record(id: key, kind: "video", name: uniqueCaptureName(date: capturedAt, extension: "mp4"), type: "video/mp4",
                                width: width, height: height, bytes: size,
                                addedAt: Date().timeIntervalSince1970 * 1000, recipeVersion: 1,
                                recipeData: recipeData, visible: true, pending: true, photosSaved: false,
                                duration: duration, fps: fps, codec: codec)
            try writeRecord(record, into: stage)
            try FileManager.default.moveItem(at: stage, to: captureDirectory(id: key))
            try faultInjector?("afterCaptureMove")
            records[key] = record
            try writeManifest()
            return try descriptor(for: record)
        } catch {
            try? FileManager.default.removeItem(at: stage)
            throw error
        }
    }

    func listCaptures() throws -> [[String: Any]] {
        lock.lock(); defer { lock.unlock() }
        try ensureLoaded()
        return try records.values.sorted { $0.addedAt > $1.addedAt }.map(descriptor(for:))
    }

    func getCapture(id: String) throws -> [String: Any] {
        lock.lock(); defer { lock.unlock() }
        try ensureLoaded()
        guard let record = records[try validatedID(id)] else { throw StoreError.captureNotFound }
        return try descriptor(for: record)
    }

    func drainCaptures() throws -> [[String: Any]] {
        lock.lock(); defer { lock.unlock() }
        try ensureLoaded()
        return try records.values.filter { $0.pending && $0.visible }.sorted { $0.addedAt > $1.addedAt }.map(descriptor(for:))
    }

    func acknowledgeCapture(id: String) throws {
        lock.lock(); defer { lock.unlock() }
        try ensureLoaded()
        guard var record = records[try validatedID(id)] else { return }
        if !record.pending { return }
        record.pending = false
        try update(record)
    }

    func setCaptureRecipe(id: String, recipe: [String: Any]) throws {
        lock.lock(); defer { lock.unlock() }
        try ensureLoaded()
        guard var record = records[try validatedID(id)] else { throw StoreError.captureNotFound }
        record.recipeData = try encodeRecipe(recipe)
        record.recipeVersion = 1
        try update(record)
    }

    func setCaptureVisible(id: String, visible: Bool) throws {
        lock.lock(); defer { lock.unlock() }
        try ensureLoaded()
        guard var record = records[try validatedID(id)] else { throw StoreError.captureNotFound }
        if record.visible == visible && (visible || !record.pending) { return }
        record.visible = visible
        if !visible { record.pending = false }
        try update(record)
    }

    /// Explicit private-source deletion. This never touches Photos-library content.
    func deleteCapture(id: String) throws {
        lock.lock(); defer { lock.unlock() }
        try ensureLoaded()
        let key = try validatedID(id)
        guard records[key] != nil else { return }
        let source = captureDirectory(id: key)
        let deleting = root.appendingPathComponent(".deleting-\(key)", isDirectory: true)
        if FileManager.default.fileExists(atPath: source.path) {
            try FileManager.default.moveItem(at: source, to: deleting)
        }
        let previous = records.removeValue(forKey: key)
        do {
            try writeManifest()
            try? FileManager.default.removeItem(at: deleting)
        } catch {
            records[key] = previous
            if FileManager.default.fileExists(atPath: deleting.path) { try? FileManager.default.moveItem(at: deleting, to: source) }
            throw error
        }
    }

    func enhancedPhotoURL(id: String) throws -> URL {
        lock.lock(); defer { lock.unlock() }
        try ensureLoaded()
        guard let record = records[try validatedID(id)], record.kind == "photo" else { throw StoreError.captureNotFound }
        return captureDirectory(id: record.id).appendingPathComponent("enhanced.jpg")
    }

    func sourceURL(id: String) throws -> URL {
        lock.lock(); defer { lock.unlock() }
        try ensureLoaded()
        guard let record = records[try validatedID(id)] else { throw StoreError.captureNotFound }
        let file = record.kind == "photo" ? "original.jpg" : "enhanced.mp4"
        return captureDirectory(id: record.id).appendingPathComponent(file)
    }

    func markPhotosSaved(id: String) throws {
        lock.lock(); defer { lock.unlock() }
        try ensureLoaded()
        guard var record = records[try validatedID(id)] else { throw StoreError.captureNotFound }
        if record.photosSaved { return }
        record.photosSaved = true
        try update(record)
    }

    private func update(_ record: Record) throws {
        try writeRecord(record, into: captureDirectory(id: record.id))
        records[record.id] = record
        try writeManifest()
    }

    private func ensureLoaded() throws {
        if loaded { return }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        var rootValues = URLResourceValues()
        rootValues.isExcludedFromBackup = true
        var rootURL = root
        try? rootURL.setResourceValues(rootValues)
        if let data = try? Data(contentsOf: manifestURL), let stored = try? decoder.decode([String: Record].self, from: data) {
            manifestWasReadable = true
            // Manifest data is untrusted input. Only canonical UUID keys that match
            // their record may ever be used to construct a filesystem path.
            records = stored.filter { key, record in
                guard let uuid = UUID(uuidString: key) else { return false }
                return uuid.uuidString.lowercased() == key.lowercased() && record.id == key.lowercased()
            }
        }
        var changed = false
        let entries = (try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: [.isDirectoryKey])) ?? []
        for entry in entries {
            let name = entry.lastPathComponent
            if name.hasPrefix(".staging-") {
                let id = String(name.dropFirst(".staging-".count))
                if hasValidIntent(at: entry, id: id) { try? FileManager.default.removeItem(at: entry) }
                else { quarantine(entry) }
                continue
            }
            if name.hasPrefix(".deleting-") {
                let id = String(name.dropFirst(".deleting-".count))
                guard let uuid = UUID(uuidString: id), uuid.uuidString.lowercased() == id else { quarantine(entry); continue }
                let final = captureDirectory(id: id)
                if records[id] != nil {
                    // The manifest still owns this record, so the delete did not commit.
                    if !FileManager.default.fileExists(atPath: final.path) { try? FileManager.default.moveItem(at: entry, to: final) }
                } else if manifestWasReadable {
                    // A readable manifest explicitly excludes this ID, so deletion committed.
                    try? FileManager.default.removeItem(at: entry)
                } else if !FileManager.default.fileExists(atPath: final.path),
                          let data = try? Data(contentsOf: entry.appendingPathComponent("record.json")),
                          let record = try? decoder.decode(Record.self, from: data), record.id == id {
                    // With a missing or corrupt manifest, a valid staged record is
                    // recoverable evidence that deletion had not committed.
                    do {
                        try FileManager.default.moveItem(at: entry, to: final)
                        records[id] = record
                        changed = true
                    } catch { quarantine(entry) }
                } else {
                    quarantine(entry)
                }
                continue
            }
            guard let uuid = UUID(uuidString: name),
                  let data = try? Data(contentsOf: entry.appendingPathComponent("record.json")),
                  let record = try? decoder.decode(Record.self, from: data),
                  record.id == uuid.uuidString.lowercased() else { continue }
            if records[name] != record { records[name] = record; changed = true }
        }
        if changed { try writeManifest() }
        loaded = true
    }

    private func makeStageDirectory(id: String, kind: String) throws -> URL {
        let url = stageDirectory(id: id)
        guard !FileManager.default.fileExists(atPath: url.path), !FileManager.default.fileExists(atPath: captureDirectory(id: id).path) else {
            throw StoreError.duplicateCapture
        }
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: false)
        let intent: [String: String] = ["id": id, "kind": kind, "state": "writing"]
        let data = try JSONSerialization.data(withJSONObject: intent, options: [.sortedKeys])
        try data.write(to: url.appendingPathComponent("intent.json"), options: .atomic)
        return url
    }

    private func hasValidIntent(at directory: URL, id: String) -> Bool {
        guard let data = try? Data(contentsOf: directory.appendingPathComponent("intent.json")),
              let intent = try? JSONSerialization.jsonObject(with: data) as? [String: String] else { return false }
        return intent["id"] == id && ["photo", "video"].contains(intent["kind"] ?? "") && intent["state"] == "writing"
    }

    private func quarantine(_ entry: URL) {
        let directory = root.appendingPathComponent("Quarantine", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let target = directory.appendingPathComponent(UUID().uuidString.lowercased(), isDirectory: true)
        try? FileManager.default.moveItem(at: entry, to: target)
    }

    private func stageDirectory(id: String) -> URL { root.appendingPathComponent(".staging-\(id)", isDirectory: true) }
    private func captureDirectory(id: String) -> URL { root.appendingPathComponent(id, isDirectory: true) }

    private func validatedID(_ id: String) throws -> String {
        guard let uuid = UUID(uuidString: id) else { throw StoreError.invalidID }
        return uuid.uuidString.lowercased()
    }

    private func encodeRecipe(_ recipe: [String: Any]) throws -> Data {
        guard JSONSerialization.isValidJSONObject(recipe) else { throw StoreError.invalidRecipe }
        return try JSONSerialization.data(withJSONObject: recipe, options: [.sortedKeys])
    }

    private func writeRecord(_ record: Record, into directory: URL) throws {
        try encoder.encode(record).write(to: directory.appendingPathComponent("record.json"), options: .atomic)
    }

    private func writeManifest() throws {
        try faultInjector?("beforeManifestWrite")
        try encoder.encode(records).write(to: manifestURL, options: .atomic)
        try faultInjector?("afterManifestWrite")
    }

    private func descriptor(for record: Record) throws -> [String: Any] {
        let directory = captureDirectory(id: record.id)
        guard let recipe = try JSONSerialization.jsonObject(with: record.recipeData) as? [String: Any] else { throw StoreError.invalidRecipe }
        var result: [String: Any] = [
            "schemaVersion": 1, "id": record.id, "kind": record.kind, "name": record.name, "type": record.type,
            "sourceUrl": (directory.appendingPathComponent(record.kind == "photo" ? "original.jpg" : "enhanced.mp4")).absoluteString,
            "thumbnailUrl": directory.appendingPathComponent("thumbnail.jpg").absoluteString,
            "width": record.width, "height": record.height, "bytes": record.bytes,
            "addedAt": record.addedAt, "recipeVersion": record.recipeVersion, "recipe": recipe,
            "visible": record.visible, "pending": record.pending, "photosSaved": record.photosSaved
        ]
        if record.kind == "photo" { result["enhancedUrl"] = directory.appendingPathComponent("enhanced.jpg").absoluteString }
        if let duration = record.duration { result["duration"] = duration }
        if let fps = record.fps { result["fps"] = fps }
        if let codec = record.codec { result["codec"] = codec }
        return result
    }

    private enum StoreError: Error {
        case invalidID, invalidCapture, invalidRecipe, duplicateCapture, captureNotFound
    }
}
