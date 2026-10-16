import UIKit
import Capacitor

extension Notification.Name {
    static let clearWaterLaunchMode = Notification.Name("ClearWaterLaunchMode")
}

/// Main-thread, single-consumer routing for cold and warm Shortcuts URL opens.
enum ClearWaterLaunchRouting {
    private static var pending: String?
    static func mode(for url: URL) -> String? {
        guard url.scheme?.lowercased() == "clearwater", let mode = url.host?.lowercased(),
              ["camera", "edit"].contains(mode), url.path.isEmpty || url.path == "/" else { return nil }
        return mode
    }
    @discardableResult static func accept(_ url: URL) -> Bool {
        guard let mode = mode(for: url) else { return false }
        pending = mode
        NotificationCenter.default.post(name: .clearWaterLaunchMode, object: nil, userInfo: ["mode": mode])
        return true
    }
    static func consume() -> String? { let mode = pending; pending = nil; return mode }
}

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        for context in connectionOptions.urlContexts {
            if ClearWaterLaunchRouting.accept(context.url) { break }
        }
        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = ClearWaterBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for context in URLContexts {
            if ClearWaterLaunchRouting.accept(context.url) { break }
        }
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
