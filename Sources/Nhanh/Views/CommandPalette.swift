import AppKit
import NhanhCore
import SwiftUI

/// Một lệnh trong bảng lệnh ⌘P.
struct PaletteCommand: Identifiable {
    let id: String
    let title: String
    var subtitle: String?
    let systemImage: String
    var shortcut: String?
    let action: () -> Void
}

enum PaletteSearch {
    /// Bỏ dấu, chữ thường, "đ" → "d": gõ "nhanh" vẫn ra "nhánh".
    static func fold(_ text: String) -> String {
        text.folding(options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive], locale: Locale(identifier: "vi"))
            .replacingOccurrences(of: "đ", with: "d")
            .replacingOccurrences(of: "Đ", with: "d")
    }

    /// Mọi từ gõ vào đều phải có trong tên lệnh (không theo thứ tự). Điểm thấp hơn = khớp tốt hơn: khớp từ đầu tên trước.
    static func score(_ command: PaletteCommand, query: String) -> Int? {
        let words = fold(query).split(separator: " ").map(String.init)
        guard !words.isEmpty else { return 0 }
        let haystack = fold(command.title + " " + (command.subtitle ?? ""))
        guard words.allSatisfy({ haystack.contains($0) }) else { return nil }
        let title = fold(command.title)
        if title.hasPrefix(words[0]) { return 0 }
        if title.contains(" " + words[0]) { return 1 }
        return 2
    }
}

/// Bảng lệnh ⌘P như GitKraken: gõ để tìm mọi thao tác, nhánh để checkout, tab và repo gần đây; ↑↓ chọn, ↩ chạy.
struct CommandPaletteSheet: View {
    let tabs: TabsModel
    let windowActions: WindowActions
    @Environment(AppState.self) private var appState
    @Environment(\.openSettings) private var openSettings
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var highlighted: String?
    @FocusState private var searchFocused: Bool

    private var model: RepoModel? { tabs.selected.model }

