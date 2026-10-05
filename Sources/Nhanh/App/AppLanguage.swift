import AppKit
import Foundation

/// The UI language (Settings → General). The source strings in code are Vietnamese; the English version lives in the
/// app bundle's `Resources/en.lproj`. macOS picks the translation ONCE at launch from the bundle's own
/// `AppleLanguages`, so changing the language restarts the app.
enum AppLanguage: String, CaseIterable, Identifiable {
    case vietnamese = "vi"
    case english = "en"

    var id: String { rawValue }

    /// The name written in that language itself (not translated).
    var name: String {
        switch self {
        case .vietnamese: return "Tiếng Việt"
        case .english: return "English"
        }
    }

    private static let key = "AppleLanguages"

    /// This launch's language (from the translation macOS picked for the app bundle).
    static var current: AppLanguage {
        let preferred = Bundle.main.preferredLocalizations.first ?? "vi"
        return preferred.hasPrefix("en") ? .english : .vietnamese
    }

    /// Never chosen before → pin Vietnamese, so a machine with an English macOS still opens Thaigit in Vietnamese as
    /// before. Called as early as possible (`NhanhApp.init`), before any string is read.
    static func applyDefault() {
        let defaults = UserDefaults.standard
        guard let domain = Bundle.main.bundleIdentifier, defaults.persistentDomain(forName: domain)?[key] == nil else { return }
        defaults.set([AppLanguage.vietnamese.rawValue], forKey: key)
    }

    /// Store the choice then relaunch the app (running outside a .app bundle — `swift run` — only stores it; it takes effect on the next launch).
    static func switchTo(_ language: AppLanguage) {
        UserDefaults.standard.set([language.rawValue], forKey: key)
        UserDefaults.standard.synchronize()
        AppRelauncher.relaunch()
    }
}

/// Relaunch the app itself: wait for this process to fully exit, then `open` the .app bundle (used when changing language or installing an update).
enum AppRelauncher {
    static func relaunch() {
        let app = Bundle.main.bundleURL
        guard app.pathExtension == "app" else { return }
        let reopen = Process()
        reopen.executableURL = URL(fileURLWithPath: "/bin/sh")
        reopen.arguments = [
            "-c",
            "while /bin/kill -0 \(ProcessInfo.processInfo.processIdentifier) 2>/dev/null; do /bin/sleep 0.2; done; /usr/bin/open \"$0\"",
            app.path,
        ]
        try? reopen.run()
        NSApp.terminate(nil)
    }
}
