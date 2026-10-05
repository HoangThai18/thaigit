import AppKit
import NhanhCore
import SwiftUI

@main
struct NhanhApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var appState: AppState

    init() {
        // Before anything reads a string: with no language chosen yet, stay Vietnamese.
        AppLanguage.applyDefault()
        _appState = State(initialValue: AppState.shared)
    }

    var body: some Scene {
        // Thaigit draws its own tabs (like GitKraken), so hide the macOS title bar.
        WindowGroup("Thaigit", id: "main") {
            RootView()
                .environment(appState)
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 1440, height: 900)
        .commands {
            AppCommands(appState: appState)
        }

        Settings {
            SettingsView()
                .environment(appState)
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationWillFinishLaunching(_ notification: Notification) {
        // Thaigit draws its own tab bar: turn the macOS tabs off (an older build enabled "always" for the app).
        UserDefaults.standard.removeObject(forKey: "AppleWindowTabbingMode")
        NSWindow.allowsAutomaticWindowTabbing = false
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        AutomationHarness.startWatchdog()
        AppUpdater.shared.start()
    }

    func applicationWillTerminate(_ notification: Notification) {
        AppUpdater.shared.installPendingOnQuit()
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        let paths = urls.filter(\.isFileURL).map(\.path)
        AppState.shared.pendingOpenPaths.append(contentsOf: paths)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }
}
