import XCTest
import UIKit
@testable import App

final class NativeLaunchRoutingTests: XCTestCase {
    private func clearPendingLaunchRequest() {
        while ClearWaterLaunchRouting.consume() != nil {}
    }

    private func observeLaunchModes(_ body: () async throws -> Void) async rethrows -> [String] {
        var modes: [String] = []
        let observer = NotificationCenter.default.addObserver(
            forName: .clearWaterLaunchMode,
            object: nil,
            queue: nil
        ) { notification in
            if let mode = notification.userInfo?["mode"] as? String {
                modes.append(mode)
            }
        }
        defer { NotificationCenter.default.removeObserver(observer) }
        try await body()
        return modes
    }

    func testHomeScreenQuickActionsMatchLaunchRoutes() throws {
        let items = try XCTUnwrap(Bundle.main.object(forInfoDictionaryKey: "UIApplicationShortcutItems") as? [[String: String]])
        XCTAssertEqual(items.count, 2)
        XCTAssertEqual(items.compactMap { $0["UIApplicationShortcutItemType"] },
                       [ClearWaterLaunchRouting.cameraShortcutType, ClearWaterLaunchRouting.editShortcutType])
        XCTAssertEqual(items.compactMap { $0["UIApplicationShortcutItemTitle"] }.count, 2)

        for (type, expectedMode) in [(ClearWaterLaunchRouting.cameraShortcutType, "camera"),
                                     (ClearWaterLaunchRouting.editShortcutType, "edit")] {
            let item = UIApplicationShortcutItem(type: type, localizedTitle: "Test")
            XCTAssertEqual(ClearWaterLaunchRouting.mode(for: item), expectedMode)
        }
        XCTAssertNil(ClearWaterLaunchRouting.mode(for: UIApplicationShortcutItem(type: "unknown", localizedTitle: "Test")))
    }

    func testURLAndSingleConsumerQueue() throws {
        XCTAssertEqual(ClearWaterLaunchRouting.mode(for: try XCTUnwrap(URL(string: "clearwater://camera"))), "camera")
        XCTAssertEqual(ClearWaterLaunchRouting.mode(for: try XCTUnwrap(URL(string: "clearwater://edit/"))), "edit")
        XCTAssertNil(ClearWaterLaunchRouting.mode(for: try XCTUnwrap(URL(string: "clearwater://camera/extra"))))

        var requests = ClearWaterLaunchRequestQueue()
        XCTAssertNil(requests.consume())
        requests.enqueue("camera")
        XCTAssertEqual(requests.consume(), "camera")
        XCTAssertNil(requests.consume())
        requests.enqueue("camera")
        requests.enqueue("edit")
        XCTAssertEqual(requests.consume(), "edit", "The most recent launch request wins while the WebView starts.")
        XCTAssertNil(requests.consume())
    }

    func testAcceptPostsNotificationAndQueuesExactlyOneURLDelivery() async throws {
        clearPendingLaunchRequest()
        let url = try XCTUnwrap(URL(string: "clearwater://camera"))
        let modes = await observeLaunchModes {
            XCTAssertTrue(ClearWaterLaunchRouting.accept(url))
        }

        XCTAssertEqual(modes, ["camera"])
        XCTAssertEqual(ClearWaterLaunchRouting.consume(), "camera")
        XCTAssertNil(ClearWaterLaunchRouting.consume())
    }

    func testAcceptPostsNotificationAndQueuesExactlyOneQuickActionDelivery() async {
        clearPendingLaunchRequest()
        let item = UIApplicationShortcutItem(type: ClearWaterLaunchRouting.editShortcutType, localizedTitle: "Open Editor")
        let modes = await observeLaunchModes {
            XCTAssertTrue(ClearWaterLaunchRouting.accept(item))
        }

        XCTAssertEqual(modes, ["edit"])
        XCTAssertEqual(ClearWaterLaunchRouting.consume(), "edit")
        XCTAssertNil(ClearWaterLaunchRouting.consume())
    }

    func testCameraAppIntentPerformPostsAndQueuesSingleDelivery() async throws {
        clearPendingLaunchRequest()
        let modes = try await observeLaunchModes {
            _ = try await OpenClearWaterCameraIntent().perform()
        }

        XCTAssertEqual(modes, ["camera"])
        XCTAssertEqual(ClearWaterLaunchRouting.consume(), "camera")
        XCTAssertNil(ClearWaterLaunchRouting.consume())
    }

    func testEditorAppIntentPerformPostsAndQueuesSingleDelivery() async throws {
        clearPendingLaunchRequest()
        let modes = try await observeLaunchModes {
            _ = try await OpenClearWaterEditorIntent().perform()
        }

        XCTAssertEqual(modes, ["edit"])
        XCTAssertEqual(ClearWaterLaunchRouting.consume(), "edit")
        XCTAssertNil(ClearWaterLaunchRouting.consume())
    }
}
