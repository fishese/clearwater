import Capacitor
import UIKit
import WebKit

/// Forwards Capacitor's navigation delegate and reports a web-content termination as an out-of-memory notice.
final class WebContentTerminationProxy: NSObject, WKNavigationDelegate {
    weak var forward: WKNavigationDelegate?
    var pendingMemoryNotice = false

    // WebKit caches optional delegate capabilities. Keep all Capacitor policy,
    // authentication and lifecycle callbacks visible through this proxy.
    override func responds(to selector: Selector!) -> Bool {
        super.responds(to: selector) || (forward?.responds(to: selector) ?? false)
    }

    override func forwardingTarget(for selector: Selector!) -> Any? {
        if forward?.responds(to: selector) == true { return forward }
        return super.forwardingTarget(for: selector)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        NSLog("ClearWater web content process terminated")
        pendingMemoryNotice = true
        if forward?.responds(to: #selector(WKNavigationDelegate.webViewWebContentProcessDidTerminate(_:))) == true {
            // Capacitor resets its bridge and reloads; avoid issuing a second reload.
            forward?.webViewWebContentProcessDidTerminate?(webView)
        } else {
            webView.reload()
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        forward?.webView?(webView, didFinish: navigation)
        guard pendingMemoryNotice else { return }
        deliverMemoryNotice(webView, attempt: 0)
    }

    private func deliverMemoryNotice(_ webView: WKWebView, attempt: Int) {
        guard pendingMemoryNotice else { return }
        webView.evaluateJavaScript("window.__clearwaterMemoryReady ? window.__clearwaterMemoryReady() : false") { [weak self, weak webView] result, error in
            if let error { NSLog("ClearWater memory notice failed: %@", String(describing: error)) }
            let handled = (result as? Bool) == true || (result as? NSNumber)?.boolValue == true
            if handled { self?.pendingMemoryNotice = false; return }
            guard attempt < 40, let self, let webView else { return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { self.deliverMemoryNotice(webView, attempt: attempt + 1) }
        }
    }
}

class ClearWaterBridgeViewController: CAPBridgeViewController {
    private let webTerminationProxy = WebContentTerminationProxy()
    var cameraActive = false {
        didSet {
            if #available(iOS 16.0, *) {
                setNeedsUpdateOfSupportedInterfaceOrientations()
                view.window?.windowScene?.requestGeometryUpdate(.iOS(interfaceOrientations: cameraActive ? .portrait : super.supportedInterfaceOrientations))
            } else { UIViewController.attemptRotationToDeviceOrientation() }
        }
    }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask {
        cameraActive ? .portrait : super.supportedInterfaceOrientations
    }

    /// Capacitor 8 installs the WKWebView as the controller's entire root view.
    /// Native preview siblings therefore cannot be placed beneath web content
    /// until the WebView lives inside a real UIView host.
    override func viewDidLoad() {
        super.viewDidLoad()
        guard let webView else { return }
        let host = UIView(frame: webView.frame)
        host.backgroundColor = webView.backgroundColor
        host.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.removeFromSuperview()
        webView.translatesAutoresizingMaskIntoConstraints = false
        host.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: host.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: host.trailingAnchor),
            webView.topAnchor.constraint(equalTo: host.topAnchor),
            webView.bottomAnchor.constraint(equalTo: host.bottomAnchor)
        ])
        view = host
    }

    /// React supplies getBoundingClientRect() values relative to the WKWebView.
    /// Convert them through UIKit so safe-area offsets and WebView framing are
    /// included before positioning the native preview sibling.
    func nativeFrame(forWebViewBounds bounds: CGRect) -> CGRect? {
        guard let webView, webView.superview === view else { return nil }
        return webView.convert(bounds, to: view)
    }

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(ClearWaterExportPlugin())
        bridge?.registerPluginInstance(ClearWaterCameraPlugin())
        installMemoryTerminationHook()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        installMemoryTerminationHook()
    }

    private func installMemoryTerminationHook() {
        guard let webView, webView.navigationDelegate !== webTerminationProxy else { return }
        webTerminationProxy.forward = webView.navigationDelegate
        webView.navigationDelegate = webTerminationProxy
    }
}
