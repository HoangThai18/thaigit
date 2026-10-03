import NhanhCore
import SwiftUI

/// Hành động của một cửa sổ cho thanh menu: mở repo (vào tab), clone, tạo repo.
@Observable
final class WindowActions {
    var openPath: (String) -> Void = { _ in }
    var showClone: () -> Void = {}
    var showInit: () -> Void = {}
    var showPalette: () -> Void = {}
}

struct AppCommands: Commands {
    let appState: AppState
    @FocusedValue(RepoModel.self) private var model
    @FocusedValue(WindowActions.self) private var windowActions
    @FocusedValue(TabsModel.self) private var tabs
    @Environment(\.openWindow) private var openWindow
    @Environment(\.openSettings) private var openSettings
    private let github = GitHubAccountManager.shared

    var body: some Commands {
        CommandGroup(after: .appInfo) {
            Button("Kiểm tra cập nhật…") {
                Task { await AppUpdater.shared.check(userInitiated: true) }
            }
            Button("Có gì mới…") {
                if let tabs { tabs.openReleaseNotes() } else { openWindow(id: "main") }
            }
        }

        CommandGroup(after: .appSettings) {
            // Mở thẻ Tài khoản trong Cài đặt; chưa đăng nhập thì hiện luôn hộp đăng nhập ở đó.
            Button(github.accounts.isEmpty ? String(localized: "Đăng nhập GitHub…") : String(localized: "Tài khoản GitHub…")) {
                github.prepareSettings()
                openSettings()
            }
        }

        CommandGroup(replacing: .newItem) {
            Button("Tab mới") {
                if let tabs { tabs.newTab() } else { openWindow(id: "main") }
            }
            .keyboardShortcut("t")
            Button("Cửa sổ mới") { openWindow(id: "main") }
                .keyboardShortcut("n")
            Button("Mở repository…") { openRepository() }
                .keyboardShortcut("o")
            Button("Clone repository…") { windowAction { $0.showClone() } }
                .keyboardShortcut("o", modifiers: [.command, .shift])
            Button("Tạo repository mới…") { windowAction { $0.showInit() } }
                .keyboardShortcut("n", modifiers: [.command, .option])
            Menu("Mở gần đây") {
                ForEach(appState.recentRepositories.prefix(12), id: \.self) { path in
                    Button((path as NSString).lastPathComponent + "  —  " + (path as NSString).deletingLastPathComponent) {
                        open(path)
                    }
                }
            }
            .disabled(appState.recentRepositories.isEmpty)
            Divider()
            Button("Đóng repository") { if let tabs { tabs.closeRepository(in: tabs.selected) } }
                .disabled(tabs?.selected.model == nil)
        }

        // ⌘P như GitKraken: bảng lệnh (app không in ấn gì nên thay mục Print).
        CommandGroup(replacing: .printItem) {
            Button("Bảng lệnh…") { windowAction { $0.showPalette() } }
                .keyboardShortcut("p")
        }

        CommandGroup(replacing: .saveItem) {
            Button("Đóng tab") { closeTab() }
                .keyboardShortcut("w")
            Button("Đóng cửa sổ") { NSApp.keyWindow?.performClose(nil) }
                .keyboardShortcut("w", modifiers: [.command, .shift])
        }

        CommandGroup(before: .windowList) {
            Button("Tab sau") { tabs?.selectNext(1) }
                .keyboardShortcut(.tab, modifiers: .control)
                .disabled((tabs?.tabs.count ?? 0) < 2)
            Button("Tab trước") { tabs?.selectNext(-1) }
                .keyboardShortcut(.tab, modifiers: [.control, .shift])
                .disabled((tabs?.tabs.count ?? 0) < 2)
            Menu("Chuyển tới tab") {
                ForEach(1...9, id: \.self) { number in
                    Button(number == 9 ? "Tab cuối" : "Tab \(number)") { tabs?.select(number: number) }
                        .keyboardShortcut(KeyEquivalent(Character(String(number))), modifiers: .command)
                }
            }
            .disabled(tabs == nil)
            Divider()
        }

        CommandGroup(after: .sidebar) {
            Button("Ẩn/hiện panel chi tiết") { model?.toggleInspector() }
                .keyboardShortcut("i", modifiers: [.command, .option])
                .disabled(model == nil)
        }

        CommandMenu("Repository") {
            Button("Làm mới") { model?.refreshEverything() }
                .keyboardShortcut("r")
            Divider()
            Button("Fetch") { model?.fetch() }
                .keyboardShortcut("f", modifiers: [.command, .option])
            Button("Pull") { model?.pull() }
                .keyboardShortcut("l", modifiers: [.command, .shift])
            Button("Push") { model?.push() }
                .keyboardShortcut("p", modifiers: [.command, .shift])
            Button("Merge từ repository khác…") { model?.beginMergeFromRepository() }
                .disabled(model == nil)
            Button("Blame file đang mở") {
                if let model, let file = model.openFile, let sheet = model.blameSheet(for: file) { model.sheet = sheet }
            }
            .keyboardShortcut("b", modifiers: [.command, .control])
            .disabled(model?.openFile.flatMap { model?.blameSheet(for: $0) } == nil)
            Button("Interactive rebase từ commit đang chọn…") {
                if let model, let commit = model.selectedCommit { model.beginInteractiveRebase(from: commit) }
            }
            .keyboardShortcut("i", modifiers: [.command, .shift])
            .disabled(!(model.flatMap { model in model.selectedCommit.map(model.canInteractiveRebase) } ?? false))
            Divider()
            Button("Chuyển nhánh…") { model?.sheet = .switchBranch }
                .keyboardShortcut("b", modifiers: [.command])
            Button("Tạo branch mới…") { model?.beginCreateBranchAtHead() }
                .keyboardShortcut("b", modifiers: [.command, .shift])
            Button("Stash thay đổi…") { model?.beginStash() }
                .keyboardShortcut("s", modifiers: [.command, .shift])
            Button("Pop stash mới nhất") { model?.popLatestStash() }
                .keyboardShortcut("s", modifiers: [.command, .option, .shift])
            Divider()
            Button("Stage tất cả") { model?.stageAll() }
                .keyboardShortcut("a", modifiers: [.command, .shift])
            Button("Tới thay đổi đang làm (WIP)") { model?.selectWorkingTree() }
                .keyboardShortcut("0", modifiers: [.command])
            Button("Tới HEAD") { model?.revealHead() }
                .keyboardShortcut("h", modifiers: [.command, .shift])
            Divider()
            Button("Terminal trong app") { model?.toggleTerminal() }
                .keyboardShortcut("`", modifiers: .control)
                .disabled(model == nil)
            Button("Mở trong Terminal") { model?.openInTerminal() }
                .keyboardShortcut("t", modifiers: [.command, .option])
            Button("Mở trong Finder") { model?.revealInFinder() }
                .keyboardShortcut("r", modifiers: [.command, .shift])
            Button("Mở bằng VS Code") { model?.openInEditor() }
            Divider()
            Button("Tài khoản GitHub cho repo này…") { model?.sheet = .githubAccount(owner: nil) }
                .disabled(model == nil)
            AdvancedRepositoryMenuItems(model: model)
            Button("Nhật ký lệnh git…") { model?.sheet = .commandLog }
        }
    }

