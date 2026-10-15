import Capacitor

class ClearWaterBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(ClearWaterExportPlugin())
        bridge?.registerPluginInstance(ClearWaterCameraPlugin())
    }
}
