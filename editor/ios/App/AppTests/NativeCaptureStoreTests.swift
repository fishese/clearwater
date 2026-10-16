import Foundation
import XCTest
@testable import App

final class NativeCaptureStoreTests: XCTestCase {
    private func temporaryRoot() throws -> URL {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("ClearWaterCaptureStoreTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root
    }

    private func commitPhoto(_ store: ClearWaterCaptureStore) throws -> UUID {
        try store.commitPhoto(id: UUID(), originalData: Data([1, 2, 3]), enhancedData: Data([4, 5, 6]),
                              thumbnailData: Data([7, 8]), width: 2, height: 1, recipe: [:])
        let descriptor = try XCTUnwrap(try store.listCaptures().first)
        return try XCTUnwrap(UUID(uuidString: descriptor["id"] as? String ?? ""))
    }

    func testCommittedDirectoryRecoversWhenManifestIsMissingOrCorrupt() throws {
        let root = try temporaryRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let store = ClearWaterCaptureStore(rootURL: root)
        _ = try commitPhoto(store)
        try Data("not json".utf8).write(to: root.appendingPathComponent("manifest.json"), options: .atomic)

        let recovered = ClearWaterCaptureStore(rootURL: root)
        let captures = try recovered.listCaptures()
        XCTAssertEqual(captures.count, 1)
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent("manifest.json").path))
    }

    func testInterruptedDeleteRollsBackWhenManifestStillContainsCapture() throws {
        let root = try temporaryRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let store = ClearWaterCaptureStore(rootURL: root)
        let id = try commitPhoto(store).uuidString.lowercased()
        let original = root.appendingPathComponent(id, isDirectory: true)
        let deleting = root.appendingPathComponent(".deleting-\(id)", isDirectory: true)
        try FileManager.default.moveItem(at: original, to: deleting)

        let recovered = ClearWaterCaptureStore(rootURL: root)
        XCTAssertEqual(try recovered.listCaptures().count, 1)
        XCTAssertTrue(FileManager.default.fileExists(atPath: original.appendingPathComponent("original.jpg").path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: deleting.path))
    }

    func testInterruptedDeleteRollsBackWhenManifestIsCorrupt() throws {
        let root = try temporaryRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let store = ClearWaterCaptureStore(rootURL: root)
        let id = try commitPhoto(store).uuidString.lowercased()
        let original = root.appendingPathComponent(id, isDirectory: true)
        let deleting = root.appendingPathComponent(".deleting-\(id)", isDirectory: true)
        try FileManager.default.moveItem(at: original, to: deleting)
        try Data("not json".utf8).write(to: root.appendingPathComponent("manifest.json"), options: .atomic)

        let recovered = ClearWaterCaptureStore(rootURL: root)
        XCTAssertEqual(try recovered.listCaptures().map { $0["id"] as? String }, [id])
        XCTAssertTrue(FileManager.default.fileExists(atPath: original.appendingPathComponent("original.jpg").path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: deleting.path))
    }

    func testMovedCaptureRecoversWhenManifestCommitFails() throws {
        let root = try temporaryRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let injected = ClearWaterCaptureStore(rootURL: root, faultInjector: { stage in
            if stage == "beforeManifestWrite" { throw NSError(domain: "capture-store-test", code: 1) }
        })
        XCTAssertThrowsError(try injected.commitPhoto(id: UUID(), originalData: Data([1]), enhancedData: Data([2]),
                                                      thumbnailData: Data([3]), width: 1, height: 1, recipe: [:]))

        let recovered = ClearWaterCaptureStore(rootURL: root)
        XCTAssertEqual(try recovered.listCaptures().count, 1)
    }

    func testUnknownStagingDirectoryIsQuarantinedRatherThanDeleted() throws {
        let root = try temporaryRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let id = UUID().uuidString.lowercased()
        let stage = root.appendingPathComponent(".staging-\(id)", isDirectory: true)
        try FileManager.default.createDirectory(at: stage, withIntermediateDirectories: true)
        try Data([42]).write(to: stage.appendingPathComponent("unknown.bin"))

        XCTAssertTrue(try ClearWaterCaptureStore(rootURL: root).listCaptures().isEmpty)
        let quarantine = root.appendingPathComponent("Quarantine", isDirectory: true)
        let items = try FileManager.default.contentsOfDirectory(at: quarantine, includingPropertiesForKeys: nil)
        XCTAssertEqual(items.count, 1)
        XCTAssertTrue(FileManager.default.fileExists(atPath: items[0].appendingPathComponent("unknown.bin").path))
    }
}
