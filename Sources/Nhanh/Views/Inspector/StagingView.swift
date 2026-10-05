import NhanhCore
import SwiftUI

/// The "WIP" panel: unstaged / staged / conflicted files and the commit composer — like GitKraken.
struct StagingView: View {
    @Bindable var model: RepoModel

    var body: some View {
        VStack(spacing: 0) {
            header
            if !model.riskFlags.isEmpty, model.dismissedRiskFlags != model.riskFlags {
                RiskBanner(flags: model.riskFlags) {
                    withAnimation(.snappy) { model.dismissedRiskFlags = model.riskFlags }
                }
            }
            Divider()
            if !model.status.conflicts.isEmpty {
                ConflictList(model: model)
                Divider()
            }
            VSplitView {
                FileSection(
                    model: model,
                    title: String(localized: "Chưa stage"),
                    files: model.status.unstaged,
                    source: .unstaged,
                    selection: $model.selectedUnstaged,
                    bulkTitle: String(localized: "Stage tất cả"),
                    bulkSymbol: "plus.circle.fill",
                    bulkAction: { model.stageAll() },
                    rowSymbol: "plus.circle.fill",
                    rowTint: .green,
                    rowTitle: "Stage",
                    rowAction: { model.stage($0) },
                    emptyText: String(localized: "Không có thay đổi nào chưa stage")
                )
                // An empty list shrinks so the other one can show more files (like GitKraken).
                .frame(minHeight: 90, maxHeight: model.status.unstaged.isEmpty && !model.status.staged.isEmpty ? 110 : .infinity)
                FileSection(
                    model: model,
                    title: String(localized: "Đã stage"),
                    files: model.status.staged,
                    source: .staged,
                    selection: $model.selectedStaged,
                    bulkTitle: String(localized: "Bỏ stage tất cả"),
                    bulkSymbol: "minus.circle.fill",
                    bulkAction: { model.unstageAll() },
                    rowSymbol: "minus.circle.fill",
                    rowTint: .red,
                    rowTitle: String(localized: "Bỏ stage"),
                    rowAction: { model.unstage($0) },
                    emptyText: String(localized: "Chưa stage file nào — bấm “Stage” hoặc kéo chọn file ở trên")
                )
                .frame(minHeight: 90, maxHeight: model.status.staged.isEmpty ? 110 : .infinity)
            }
            Divider()
            CommitComposer(model: model)
        }
    }

    private var header: some View {
        HStack(spacing: 8) {
            Image(systemName: "pencil.and.list.clipboard")
                .foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 1) {
                Text("\(model.status.changedFileCount) file thay đổi")
                    .font(.headline)
                Text("trên \(model.headDescription)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button {
                model.openTimeline()
            } label: {
                Label("Dòng thời gian", systemImage: "clock.arrow.circlepath")
            }
            .help("Các bản Thaigit tự lưu thư mục làm việc — quay lại khi có gì hỏng")
            Menu {
                MenuSpecContent(items: model.workingTreeMenu())
            } label: {
                Image(systemName: "ellipsis.circle")
            }
            .menuStyle(.borderlessButton)
            .fixedSize()
            .help("Thêm thao tác")
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }
}

private struct FileSection: View {
    @Bindable var model: RepoModel
    let title: String
    let files: [FileChange]
    let source: DiffSource
    @Binding var selection: Set<String>
    let bulkTitle: String
    let bulkSymbol: String
    let bulkAction: () -> Void
    let rowSymbol: String
    let rowTint: Color
    let rowTitle: String
    let rowAction: ([FileChange]) -> Void
    let emptyText: String
    @State private var isDropTargeted = false
    /// Path / Tree like GitKraken: a flat list or a directory tree (shared by every file list).
    @AppStorage("fileListTree") private var treeMode = false
    @State private var collapsed: Set<String> = []

