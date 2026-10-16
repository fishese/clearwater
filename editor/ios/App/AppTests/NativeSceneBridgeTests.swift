import XCTest
import UIKit
import WebKit
import CoreImage
import ImageIO
@testable import App

final class NativeSceneBridgeTests: XCTestCase {
    func testCameraSamplePreservesRawColoursAspectAndJPEGFormat() throws {
        let space = try XCTUnwrap(CGColorSpace(name: CGColorSpace.sRGB))
        let context = CIContext(options: [.workingColorSpace: space, .outputColorSpace: space])
        let blue = CIImage(color: CIColor(red: 0, green: 0, blue: 1)).cropped(to: CGRect(x: 0, y: 0, width: 720, height: 640))
        let red = CIImage(color: CIColor(red: 1, green: 0, blue: 0)).cropped(to: CGRect(x: 0, y: 640, width: 720, height: 640))
        let source = red.composited(over: blue)
        let sample = try XCTUnwrap(ClearWaterCameraOrientation.jpegSample(source: source, context: context))
        XCTAssertEqual(sample.width, 144)
        XCTAssertEqual(sample.height, 256)
        XCTAssertEqual(Array(sample.data.prefix(2)), [0xff, 0xd8])
        let decoded = try XCTUnwrap(CIImage(data: sample.data))
        XCTAssertEqual(decoded.extent.size, CGSize(width: 144, height: 256))
        var upper = [UInt8](repeating: 0, count: 4), lower = upper
        upper.withUnsafeMutableBytes { context.render(decoded, toBitmap: $0.baseAddress!, rowBytes: 4,
            bounds: CGRect(x: 72, y: 200, width: 1, height: 1), format: .RGBA8, colorSpace: space) }
        lower.withUnsafeMutableBytes { context.render(decoded, toBitmap: $0.baseAddress!, rowBytes: 4,
            bounds: CGRect(x: 72, y: 40, width: 1, height: 1), format: .RGBA8, colorSpace: space) }
        XCTAssertGreaterThan(upper[0], 240)
        XCTAssertLessThan(upper[2], 15)
        XCTAssertGreaterThan(lower[2], 240)
        XCTAssertLessThan(lower[0], 15)
        XCTAssertEqual(ClearWaterCameraOrientation.sampleSize(width: 1920, height: 1080), CGSize(width: 256, height: 144))
        XCTAssertEqual(ClearWaterCameraOrientation.sampleSize(width: 80, height: 120), CGSize(width: 80, height: 120))
    }

    func testLandscapeMovieDimensionsAndFrontUnmirroring() throws {
        let sourceSize = CGSize(width: 720, height: 1280)
        for angle in [CGFloat(0), CGFloat(180)] {
            XCTAssertEqual(ClearWaterCameraOrientation.orientedVideoSize(sourceSize, angle: angle), CGSize(width: 1280, height: 720))
        }
        for angle in [CGFloat(90), CGFloat(270)] {
            XCTAssertEqual(ClearWaterCameraOrientation.orientedVideoSize(sourceSize, angle: angle), sourceSize)
        }
        let red = CIImage(color: CIColor(red: 1, green: 0, blue: 0)).cropped(to: CGRect(x: 0, y: 0, width: 30, height: 120))
        let blue = CIImage(color: CIColor(red: 0, green: 0, blue: 1)).cropped(to: CGRect(x: 30, y: 0, width: 30, height: 120))
        let source = red.composited(over: blue)
        let unmirrored = ClearWaterCameraOrientation.orientedCaptureImage(source, angle: 90, mirrored: true)
        let space = try XCTUnwrap(CGColorSpace(name: CGColorSpace.sRGB))
        let context = CIContext(options: [.workingColorSpace: space, .outputColorSpace: space])
        var left = [UInt8](repeating: 0, count: 4)
        left.withUnsafeMutableBytes { context.render(unmirrored, toBitmap: $0.baseAddress!, rowBytes: 4,
            bounds: CGRect(x: 15, y: 60, width: 1, height: 1), format: .RGBA8, colorSpace: space) }
        XCTAssertGreaterThan(left[2], 240)
        XCTAssertLessThan(left[0], 15)
        XCTAssertEqual(ClearWaterCameraOrientation.orientedCaptureImage(source, angle: 0, mirrored: false).extent.size, CGSize(width: 120, height: 60))
    }

    func testPhysicalOrientationMappingIsIndependentOfPortraitControls() {
        XCTAssertEqual(ClearWaterCameraOrientation.angleDegrees(for: .portrait), 90)
        XCTAssertEqual(ClearWaterCameraOrientation.angleDegrees(for: .portraitUpsideDown), 270)
        XCTAssertEqual(ClearWaterCameraOrientation.angleDegrees(for: .landscapeLeft), 0)
        XCTAssertEqual(ClearWaterCameraOrientation.angleDegrees(for: .landscapeRight), 180)
        XCTAssertNil(ClearWaterCameraOrientation.angleDegrees(for: .faceUp))
        XCTAssertNil(ClearWaterCameraOrientation.angleDegrees(for: .unknown))
        XCTAssertEqual(ClearWaterCameraOrientation.exifOrientation(fromPortraitAngle: 90), 1)
        XCTAssertEqual(ClearWaterCameraOrientation.exifOrientation(fromPortraitAngle: 270), 3)
    }