    /// ⌘W: đóng tab đang chọn. Cửa sổ khác (Cài đặt…) thì đóng cửa sổ đó; đang mở hộp thoại thì bỏ qua.
    private func closeTab() {
        guard let key = NSApp.keyWindow else { return }
        if key.sheetParent != nil || key.attachedSheet != nil { return }
        // Đang ở Trang chủ (không đóng được) thì ⌘W đóng cửa sổ, như đóng tab cuối của trình duyệt.
        if let tabs, !(key is NSPanel), tabs.selected.kind != .home {
            tabs.close(tabs.selectedID)
        } else {
            key.performClose(nil)
        }
    }

    private func windowAction(_ body: (WindowActions) -> Void) {
        if let windowActions {
            body(windowActions)
        } else if TabsModel.liveWindows == 0 {
            openWindow(id: "main")
        }
    }

    private func openRepository() {
        guard let path = appState.chooseRepositoryFolder() else { return }
        open(path)
    }

    private func open(_ path: String) {
        if let windowActions {
            windowActions.openPath(path)
        } else {
            // Cửa sổ đang có (không phải cửa sổ đang dùng) sẽ nhận và mở thành tab; chưa có cửa sổ nào thì mở mới.
            appState.pendingOpenPaths.append(path)
            if TabsModel.liveWindows == 0 { openWindow(id: "main") }
        }
    }
}

/// Mục Issues, ký commit, Git Flow, LFS, worktree, submodule của menu Repository (tách khỏi `AppCommands.body` cho
/// trình biên dịch đỡ nặng).
private struct AdvancedRepositoryMenuItems: View {
    let model: RepoModel?

    var body: some View {
        Button("Issues (GitHub / Jira)…") { model?.sheet = .issues }
            .keyboardShortcut("j", modifiers: [.command, .option])
            .disabled(model == nil)
        Button("Ký commit (GPG / SSH)…") { model?.sheet = .commitSigning }
            .disabled(model == nil)
        Menu("Git Flow") {
            if model?.extras.gitFlow == nil {
                Button("Khởi tạo Git Flow…") { model?.sheet = .gitFlowInit }
            } else {
                ForEach(GitFlowKind.allCases) { kind in
                    Button("Bắt đầu \(kind.title.lowercased())…") { model?.sheet = .gitFlowStart(kind) }
                }
            }
        }
        .disabled(model == nil)
        Menu("Git LFS") {
            Button("Pull file LFS") { model?.runLFS(.pull) }
            Button("Fetch file LFS") { model?.runLFS(.fetch) }
            Button("Dọn file LFS cũ (prune)") { model?.runLFS(.prune) }
            Divider()
            Button("Theo dõi kiểu file bằng LFS…") { model?.sheet = .lfsTrack }
        }
        .disabled(model == nil)
        Button("Thêm worktree…") { model?.sheet = .addWorktree }
            .disabled(model == nil)
        Button("Tải / cập nhật mọi submodule") { model?.updateSubmodules() }
            .disabled(model?.extras.submodules.isEmpty ?? true)
    }
}
