import Capacitor

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

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(ClearWaterExportPlugin())
        bridge?.registerPluginInstance(ClearWaterCameraPlugin())
    }
}
