import XCTest
import UIKit
import WebKit
@testable import App

final class NativeSceneBridgeTests: XCTestCase {
    @MainActor
    func testConnectedSceneRegistersAndUsesExportPlugin() async throws {
        let deadline = Date().addingTimeInterval(30)
        var bridgeController: ClearWaterBridgeViewController?
        while Date() < deadline {
            bridgeController = UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .flatMap(\.windows)
                .compactMap { $0.rootViewController as? ClearWaterBridgeViewController }
                .first
            if bridgeController != nil { break }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        let controller = try XCTUnwrap(bridgeController, "The active scene must use ClearWaterBridgeViewController.")
        let webView = try XCTUnwrap(controller.bridge?.webView, "The Capacitor WebView must be connected.")

        var available = false
        let readyDeadline = Date().addingTimeInterval(30)
        while Date() < readyDeadline {
            if let value = try? await evaluate("window.Capacitor?.isPluginAvailable('ClearWaterExport') === true", in: webView),
               let result = value as? Bool, result {
                available = true
                break
            }
            try await Task.sleep(nanoseconds: 200_000_000)
        }
        XCTAssertTrue(available, "The running WebView must report the registered ClearWaterExport plugin.")

        let script = #"""
        void (async () => {
          try {
            const bridge = window.Capacitor;
            const {id} = await bridge.nativePromise('ClearWaterExport', 'beginExport', {
              name: 'clearwater-bridge-test.json', type: 'application/json', size: 4
            });
            await bridge.nativePromise('ClearWaterExport', 'writeExportChunk', {id, data: 'dGVzdA=='});
            await bridge.nativePromise('ClearWaterExport', 'finishExport', {id, abort: false});
            await bridge.nativePromise('ClearWaterExport', 'discardExport', {id});
            document.documentElement.dataset.clearwaterBridgeTransaction = 'passed';
          } catch (error) {
            document.documentElement.dataset.clearwaterBridgeTransaction = 'failed:' + String(error);
          }
        })();
        void 0;
        """#
        _ = try await evaluate(script, in: webView)

        var transaction: String?
        let transactionDeadline = Date().addingTimeInterval(15)
        while Date() < transactionDeadline {
            transaction = try await evaluate("document.documentElement.dataset.clearwaterBridgeTransaction || ''", in: webView) as? String
            if let transaction, !transaction.isEmpty { break }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        XCTAssertEqual(transaction, "passed", "The native plugin must complete a begin/write/finish/discard transaction.")
    }

    @MainActor
    private func evaluate(_ script: String, in webView: WKWebView) async throws -> Any? {
        try await withCheckedThrowingContinuation { continuation in
            webView.evaluateJavaScript(script) { value, error in
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: value) }
            }
        }
    }
}
