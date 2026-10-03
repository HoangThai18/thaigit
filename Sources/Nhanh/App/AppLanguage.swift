import AppKit
import Foundation

/// Ngôn ngữ giao diện (Cài đặt → Chung). Chuỗi gốc trong code là tiếng Việt; bản tiếng Anh nằm trong
/// `Resources/en.lproj` của gói app. macOS chọn bản dịch MỘT LẦN lúc mở app theo `AppleLanguages` của riêng app, nên đổi
/// ngôn ngữ thì app khởi động lại.
enum AppLanguage: String, CaseIterable, Identifiable {
    case vietnamese = "vi"
    case english = "en"

    var id: String { rawValue }

    /// Tên viết bằng chính ngôn ngữ đó (không dịch).
    var name: String {
        switch self {
        case .vietnamese: return "Tiếng Việt"
        case .english: return "English"
        }
    }

    private static let key = "AppleLanguages"

    /// Ngôn ngữ của lần chạy này (theo bản dịch macOS đã chọn cho gói app).
    static var current: AppLanguage {
        let preferred = Bundle.main.preferredLocalizations.first ?? "vi"
        return preferred.hasPrefix("en") ? .english : .vietnamese
    }

    /// Chưa từng chọn thì cố định tiếng Việt — máy cài macOS tiếng Anh vẫn mở Thaigit bằng tiếng Việt như trước. Gọi sớm nhất
    /// có thể (`NhanhApp.init`), trước khi đọc chuỗi nào.
    static func applyDefault() {
        let defaults = UserDefaults.standard
        guard let domain = Bundle.main.bundleIdentifier, defaults.persistentDomain(forName: domain)?[key] == nil else { return }
        defaults.set([AppLanguage.vietnamese.rawValue], forKey: key)
    }

    /// Lưu lựa chọn rồi mở lại app (chạy ngoài gói .app — `swift run` — thì chỉ lưu, lần mở sau có tác dụng).
    static func switchTo(_ language: AppLanguage) {
        UserDefaults.standard.set([language.rawValue], forKey: key)
        UserDefaults.standard.synchronize()
        AppRelauncher.relaunch()
    }
}

/// Mở lại chính app: chờ tiến trình này thoát hẳn rồi `open` gói .app (dùng khi đổi ngôn ngữ, cài bản cập nhật).
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