    func testLaunchURLParsing() throws {
        XCTAssertEqual(ClearWaterLaunchRouting.mode(for: try XCTUnwrap(URL(string: "clearwater://camera"))), "camera")
        XCTAssertEqual(ClearWaterLaunchRouting.mode(for: try XCTUnwrap(URL(string: "clearwater://edit/"))), "edit")
        XCTAssertNil(ClearWaterLaunchRouting.mode(for: try XCTUnwrap(URL(string: "https://camera"))))
        XCTAssertNil(ClearWaterLaunchRouting.mode(for: try XCTUnwrap(URL(string: "clearwater://camera/unexpected"))))
        XCTAssertNil(ClearWaterLaunchRouting.mode(for: try XCTUnwrap(URL(string: "clearwater://unknown"))))
    }

    @MainActor
    func testConnectedSceneRegistersAndUsesExportAndCameraPlugins() async throws {
        let deadline = Date().addingTimeInterval(30)
        var bridgeController: ClearWaterBridgeViewController?
        while Date() < deadline {
            bridgeController = UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .flatMap(\.windows)
                .filter { $0.isKeyWindow && !$0.isHidden }
                .compactMap { $0.rootViewController as? ClearWaterBridgeViewController }
                .first
            if bridgeController != nil { break }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        let controller = try XCTUnwrap(bridgeController, "The active scene must use ClearWaterBridgeViewController.")
        let webView = try XCTUnwrap(controller.bridge?.webView, "The Capacitor WebView must be connected.")
        XCTAssertFalse(controller.view === webView, "Native preview views need a UIKit host around the Capacitor WebView.")
        XCTAssertTrue(webView.superview === controller.view, "The connected WebView must be a child of the native host.")

        // Exercise the real scene's geometry conversion with an inset WebView,
        // as happens when the viewport begins below the status/safe-area region.
        controller.view.layoutIfNeeded()
        let topConstraint = try XCTUnwrap(controller.view.constraints.first {
            ($0.firstItem as? UIView) === webView && $0.firstAttribute == .top
        }, "The host must constrain the WebView to its own coordinate space.")
        let bottomConstraint = try XCTUnwrap(controller.view.constraints.first {
            ($0.firstItem as? UIView) === webView && $0.firstAttribute == .bottom
        })
        let originalTop = topConstraint.constant, originalBottom = bottomConstraint.constant
        defer {
            topConstraint.constant = originalTop
            bottomConstraint.constant = originalBottom
            controller.view.layoutIfNeeded()
        }
        topConstraint.constant = 31
        bottomConstraint.constant = -19
        controller.view.layoutIfNeeded()
        let cssBounds = CGRect(x: 17, y: 23, width: 101, height: 79)
        let nativeBounds = try XCTUnwrap(controller.nativeFrame(forWebViewBounds: cssBounds))
        XCTAssertEqual(nativeBounds.origin.x, cssBounds.origin.x, accuracy: 0.5)
        XCTAssertEqual(nativeBounds.origin.y, cssBounds.origin.y + 31, accuracy: 0.5)
        let preview = UIView(frame: nativeBounds)
        controller.view.insertSubview(preview, belowSubview: webView)
        XCTAssertLessThan(controller.view.subviews.firstIndex(of: preview)!, controller.view.subviews.firstIndex(of: webView)!,
            "The native preview must sit behind, not above, the actual WebView layer.")
        preview.removeFromSuperview()

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

        // Exercise Capacitor's real custom-scheme media transport. MP4 without a Range
        // header uses URLResponse (status 0 in fetch); Range selects HTTP 206 instead.
        let store = ClearWaterCaptureStore.shared
        let videoID = store.newCaptureID()
        let staged = try store.makeVideoOutputURL(id: videoID)
        try Data([0, 1, 2, 255]).write(to: staged)
        let video = try store.commitVideo(id: videoID, outputURL: staged, thumbnailData: Data([1]),
            width: 2, height: 2, duration: 1, fps: 30, codec: "h264", recipe: ["version": 1, "engine": "balanced"])
        defer { try? store.deleteCapture(id: videoID.uuidString.lowercased()) }
        let videoURLJSON = String(data: try JSONSerialization.data(withJSONObject: [video["sourceUrl"]!]), encoding: .utf8)!

        let script = #"""
        void (async () => {
          try {
            const bridge = window.Capacitor;
            if (!bridge.isPluginAvailable('ClearWaterCamera')) throw new Error('Native camera plugin was not registered');
            const launch = await bridge.nativePromise('ClearWaterCamera', 'getLaunchMode', {});
            if (launch.mode !== null && launch.mode !== 'edit' && launch.mode !== 'camera') throw new Error('Invalid camera launch routing');
            await bridge.nativePromise('ClearWaterCamera', 'stopSession', {});
            await bridge.nativePromise('ClearWaterCamera', 'stopSession', {});
            const inventory = await bridge.nativePromise('ClearWaterCamera', 'listCaptures', {});
            if (!Array.isArray(inventory.captures)) throw new Error('Invalid native capture inventory');
            for (const capture of inventory.captures) {
              if (capture.schemaVersion !== 1 || capture.recipeVersion !== 1) throw new Error('Unsupported capture schema');
            }
            const mediaURL = \#(videoURLJSON)[0];
            const mediaResponse = await fetch(bridge.convertFileSrc(mediaURL), {headers: {Range: 'bytes=0-'}});
            if (!mediaResponse.ok || mediaResponse.status !== 206) throw new Error('Private MP4 range transport failed: ' + mediaResponse.status);
            const mediaBytes = new Uint8Array(await mediaResponse.arrayBuffer());
            if (mediaBytes.length !== 4 || mediaBytes[0] !== 0 || mediaBytes[3] !== 255) throw new Error('Private MP4 byte integrity failed');
            const pending = await bridge.nativePromise('ClearWaterCamera', 'drainCaptures', {});
            if (!Array.isArray(pending.captures)) throw new Error('Invalid pending capture inventory');
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
