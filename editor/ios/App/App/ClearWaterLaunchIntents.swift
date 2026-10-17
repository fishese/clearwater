import AppIntents

/// App Shortcuts run in the app so the same pending request reaches the WebView
/// whether iOS starts a scene first or the scene is already connected.
struct OpenClearWaterCameraIntent: AppIntent {
    static let title: LocalizedStringResource = "Open Camera"
    static let supportedModes: IntentModes = .foreground(.immediate)

    func perform() async throws -> some IntentResult {
        await MainActor.run { _ = ClearWaterLaunchRouting.accept("camera") }
        return .result()
    }
}

struct OpenClearWaterEditorIntent: AppIntent {
    static let title: LocalizedStringResource = "Open Editor"
    static let supportedModes: IntentModes = .foreground(.immediate)

    func perform() async throws -> some IntentResult {
        await MainActor.run { _ = ClearWaterLaunchRouting.accept("edit") }
        return .result()
    }
}

struct ClearWaterAppShortcuts: AppShortcutsProvider {
    @AppShortcutsBuilder
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: OpenClearWaterCameraIntent(),
                    phrases: ["Open Camera in \(.applicationName)"],
                    shortTitle: "Open Camera", systemImageName: "camera")
        AppShortcut(intent: OpenClearWaterEditorIntent(),
                    phrases: ["Open Editor in \(.applicationName)"],
                    shortTitle: "Open Editor", systemImageName: "photo.on.rectangle")
    }
}
