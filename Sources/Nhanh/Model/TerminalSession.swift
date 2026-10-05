import AppKit
import NhanhCore
import SwiftTerm
import SwiftUI

/// A real terminal below the graph (like GitKraken's integrated terminal): the user's login shell (zsh / bash…)
/// runs in the repo directory over a PTY, with colours, and can run interactive commands (vim, `git rebase -i`,
/// ssh…). Multiple tabs; hiding the panel keeps the shell running, closing a tab / closing the repo stops the
/// shell. The repo refreshes itself through file watching, exactly as after an edit in an external terminal.
@Observable
final class TerminalSession {
    /// A terminal tab. Its `view` is kept for the tab's whole lifetime so hiding / showing the panel doesn't lose the content.
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
    /// A tab-name counter: "Terminal", "Terminal 2"…
    @ObservationIgnored private var created = 0
    @ObservationIgnored private let environment: () -> [String: String]

    init(root: URL, environment: @escaping () -> [String: String]) {
        self.root = root
        self.environment = environment
    }

    var selected: Tab? { tabs.first { $0.id == selectedID } ?? tabs.last }

    /// Open another terminal tab in the repo directory.
    @discardableResult
    func newTab() -> Tab {
        created += 1
        let view = LocalProcessTerminalView(frame: NSRect(x: 0, y: 0, width: 800, height: 240))
        view.font = NSFont.monospacedSystemFont(ofSize: 12, weight: .regular)
        view.configureNativeColors()
        // Option types special characters / Vietnamese input like Terminal.app instead of acting as a Meta key.
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

    /// Stop every shell (closing the repo / closing the app).
    func closeAll() {
        for tab in tabs where !tab.exited { tab.view.terminate() }
        tabs = []
        selectedID = nil
    }

    /// Type a line into the selected tab (used by the automated tests).
    func send(_ line: String) {
        (selected ?? newTab()).view.send(txt: line + "\n")
    }

    /// The user's login shell; zsh (macOS's default) when there is none.
    static var shell: String {
        let value = ProcessInfo.processInfo.environment["SHELL"] ?? ""
        return !value.isEmpty && FileManager.default.isExecutableFile(atPath: value) ? value : "/bin/zsh"
    }

    /// The shell's environment: like the app's (full PATH from the login shell), minus the variables the app sets for
    /// background git commands (no editor, no password prompts on the terminal, English messages…) so the terminal
    /// behaves like Terminal.app.
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
    /// Show / hide the terminal panel (⌃`); the first time it opens, create one tab.
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