    private var results: [PaletteCommand] {
        let all = commands()
        let text = query.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return Array(all.prefix(60)) }
        return all.enumerated()
            .compactMap { item in PaletteSearch.score(item.element, query: text).map { (score: $0, offset: item.offset, command: item.element) } }
            .sorted { ($0.score, $0.offset) < ($1.score, $1.offset) }
            .prefix(80)
            .map(\.command)
    }

    var body: some View {
        let items = results
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "command")
                    .foregroundStyle(.secondary)
                TextField("Gõ lệnh, tên nhánh, tên repo…", text: $query)
                    .textFieldStyle(.plain)
                    .font(.title3)
                    .focused($searchFocused)
                    .onSubmit { run(current(in: items)) }
                    .onKeyPress(.downArrow) { move(1, in: items); return .handled }
                    .onKeyPress(.upArrow) { move(-1, in: items); return .handled }
            }
            .padding(14)
            Divider()
            ScrollViewReader { proxy in
                List(items, selection: $highlighted) { command in
                    HStack(spacing: 10) {
                        Image(systemName: command.systemImage)
                            .frame(width: 20)
                            .foregroundStyle(Brand.blue)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(command.title).lineLimit(1)
                            if let subtitle = command.subtitle {
                                Text(subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
                            }
                        }
                        Spacer()
                        if let shortcut = command.shortcut {
                            Text(shortcut).font(.caption.monospaced()).foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 2)
                    .tag(command.id)
                    .id(command.id)
                }
                .listStyle(.plain)
                .contextMenu(forSelectionType: String.self) { _ in
                } primaryAction: { ids in
                    run(items.first { ids.contains($0.id) })
                }
                .onChange(of: highlighted) { _, id in
                    if let id { proxy.scrollTo(id) }
                }
            }
            HStack {
                Text(items.isEmpty ? String(localized: "Không có lệnh nào khớp") : String(localized: "↑↓ chọn · ↩ chạy · Esc đóng"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Button("Đóng") { dismiss() }
                    .keyboardShortcut(.cancelAction)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
        }
        .frame(width: 620, height: 460)
        .onAppear {
            if let text = AutomationHarness.paletteQuery { query = text }
            searchFocused = true
            highlighted = items.first?.id
        }
        .onChange(of: query) { highlighted = results.first?.id }
    }

    private func current(in items: [PaletteCommand]) -> PaletteCommand? {
        items.first { $0.id == highlighted } ?? items.first
    }

    private func move(_ delta: Int, in items: [PaletteCommand]) {
        guard !items.isEmpty else { return }
        let index = highlighted.flatMap { id in items.firstIndex { $0.id == id } } ?? -1
        highlighted = items[min(max(index + delta, 0), items.count - 1)].id
    }

    private func run(_ command: PaletteCommand?) {
        guard let command else { return }
        dismiss()
        // Chạy sau khi bảng lệnh đóng hẳn (hết hiệu ứng đóng), để lệnh mở hộp thoại khác (tạo nhánh, stash…) không bị chặn.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { command.action() }
    }

    // MARK: - Danh sách lệnh

    private func commands() -> [PaletteCommand] {
        var list: [PaletteCommand] = []
        if let model {
            list += repositoryCommands(model)
        }
        list += [
            PaletteCommand(id: "tab.new", title: String(localized: "Tab mới"), systemImage: "plus.square", shortcut: "⌘T") { _ = tabs.newTab() },
            PaletteCommand(id: "tab.home", title: String(localized: "Trang chủ"), systemImage: "house", shortcut: "⌘1") { tabs.select(tabs.home.id) },
            PaletteCommand(id: "open.repo", title: String(localized: "Mở repository…"), systemImage: "folder", shortcut: "⌘O") {
                if let path = appState.chooseRepositoryFolder() { tabs.open(path: path) }
            },
            PaletteCommand(id: "clone", title: "Clone repository…", systemImage: "arrow.down.circle", shortcut: "⇧⌘O") { windowActions.showClone() },
            PaletteCommand(id: "init", title: String(localized: "Tạo repository mới…"), systemImage: "plus.rectangle.on.folder", shortcut: "⌥⌘N") { windowActions.showInit() },
            PaletteCommand(id: "notes", title: String(localized: "Có gì mới trong Thaigit"), systemImage: "sparkles") { tabs.openReleaseNotes() },
            PaletteCommand(id: "settings", title: String(localized: "Cài đặt…"), systemImage: "gearshape", shortcut: "⌘,") { openSettings() },
        ]
        for tab in tabs.tabs where tab.kind != .home && tab.id != tabs.selectedID {
            list.append(PaletteCommand(id: "tab." + tab.id.uuidString, title: String(localized: "Chuyển tới tab \(tab.title)"), subtitle: tab.repositoryPath,
                                       systemImage: tab.systemImage) { tabs.select(tab.id) })
        }
        let open = Set(tabs.tabs.compactMap(\.repositoryPath))
        for path in appState.recentRepositories where !open.contains(path) {
            list.append(PaletteCommand(id: "recent." + path, title: String(localized: "Mở repo \((path as NSString).lastPathComponent)"),
                                       subtitle: (path as NSString).abbreviatingWithTildeInPath, systemImage: "clock") { tabs.open(path: path) })
        }
        return list
    }

    private func repositoryCommands(_ model: RepoModel) -> [PaletteCommand] {
        var list: [PaletteCommand] = [
            PaletteCommand(id: "fetch", title: "Fetch", systemImage: "arrow.triangle.2.circlepath", shortcut: "⌥⌘F") { model.fetch() },
            PaletteCommand(id: "pull", title: "Pull", systemImage: "arrow.down.circle", shortcut: "⇧⌘L") { model.pull() },
            PaletteCommand(id: "pull.rebase", title: "Pull (rebase)", systemImage: "arrow.down.circle") { model.pull(mode: .rebase) },
            PaletteCommand(id: "push", title: "Push", systemImage: "arrow.up.circle", shortcut: "⇧⌘P") { model.push() },
            PaletteCommand(id: "branch.switch", title: String(localized: "Chuyển nhánh…"), systemImage: "arrow.triangle.branch", shortcut: "⌘B") { model.sheet = .switchBranch },
            PaletteCommand(id: "branch.new", title: String(localized: "Tạo nhánh mới…"), systemImage: "plus", shortcut: "⇧⌘B") { model.beginCreateBranchAtHead() },
            PaletteCommand(id: "stash", title: String(localized: "Stash thay đổi…"), systemImage: "archivebox", shortcut: "⇧⌘S") { model.beginStash() },
            PaletteCommand(id: "stash.pop", title: String(localized: "Pop stash mới nhất"), systemImage: "archivebox.circle") { model.popLatestStash() },
            PaletteCommand(id: "stage.all", title: String(localized: "Stage tất cả"), systemImage: "plus.circle", shortcut: "⇧⌘A") { model.stageAll() },
            PaletteCommand(id: "go.wip", title: String(localized: "Tới thay đổi đang làm (WIP)"), systemImage: "pencil", shortcut: "⌘0") { model.selectWorkingTree() },
            PaletteCommand(id: "go.head", title: String(localized: "Tới HEAD"), systemImage: "scope", shortcut: "⇧⌘H") { model.revealHead() },
            PaletteCommand(id: "merge.repo", title: String(localized: "Merge từ repository khác…"), systemImage: "arrow.triangle.merge") { model.beginMergeFromRepository() },
            PaletteCommand(id: "remote.add", title: String(localized: "Thêm remote…"), systemImage: "cloud") { model.sheet = .addRemote },
            PaletteCommand(id: "terminal.app", title: "Terminal trong app", systemImage: "apple.terminal", shortcut: "⌃`") { model.toggleTerminal() },
            PaletteCommand(id: "terminal", title: String(localized: "Mở trong Terminal"), systemImage: "terminal", shortcut: "⌥⌘T") { model.openInTerminal() },
            PaletteCommand(id: "finder", title: String(localized: "Mở trong Finder"), systemImage: "folder", shortcut: "⇧⌘R") { model.revealInFinder() },
            PaletteCommand(id: "editor", title: String(localized: "Mở bằng trình soạn thảo"), systemImage: "chevron.left.forwardslash.chevron.right") { model.openInEditor() },
            PaletteCommand(id: "log", title: String(localized: "Nhật ký lệnh git…"), systemImage: "list.bullet.rectangle") { model.sheet = .commandLog },
            PaletteCommand(id: "timeline", title: String(localized: "Dòng thời gian…"), systemImage: "clock.arrow.circlepath") { model.openTimeline() },
            PaletteCommand(id: "refresh", title: String(localized: "Làm mới"), systemImage: "arrow.clockwise", shortcut: "⌘R") { model.refreshEverything() },
            PaletteCommand(id: "github.account", title: String(localized: "Tài khoản GitHub cho repo này…"), systemImage: "person.crop.circle") {
                model.sheet = .githubAccount(owner: nil)
            },
            PaletteCommand(id: "repo.close", title: String(localized: "Đóng repository"), systemImage: "xmark.square") { tabs.closeRepository(in: tabs.selected) },
        ]
        if let commit = model.selectedCommit, model.canInteractiveRebase(from: commit) {
            list.append(PaletteCommand(id: "irebase", title: String(localized: "Interactive rebase từ commit đang chọn…"), subtitle: commit.subject,
                                       systemImage: "list.bullet.indent", shortcut: "⇧⌘I") { model.beginInteractiveRebase(from: commit) })
        }
        if model.githubRemote != nil {
            list.append(PaletteCommand(id: "pr.new", title: String(localized: "Tạo Pull Request…"), subtitle: model.currentBranch.map { String(localized: "Từ nhánh \($0)") },
                                       systemImage: "arrow.triangle.pull") { model.beginCreatePullRequest() })
            list.append(PaletteCommand(id: "pr.reload", title: String(localized: "Tải lại danh sách Pull Request"), systemImage: "arrow.clockwise") {
                model.loadPullRequests(force: true)
            })
            for pull in model.pullRequests.items.prefix(100) {
                list.append(PaletteCommand(id: "pr.\(pull.number)", title: "Pull Request #\(pull.number) \(pull.title)",
                                           subtitle: "\(pull.headBranch) → \(pull.baseBranch) · @\(pull.author)",
                                           systemImage: "arrow.triangle.pull") { model.revealPullRequest(pull) })
            }
        }
        list.append(PaletteCommand(id: "issues", title: "Issues (GitHub / Jira)…", subtitle: String(localized: "Tạo nhánh từ issue, gắn issue vào commit"),
                                   systemImage: "checklist", shortcut: "⌥⌘J") { model.sheet = .issues })
        if CommitMessageAI.isEnabled, CommitMessageAI.unavailableReason == nil, !model.status.staged.isEmpty {
            list.append(PaletteCommand(id: "ai.commit", title: String(localized: "AI viết commit message"), subtitle: String(localized: "Chạy trên máy (Apple Intelligence)"),
                                       systemImage: "sparkles") { Task { await model.fillCommitMessageWithAI() } })
        }
        list.append(PaletteCommand(id: "signing", title: String(localized: "Ký commit (GPG / SSH)…"), systemImage: "signature") { model.sheet = .commitSigning })
        list.append(PaletteCommand(id: "worktree.add", title: String(localized: "Thêm worktree…"), systemImage: "square.on.square") { model.sheet = .addWorktree })
        for worktree in model.extras.linkedWorktrees {
            list.append(PaletteCommand(id: "worktree." + worktree.path, title: String(localized: "Mở worktree \(worktree.branch ?? (worktree.path as NSString).lastPathComponent)"),
                                       subtitle: (worktree.path as NSString).abbreviatingWithTildeInPath, systemImage: "folder") {
                model.openInNewTab(worktree.path)
            })
        }
        if !model.extras.submodules.isEmpty {
            list.append(PaletteCommand(id: "submodule.update", title: String(localized: "Tải / cập nhật mọi submodule"), systemImage: "shippingbox") {
                model.updateSubmodules()
            })
        }
        if let flow = model.extras.gitFlow {
            for kind in GitFlowKind.allCases {
                list.append(PaletteCommand(id: "flow.start." + kind.rawValue, title: String(localized: "Git Flow: bắt đầu \(kind.title.lowercased())…"),
                                           subtitle: String(localized: "Từ \(flow.base(kind))"), systemImage: "flag") { model.sheet = .gitFlowStart(kind) })
            }
            if let branch = model.currentBranch, let current = flow.classify(branch) {
                list.append(PaletteCommand(id: "flow.finish", title: String(localized: "Git Flow: kết thúc \(current.kind.title.lowercased()) \(current.name)…"),
                                           systemImage: "flag.checkered") { model.finishFlow(current.kind, name: current.name) })
            }
        } else {
            list.append(PaletteCommand(id: "flow.init", title: String(localized: "Git Flow: khởi tạo…"), systemImage: "flag") { model.sheet = .gitFlowInit })
        }
        list.append(PaletteCommand(id: "lfs.pull", title: "Git LFS: pull", systemImage: "externaldrive") { model.runLFS(.pull) })
        list.append(PaletteCommand(id: "lfs.track", title: String(localized: "Git LFS: theo dõi kiểu file…"), systemImage: "externaldrive") { model.sheet = .lfsTrack })
        if model.graphFilter.isActive {
            list.append(PaletteCommand(id: "graph.showall", title: String(localized: "Hiện tất cả nhánh trên graph"), systemImage: "eye") {
                model.showAllBranchesOnGraph()
            })
        }
        if let file = model.openFile, model.canEditInApp(file) {
            list.append(PaletteCommand(id: "edit", title: String(localized: "Sửa \(file.change.fileName) trong app"), systemImage: "pencil") {
                model.beginEditing(file)
            })
        }
        if let file = model.openFile, let blame = model.blameSheet(for: file) {
            list.append(PaletteCommand(id: "blame", title: "Blame \(file.change.fileName)", systemImage: "person.text.rectangle",
                                       shortcut: "⌃⌘B") { model.sheet = blame })
        }
        for ref in model.localBranches where !ref.isHead {
            list.append(PaletteCommand(id: "checkout." + ref.fullName, title: "Checkout \(ref.name)", subtitle: String(localized: "Nhánh local"),
                                       systemImage: "arrow.uturn.right") { model.checkout(ref) })
            if let current = model.currentBranch {
                list.append(PaletteCommand(id: "compare." + ref.fullName, title: String(localized: "So sánh \(ref.name) với \(current)"),
                                           subtitle: String(localized: "\(ref.name) có gì mới"), systemImage: "arrow.left.arrow.right") {
                    model.compareWithCurrent(ref)
                })
            }
        }
        // Nhánh remote đã có nhánh local cùng tên thì checkout cũng chỉ là chuyển sang nhánh local đó — bỏ cho đỡ rối.
        let localNames = Set(model.localBranches.map(\.name))
        for ref in model.remoteBranches.lazy.filter({ !localNames.contains($0.shortBranchName) && $0.shortBranchName != "HEAD" }).prefix(300) {
            list.append(PaletteCommand(id: "checkout." + ref.fullName, title: "Checkout \(ref.name)", subtitle: String(localized: "Nhánh remote"),
                                       systemImage: "cloud") { model.checkout(ref) })
        }
        return list
    }
}
