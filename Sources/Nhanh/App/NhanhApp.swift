import AppKit
import NhanhCore
import SwiftUI

@main
struct NhanhApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var appState = AppState.shared

    var body: some Scene {
        WindowGroup("Thaigit", id: "repo", for: String.self) { $repoPath in
            RootView(repoPath: $repoPath)
                .environment(appState)
        }
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
        // Mở nhiều repo thành các tab trong một cửa sổ, giống GitKraken.
        UserDefaults.standard.set("always", forKey: "AppleWindowTabbingMode")
        NSWindow.allowsAutomaticWindowTabbing = true
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

    /// Nút + trên thanh tab: mở tab mới với màn hình chọn repository (như GitKraken).
    @objc func newWindowForTab(_ sender: Any?) {
        TabActions.openNewTab?()
    }
}
