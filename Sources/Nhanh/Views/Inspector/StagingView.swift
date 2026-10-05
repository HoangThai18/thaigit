import NhanhCore
import SwiftUI

/// Panel "WIP": file chưa stage / đã stage / xung đột và ô soạn commit — giống GitKraken.
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
                // Danh sách trống thu nhỏ để danh sách kia hiện được nhiều file (như GitKraken).
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

    private static let dragPrefix = "nhanh-file:"
    private var sourceKey: String { source == .unstaged ? "unstaged" : "staged" }
    private var otherKey: String { source == .unstaged ? "staged" : "unstaged" }

    /// Nội dung kéo: đường dẫn file (hoặc mọi file đang chọn nếu kéo từ một file trong vùng chọn).
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
                    ForEach(files) { change in
                        FileRow(change: change, quickActionTitle: rowTitle, quickActionSymbol: rowSymbol,
                                quickActionTint: rowTint) {
                            rowAction([change])
                        }
                        .tag(change.path)
                        .draggable(dragPayload(for: change)) {
                            let count = selection.contains(change.path) ? max(selection.count, 1) : 1
                            Label(count > 1 ? "\(count) file" : change.fileName, systemImage: "doc.on.doc")
                                .padding(6)
                                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 6))
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
                    // Double-click: chuyển file sang danh sách còn lại.
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

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                Text("Xung đột cần giải quyết (\(model.status.conflicts.count))")
                    .font(.subheadline.weight(.semibold))
                Spacer()
            }
            ForEach(model.status.conflicts) { entry in
                HStack(spacing: 6) {
                    ChangeIcon(kind: .conflicted)
                    VStack(alignment: .leading, spacing: 1) {
                        Text((entry.path as NSString).lastPathComponent)
                            .lineLimit(1)
                        Text(entry.kind.description)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("Giải quyết") { model.openConflict(entry) }
                        .controlSize(.small)
                }
                .padding(.vertical, 2)
                .contentShape(Rectangle())
                .onTapGesture { model.openConflict(entry) }
                .contextMenu {
                    Button("Mở trình giải quyết xung đột") { model.openConflict(entry) }
                    Divider()
                    Button("Dùng toàn bộ bản Current") { model.resolveConflict(entry, useOurs: true) }
                    Button("Dùng toàn bộ bản Incoming") { model.resolveConflict(entry, useOurs: false) }
                    Button("Đánh dấu đã giải quyết") { model.markResolved([entry.path]) }
                    Divider()
                    Button("Mở bằng trình soạn thảo") { model.openInEditor(path: entry.path) }
                }
                .help(entry.path)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(Color.orange.opacity(0.08))
    }
}

/// Ô soạn commit: tóm tắt, mô tả, amend, nút commit lớn.
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

    /// ✨ Viết commit message bằng AI chạy trên máy (Apple Intelligence) từ thay đổi đã stage.
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

    /// Không gợi ý khi đang merge / revert…: "Stage tất cả & commit" sẽ gói luôn thay đổi đang làm dở vào commit hoàn tất
    /// thao tác (với message của thao tác).
    private var suggestsStageAll: Bool {
        model.status.staged.isEmpty && !model.status.unstaged.isEmpty && !model.amendLastCommit && model.operation == nil
    }

    /// Nút commit (và Commit & Push) bấm được chưa.
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
                    // Đang merge / revert…: commit là để hoàn tất thao tác, không sửa commit trước.
                    .disabled(model.headOID == nil || model.operation != nil)
                    .help("Gộp thay đổi đã stage vào commit gần nhất và/hoặc sửa message của nó")
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
                // Gợi ý nhẹ: email commit khác tài khoản GitHub của owner repo này.
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Image(systemName: "person.crop.circle.badge.exclamationmark")
                        .foregroundStyle(.orange)
                    Text("Repo của \(hint.owner) dùng @\(hint.profile.login), nhưng commit đang ký \(hint.current.email ?? "(chưa đặt email)").")
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                    // Mở hộp "Tài khoản GitHub cho repo này" để xác nhận trước khi ghi config local.
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
                    // Commit rồi push luôn (⌘⇧↩) — luồng hằng ngày "xong việc, đẩy lên".
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

/// Dải cảnh báo rủi ro (xoá / bỏ qua test, đổi thư viện, CI, file lớn, bí mật) kèm tên file — không bao giờ hiện nội dung bí
/// mật. Chỉ là cảnh báo, không chặn commit.
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
