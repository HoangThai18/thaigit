import AppKit
import NhanhCore
import SwiftTerm
import SwiftUI

/// Terminal thật dưới graph (như terminal tích hợp của GitKraken): shell đăng nhập của người dùng (zsh / bash…) chạy trong
/// thư mục repo qua PTY, có màu, chạy được lệnh tương tác (vim, `git rebase -i`, ssh…). Nhiều tab; ẩn panel thì shell vẫn
/// chạy, đóng tab / đóng repo thì shell bị dừng. Repo tự làm mới qua theo dõi file như khi sửa ở terminal ngoài.
@Observable
final class TerminalSession {
    /// Một tab terminal. Giữ nguyên `view` suốt đời tab để ẩn / hiện panel không mất nội dung.
    final class Tab: Identifiable {
        let id = UUID()
        var title: String
        var exited = false
        let view: LocalProcessTerminalView
        fileprivate let delegate: Delegate

        fileprivate init(title: String, view: LocalProcessTerminalView, delegate: Delegate) {
            self.title = title
            self.view = view
            self.delegate = delegate
        }
    }

    let root: URL
    private(set) var tabs: [Tab] = []
    var selectedID: UUID?
    var isVisible = false
    var height: CGFloat = 280
    /// Bộ đếm tên tab: "Terminal", "Terminal 2"…
    @ObservationIgnored private var created = 0
    @ObservationIgnored private let environment: () -> [String: String]

    init(root: URL, environment: @escaping () -> [String: String]) {
        self.root = root
        self.environment = environment
    }

    var selected: Tab? { tabs.first { $0.id == selectedID } ?? tabs.last }

    /// Mở thêm một tab terminal ở thư mục repo.
    @discardableResult
    func newTab() -> Tab {
        created += 1
        let view = LocalProcessTerminalView(frame: NSRect(x: 0, y: 0, width: 800, height: 240))
        view.font = NSFont.monospacedSystemFont(ofSize: 12, weight: .regular)
        view.configureNativeColors()
        // Option gõ được ký tự đặc biệt / tiếng Việt như Terminal.app thay vì làm phím Meta.
        view.optionAsMetaKey = false
        let tab = Tab(title: created == 1 ? "Terminal" : "Terminal \(created)", view: view, delegate: Delegate())
        tab.delegate.onExit = { [weak self, weak tab] in
            guard let self, let tab else { return }
            tab.exited = true
            self.close(tab)
        }
        tab.delegate.onTitle = { [weak tab] title in
            let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty { tab?.title = String(trimmed.prefix(40)) }
        }
        view.processDelegate = tab.delegate
        let shell = Self.shell
        view.startProcess(executable: shell, args: ["-l"], environment: Self.environmentList(environment()),
                          execName: "-" + (shell as NSString).lastPathComponent, currentDirectory: root.path)
        tabs.append(tab)
        selectedID = tab.id
        return tab
    }

    func close(_ tab: Tab) {
        if !tab.exited { tab.view.terminate() }
        tabs.removeAll { $0.id == tab.id }
        if selectedID == tab.id { selectedID = tabs.last?.id }
        if tabs.isEmpty { withAnimation(.snappy(duration: 0.2)) { isVisible = false } }
    }

    /// Dừng mọi shell (đóng repo / đóng tab app).
    func closeAll() {
        for tab in tabs where !tab.exited { tab.view.terminate() }
        tabs = []
        selectedID = nil
    }

    /// Gõ một dòng vào tab đang chọn (dùng cho kiểm thử tự động).
    func send(_ line: String) {
        (selected ?? newTab()).view.send(txt: line + "\n")
    }

    /// Shell đăng nhập của người dùng; không có thì zsh (mặc định của macOS).
    static var shell: String {
        let value = ProcessInfo.processInfo.environment["SHELL"] ?? ""
        return !value.isEmpty && FileManager.default.isExecutableFile(atPath: value) ? value : "/bin/zsh"
    }

    /// Môi trường của shell: như của app (PATH đầy đủ từ login shell), bỏ các biến app đặt riêng cho lệnh git nền (không mở
    /// editor, không hỏi mật khẩu trong terminal, thông báo tiếng Anh…) để terminal chạy như Terminal.app.
    static func environmentList(_ base: [String: String]) -> [String] {
        var env = base
        for key in ["GIT_TERMINAL_PROMPT", "GIT_EDITOR", "GIT_MERGE_AUTOEDIT", "GIT_PAGER", "PAGER", "LC_MESSAGES", "LANGUAGE",
                    "GIT_ASKPASS", "SSH_ASKPASS", "SSH_ASKPASS_REQUIRE", "DISPLAY"] {
            env.removeValue(forKey: key)
        }
        env["TERM"] = "xterm-256color"
        env["COLORTERM"] = "truecolor"
        env["TERM_PROGRAM"] = "Thaigit"
        if env["LANG"] == nil { env["LANG"] = "en_US.UTF-8" }
        return env.map { "\($0.key)=\($0.value)" }
    }

    fileprivate final class Delegate: LocalProcessTerminalViewDelegate {
        var onExit: (() -> Void)?
        var onTitle: ((String) -> Void)?

        func sizeChanged(source: LocalProcessTerminalView, newCols: Int, newRows: Int) {}

        func setTerminalTitle(source: LocalProcessTerminalView, title: String) {
            let onTitle = self.onTitle
            DispatchQueue.main.async { onTitle?(title) }
        }

        func hostCurrentDirectoryUpdate(source: TerminalView, directory: String?) {}

        func processTerminated(source: TerminalView, exitCode: Int32?) {
            let onExit = self.onExit
            DispatchQueue.main.async { onExit?() }
        }
    }
}

extension RepoModel {
    /// Bật / tắt panel terminal (⌃`); lần đầu mở thì tạo một tab.
    func toggleTerminal() {
        if terminal == nil {
            let store = repository.runner.environmentStore
            terminal = TerminalSession(root: repository.root) { store.value.variables }
        }
        guard let terminal else { return }
        if terminal.tabs.isEmpty { terminal.newTab() }
        withAnimation(.snappy(duration: 0.2)) { terminal.isVisible.toggle() }
    }
}