    private static let dragPrefix = "nhanh-file:"
    private var sourceKey: String { source == .unstaged ? "unstaged" : "staged" }
    private var otherKey: String { source == .unstaged ? "staged" : "unstaged" }

    /// The drag payload: a file path (or every selected file when dragging from within the selection).
    private func dragPayload(for change: FileChange) -> String {
        let paths = selection.contains(change.path) && selection.count > 1 ? Array(selection).sorted() : [change.path]
        return Self.dragPrefix + sourceKey + ":" + paths.joined(separator: "\n")
    }

    private func handleDrop(_ items: [String]) -> Bool {
        let prefix = Self.dragPrefix + otherKey + ":"
        let paths = Set(items.filter { $0.hasPrefix(prefix) }
            .flatMap { $0.dropFirst(prefix.count).split(separator: "\n").map(String.init) })
        guard !paths.isEmpty else { return false }
        if source == .unstaged {
            model.unstage(model.status.staged.filter { paths.contains($0.path) })
        } else {
            model.stage(model.status.unstaged.filter { paths.contains($0.path) })
        }
        return true
    }

    private func fileRow(_ change: FileChange, showDirectory: Bool) -> some View {
        FileRow(change: change, quickActionTitle: rowTitle, quickActionSymbol: rowSymbol,
                quickActionTint: rowTint, quickAction: { rowAction([change]) }, showDirectory: showDirectory)
            .tag(change.path)
            .draggable(dragPayload(for: change)) {
                let count = selection.contains(change.path) ? max(selection.count, 1) : 1
                Label(count > 1 ? "\(count) file" : change.fileName, systemImage: "doc.on.doc")
                    .padding(6)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 6))
            }
    }

    /// A folder row in tree layout: click to collapse / expand, quick buttons to Stage / Unstage the whole folder.
    private func folderRow(path: String, name: String, depth: Int, count: Int) -> some View {
        let isCollapsed = collapsed.contains(path)
        return HStack(spacing: 5) {
            Image(systemName: isCollapsed ? "chevron.right" : "chevron.down")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
                .frame(width: 10)
            Image(systemName: "folder.fill")
                .foregroundStyle(.secondary)
            Text(name)
                .lineLimit(1)
                .truncationMode(.middle)
            Text("\(count)")
                .font(.caption.monospacedDigit())
                .foregroundStyle(.tertiary)
            Spacer(minLength: 2)
            Button {
                rowAction(files.filter { $0.path.hasPrefix(path + "/") })
            } label: {
                Image(systemName: rowSymbol)
                    .foregroundStyle(rowTint)
            }
            .buttonStyle(.plain)
            .help("\(rowTitle) \(name)/")
        }
        .font(.callout)
        .padding(.leading, CGFloat(depth) * 14)
        .contentShape(Rectangle())
        .onTapGesture {
            if isCollapsed { collapsed.remove(path) } else { collapsed.insert(path) }
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 6) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                Text("\(files.count)")
                    .font(.caption.monospacedDigit())
                    .padding(.horizontal, 6)
                    .padding(.vertical, 1)
                    .background(Capsule().fill(Color.primary.opacity(0.08)))
                Spacer()
                Button { treeMode.toggle() } label: {
                    Image(systemName: treeMode ? "list.bullet.indent" : "list.bullet")
                }
                .buttonStyle(.borderless)
                .help(treeMode ? String(localized: "Đang xem dạng cây — bấm để xem danh sách đường dẫn") : String(localized: "Xem dạng cây thư mục"))
                Button(action: bulkAction) {
                    Label(bulkTitle, systemImage: bulkSymbol)
                        .font(.caption.weight(.medium))
                }
                .buttonStyle(.borderless)
                .disabled(files.isEmpty)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 7)

            if files.isEmpty {
                Text(emptyText)
                    .font(.callout)
                    .foregroundStyle(.tertiary)
                    .multilineTextAlignment(.center)
                    .padding()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List(selection: $selection) {
                    if treeMode {
                        ForEach(FileTree.rows(files, collapsed: collapsed)) { row in
                            switch row {
                            case .folder(let path, let name, let depth, let count):
                                folderRow(path: path, name: name, depth: depth, count: count)
                            case .file(let change, let depth):
                                fileRow(change, showDirectory: false)
                                    .padding(.leading, CGFloat(depth) * 14)
                            }
                        }
                    } else {
                        ForEach(files) { change in
                            fileRow(change, showDirectory: true)
                        }
                    }
                }
                .listStyle(.inset)
                .alternatingRowBackgrounds(.disabled)
                .contextMenu(forSelectionType: String.self) { paths in
                    let changes = files.filter { paths.contains($0.path) }
                    if changes.count == 1, let change = changes.first {
                        MenuSpecContent(items: model.fileMenu(change, source: source))
                    } else if changes.count > 1 {
                        Button("\(rowTitle) \(changes.count) file") { rowAction(changes) }
                        if source == .unstaged {
                            Button("Huỷ thay đổi \(changes.count) file…", role: .destructive) { model.discard(changes) }
                        }
                    }
                } primaryAction: { paths in
                    // Double-click: move the file to the other list.
                    rowAction(files.filter { paths.contains($0.path) })
                }
                .onChange(of: selection) { _, newValue in
                    guard newValue.count == 1, let path = newValue.first,
                          let change = files.first(where: { $0.path == path }) else { return }
                    if source == .unstaged { model.selectedStaged = [] } else { model.selectedUnstaged = [] }
                    model.openDiff(change, source: source)
                }
                .onKeyPress(.space) {
                    let changes = files.filter { selection.contains($0.path) }
                    guard !changes.isEmpty else { return .ignored }
                    rowAction(changes)
                    return .handled
                }
            }
        }
        .frame(minHeight: 110)
        .overlay {
            if isDropTargeted {
                let tint: Color = source == .staged ? .green : .orange
                RoundedRectangle(cornerRadius: 8)
                    .strokeBorder(tint, style: StrokeStyle(lineWidth: 2, dash: [6, 4]))
                    .background(RoundedRectangle(cornerRadius: 8).fill(tint.opacity(0.08)))
                    .overlay(Label(source == .staged ? String(localized: "Thả để stage") : String(localized: "Thả để bỏ stage"),
                                   systemImage: source == .staged ? "plus.circle.fill" : "minus.circle.fill")
                        .font(.headline)
                        .foregroundStyle(tint))
                    .padding(4)
                    .allowsHitTesting(false)
            }
        }
        .dropDestination(for: String.self) { items, _ in
            handleDrop(items)
        } isTargeted: { targeted in
            isDropTargeted = targeted
        }
    }
}

