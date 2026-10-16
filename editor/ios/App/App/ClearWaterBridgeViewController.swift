import Capacitor
import UIKit

class ClearWaterBridgeViewController: CAPBridgeViewController {
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
    }
}
