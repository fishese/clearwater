import UIKit
import Capacitor

extension Notification.Name {
    static let clearWaterLaunchMode = Notification.Name("ClearWaterLaunchMode")
}

struct ClearWaterLaunchRequestQueue {
    private var pending: String?
    mutating func enqueue(_ mode: String) { pending = mode }
    mutating func consume() -> String? { let mode = pending; pending = nil; return mode }
}

/// Main-thread, single-consumer routing for cold and warm launch actions.
enum ClearWaterLaunchRouting {
    static let cameraShortcutType = "com.fishese.clearwater.camera"
    static let editShortcutType = "com.fishese.clearwater.edit"

    private static var requests = ClearWaterLaunchRequestQueue()
    static func mode(for url: URL) -> String? {
        guard url.scheme?.lowercased() == "clearwater", let mode = url.host?.lowercased(),
              ["camera", "edit"].contains(mode), url.path.isEmpty || url.path == "/" else { return nil }
        return mode
    }
    @discardableResult static func accept(_ url: URL) -> Bool {
        guard let mode = mode(for: url) else { return false }
        return accept(mode)
    }
    static func mode(for shortcutItem: UIApplicationShortcutItem) -> String? {
        switch shortcutItem.type {
        case cameraShortcutType: return "camera"
        case editShortcutType: return "edit"
        default: return nil
        }
    }
    @discardableResult static func accept(_ shortcutItem: UIApplicationShortcutItem) -> Bool {
        guard let mode = mode(for: shortcutItem) else { return false }
        return accept(mode)
    }
    @discardableResult static func accept(_ mode: String) -> Bool {
        guard mode == "camera" || mode == "edit" else { return false }
        requests.enqueue(mode)
        NotificationCenter.default.post(name: .clearWaterLaunchMode, object: nil, userInfo: ["mode": mode])
        return true
    }
    static func consume() -> String? { requests.consume() }
}

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        // A cold Home Screen quick action arrives here, before the WebView and
        // its launchMode listener exist. The pending mode survives that startup.
        let handledShortcut = connectionOptions.shortcutItem.map(ClearWaterLaunchRouting.accept) ?? false
        if !handledShortcut {
            for context in connectionOptions.urlContexts {
                if ClearWaterLaunchRouting.accept(context.url) { break }
            }
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

    func windowScene(_ windowScene: UIWindowScene, performActionFor shortcutItem: UIApplicationShortcutItem,
                     completionHandler: @escaping (Bool) -> Void) {
        completionHandler(ClearWaterLaunchRouting.accept(shortcutItem))
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