private struct ConflictList: View {
    @Bindable var model: RepoModel
    /// The selected files (⌘-click / ⇧-click) so several can be handled at once.
    @State private var selected: Set<String> = []
    /// The number of conflict hunks per file.
    @State private var counts: [String: Int] = [:]

    private var targets: [ConflictEntry] {
        selected.isEmpty ? model.status.conflicts : model.status.conflicts.filter { selected.contains($0.path) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                Text("Xung đột cần giải quyết (\(model.status.conflicts.count))")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Menu {
                    Section(selected.isEmpty ? String(localized: "Mọi file xung đột") : String(localized: "\(selected.count) file đã chọn")) {
                        Button("Dùng bản Current") { model.resolveConflicts(targets, useOurs: true); selected = [] }
                        Button("Dùng bản Incoming") { model.resolveConflicts(targets, useOurs: false); selected = [] }
                        Button("Đánh dấu đã giải quyết") { model.markResolved(targets.map(\.path)); selected = [] }
                    }
                } label: {
                    Text(selected.isEmpty ? String(localized: "Giải quyết tất cả") : String(localized: "Giải quyết \(selected.count) file"))
                }
                .menuStyle(.borderlessButton)
                .fixedSize()
                .controlSize(.small)
                .help("Dùng nguyên bản một bên cho nhiều file một lần — ⌘-click để chọn từng file")
            }
            ForEach(model.status.conflicts) { entry in
                let isSelected = selected.contains(entry.path)
                HStack(spacing: 6) {
                    ChangeIcon(kind: .conflicted)
                    VStack(alignment: .leading, spacing: 1) {
                        Text((entry.path as NSString).lastPathComponent)
                            .lineLimit(1)
                        Text(subtitle(entry))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("Giải quyết") { model.openConflict(entry) }
                        .controlSize(.small)
                }
                .padding(.vertical, 2)
                .padding(.horizontal, 4)
                .background(RoundedRectangle(cornerRadius: 6).fill(isSelected ? Color.accentColor.opacity(0.18) : Color.clear))
                .contentShape(Rectangle())
                .onTapGesture { click(entry) }
                .contextMenu {
                    let group = isSelected && selected.count > 1 ? targets : [entry]
                    Button("Mở trình giải quyết xung đột") { model.openConflict(entry) }
                    Divider()
                    Button(group.count > 1 ? String(localized: "Dùng bản Current cho \(group.count) file") : String(localized: "Dùng toàn bộ bản Current")) {
                        model.resolveConflicts(group, useOurs: true)
                    }
                    Button(group.count > 1 ? String(localized: "Dùng bản Incoming cho \(group.count) file") : String(localized: "Dùng toàn bộ bản Incoming")) {
                        model.resolveConflicts(group, useOurs: false)
                    }
                    Button("Đánh dấu đã giải quyết") { model.markResolved(group.map(\.path)) }
                    Divider()
                    Button("Mở bằng trình soạn thảo") { model.openInEditor(path: entry.path) }
                }
                .help(entry.path)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(Color.orange.opacity(0.08))
        .task(id: model.status.conflicts.map(\.path)) {
            selected = selected.intersection(model.status.conflicts.map(\.path))
            let root = model.repository.root
            let paths = model.status.conflicts.filter(\.kind.hasMarkers).map(\.path)
            counts = await Task.detached(priority: .utility) { RepoModel.conflictBlockCounts(root: root, paths: paths) }.value
        }
    }

    private func subtitle(_ entry: ConflictEntry) -> String {
        guard let count = counts[entry.path], count > 0 else { return entry.kind.description }
        return entry.kind.description + " · " + String(localized: "\(count) đoạn")
    }

    /// A plain click: open the file. ⌘-click: add / remove from the selection. ⇧-click: select a range.
    private func click(_ entry: ConflictEntry) {
        let flags = NSEvent.modifierFlags
        if flags.contains(.command) {
            if selected.contains(entry.path) { selected.remove(entry.path) } else { selected.insert(entry.path) }
        } else if flags.contains(.shift), let anchor = model.status.conflicts.firstIndex(where: { selected.contains($0.path) }),
                  let index = model.status.conflicts.firstIndex(where: { $0.path == entry.path }) {
            selected = Set(model.status.conflicts[min(anchor, index)...max(anchor, index)].map(\.path))
        } else {
            selected = []
            model.openConflict(entry)
        }
    }
}

/// The commit composer: summary, description, amend, the big commit button.
struct CommitComposer: View {
    @Bindable var model: RepoModel
    @FocusState private var summaryFocused: Bool
    @State private var aiWorking = false

    private var remaining: Int { 72 - model.commitSummary.count }

    private var commitTitle: String {
        if model.amendLastCommit, model.operation == nil { return String(localized: "Sửa commit trước") }
        if model.operation == .merging { return String(localized: "Hoàn tất merge") }
        if model.operation == .reverting { return String(localized: "Hoàn tất revert") }
        let count = model.status.staged.count
        return count > 0 ? String(localized: "Commit \(count) file vào \(model.currentBranch ?? "HEAD")") : "Commit"
    }

    /// ✨ Write the commit message with on-device AI (Apple Intelligence) from the staged changes.
    @ViewBuilder
    private var aiButton: some View {
        let reason = CommitMessageAI.unavailableReason
        if aiWorking {
            ProgressView().controlSize(.small)
        } else {
            Button {
                aiWorking = true
                Task {
                    await model.fillCommitMessageWithAI()
                    aiWorking = false
                }
            } label: {
                Image(systemName: "sparkles")
            }
            .buttonStyle(.borderless)
            .disabled(reason != nil || model.status.staged.isEmpty)
            .help(reason ?? (model.status.staged.isEmpty
                ? String(localized: "Stage thay đổi trước, rồi để AI viết commit message")
                : String(localized: "AI viết commit message từ thay đổi đã stage — chạy trên máy, không gửi code đi đâu")))
        }
    }

    /// No suggestion while merging / reverting…: "Stage all & commit" would bundle the in-progress change into the
    /// operation-completing commit (with the operation's message).
    private var suggestsStageAll: Bool {
        model.status.staged.isEmpty && !model.status.unstaged.isEmpty && !model.amendLastCommit && model.operation == nil
    }

    /// Whether the commit button (and Commit & Push) is enabled.
    private var canCommitNow: Bool {
        suggestsStageAll ? model.hasCommitMessage && model.status.conflicts.isEmpty : model.canCommit
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Commit").font(.headline)
                if CommitMessageAI.isEnabled {
                    aiButton
                }
                Button { model.sheet = .issues } label: { Image(systemName: "number") }
                    .buttonStyle(.borderless)
                    .help("Gắn issue GitHub / Jira vào commit message (⌥⌘J)")
                Spacer()
                Toggle("Sửa commit trước (amend)", isOn: $model.amendLastCommit)
                    .toggleStyle(.checkbox)
                    .controlSize(.small)
                    // Mid merge / revert…: the commit completes the operation, it doesn't modify an earlier commit.
                    .disabled(model.headOID == nil || model.operation != nil)
                    .help("Amend thay đổi đã stage vào commit gần nhất và/hoặc sửa message của nó")
            }
            TextField("Tóm tắt (bắt buộc)", text: $model.commitSummary)
                .textFieldStyle(.roundedBorder)
                .focused($summaryFocused)
                .overlay(alignment: .trailing) {
                    if !model.commitSummary.isEmpty {
                        Text("\(remaining)")
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(remaining < 0 ? .orange : .secondary)
                            .padding(.trailing, 7)
                            .help("Nên giữ dòng tóm tắt dưới 72 ký tự")
                    }
                }
            ZStack(alignment: .topLeading) {
                TextEditor(text: $model.commitBody)
                    .font(.callout)
                    .scrollContentBackground(.hidden)
                    .padding(.horizontal, 3)
                    .padding(.vertical, 4)
                if model.commitBody.isEmpty {
                    Text("Mô tả chi tiết (tuỳ chọn)")
                        .font(.callout)
                        .foregroundStyle(.tertiary)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 5)
                        .allowsHitTesting(false)
                }
            }
            .frame(height: 70)
            .background(RoundedRectangle(cornerRadius: 10).fill(Color(nsColor: .textBackgroundColor).opacity(0.75)))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.primary.opacity(0.1)))

            if let hint = model.commitIdentityHint {
                // A gentle hint: the commit email differs from the repo owner's GitHub account.
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Image(systemName: "person.crop.circle.badge.exclamationmark")
                        .foregroundStyle(.orange)
                    Text("Repo của \(hint.owner) dùng @\(hint.profile.login), nhưng commit đang ký \(hint.current.email ?? "(chưa đặt email)").")
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                    // Open the "GitHub account for this repo" dialog to confirm before writing the local config.
                    Button("Dùng của @\(hint.profile.login)…") { model.sheet = .githubAccount(owner: nil) }
                        .buttonStyle(.link)
                        .help("Ghi \(hint.profile.commitName) <\(hint.profile.commitEmail)> vào config local của repo này")
                }
                .font(.caption)
            }

            HStack(spacing: 6) {
                if suggestsStageAll {
                    Button {
                        model.commit(stageAllFirst: true)
                    } label: {
                        Label("Stage tất cả & commit", systemImage: "checkmark.circle.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .glassButtonStyle(prominent: true)
                    .controlSize(.large)
                    .disabled(!canCommitNow)
                    .keyboardShortcut(.return, modifiers: .command)
                } else {
                    Button {
                        model.commit()
                    } label: {
                        Label(commitTitle, systemImage: "checkmark.circle.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .glassButtonStyle(prominent: true)
                    .controlSize(.large)
                    .disabled(!canCommitNow)
                    .keyboardShortcut(.return, modifiers: .command)
                }
                if model.canCommitAndPush {
                    // Commit then push right away (⌘⇧↩) — the everyday "done, ship it" flow.
                    Button {
                        model.commit(stageAllFirst: suggestsStageAll, andPush: true)
                    } label: {
                        Image(systemName: "arrow.up.circle.fill")
                    }
                    .glassButtonStyle(prominent: true)
                    .controlSize(.large)
                    .disabled(!canCommitNow)
                    .keyboardShortcut(.return, modifiers: [.command, .shift])
                    .help("Commit rồi push lên remote (⌘⇧↩)")
                    .accessibilityLabel("Commit & Push")
                }
            }
            Text(model.hasCommitMessage
                ? (model.canCommitAndPush ? String(localized: "⌘↩ để commit · ⌘⇧↩ để commit & push") : String(localized: "⌘↩ để commit"))
                : String(localized: "Nhập tóm tắt để commit"))
                .font(.caption2)
                .foregroundStyle(.tertiary)
                .frame(maxWidth: .infinity, alignment: .center)
        }
        .padding(14)
    }
}

/// The risk warning strip (deletions / skipped tests, dependency changes, CI, large files, secrets) with the file names — it
/// never shows secret contents. Warning only, never blocks a commit.
private struct RiskBanner: View {
    let flags: [RiskFlag]
    let onDismiss: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Label("Nên xem lại trước khi commit", systemImage: "exclamationmark.triangle.fill")
                    .font(.callout.weight(.semibold))
                    .foregroundStyle(.orange)
                Spacer()
                Button(action: onDismiss) {
                    Image(systemName: "xmark")
                        .font(.caption.weight(.semibold))
                }
                .buttonStyle(.borderless)
                .help("Ẩn cảnh báo này (hiện lại khi có cảnh báo mới)")
            }
            ForEach(flags) { flag in
                VStack(alignment: .leading, spacing: 1) {
                    Text(title(flag))
                        .font(.caption.weight(.medium))
                        .foregroundStyle(flag.code == .secret ? Color.red : Color.primary)
                    Text(files(flag))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.orange.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
        .padding(.horizontal, 10)
        .padding(.bottom, 8)
        .help("Chỉ là cảnh báo — Thaigit không chặn commit.")
    }

    private func title(_ flag: RiskFlag) -> String {
        let count = flag.paths.count
        return switch flag.code {
        case .testsRemoved: String(localized: "Xoá \(count) file test")
        case .testsSkipped: String(localized: "Tắt bớt test (skip / only) trong \(count) file")
        case .depsChanged: String(localized: "Đổi dependency (\(count) file)")
        case .ciChanged: String(localized: "Đổi CI / Docker (\(count) file)")
        case .largeFile: String(localized: "\(count) file lớn hơn 1 MB")
        case .secret: String(localized: "\(count) file có thể chứa mật khẩu hoặc khoá bí mật")
        }
    }

    private func files(_ flag: RiskFlag) -> String {
        let shown = flag.paths.prefix(3).joined(separator: ", ")
        let rest = flag.paths.count - 3
        return rest > 0 ? shown + " " + String(localized: "và \(rest) file khác") : shown
    }
}
