import AppKit
import NhanhCore
import SwiftUI

@main
struct NhanhApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var appState = AppState.shared

    var body: some Scene {
        // Một cửa sổ chứa nhiều tab do Thaigit tự vẽ (như GitKraken), nên ẩn thanh tiêu đề của macOS.
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
        // Thaigit tự vẽ thanh tab: tắt tab của macOS (bản cũ đã bật "always" cho app).
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
