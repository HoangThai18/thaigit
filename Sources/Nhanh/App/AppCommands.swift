import NhanhCore
import SwiftUI

/// Hành động của một cửa sổ (tab) cho thanh menu: mở repo, clone, tạo repo.
@Observable
final class WindowActions {
    var openPath: (String) -> Void = { _ in }
    var showClone: () -> Void = {}
    var showInit: () -> Void = {}
}

struct AppCommands: Commands {
    let appState: AppState
    @FocusedValue(RepoModel.self) private var model
    @FocusedValue(WindowActions.self) private var windowActions
    @Environment(\.openWindow) private var openWindow

    var body: some Commands {
        CommandGroup(after: .appInfo) {
            Button("Kiểm tra cập nhật…") {
                Task { await AppUpdater.shared.check(userInitiated: true) }
            }
        }

        CommandGroup(replacing: .newItem) {
            Button("Tab mới") { openWindow(id: "repo") }
                .keyboardShortcut("t")
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
            Button("Mở trong Terminal") { model?.openInTerminal() }
                .keyboardShortcut("t", modifiers: [.command, .option])
            Button("Mở trong Finder") { model?.revealInFinder() }
                .keyboardShortcut("r", modifiers: [.command, .shift])
            Button("Mở bằng VS Code") { model?.openInEditor() }
            Divider()
            Button("Nhật ký lệnh git…") { model?.sheet = .commandLog }
        }
    }

    private func windowAction(_ body: (WindowActions) -> Void) {
        if let windowActions {
            body(windowActions)
        } else {
            openWindow(id: "repo")
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
            openWindow(id: "repo", value: path)
        }
    }
}
