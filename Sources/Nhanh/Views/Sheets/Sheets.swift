import AppKit
import NhanhCore
import SwiftUI

struct SheetContent: View {
    @Bindable var model: RepoModel
    let sheet: RepoSheet

    var body: some View {
        switch sheet {
        case .createBranch(let startPoint, let label):
            CreateBranchSheet(model: model, startPoint: startPoint, startLabel: label)
        case .renameBranch(let name):
            RenameBranchSheet(model: model, oldName: name)
        case .createTag(let sha, let label):
            CreateTagSheet(model: model, sha: sha, label: label)
        case .push(let request):
            PushSheet(model: model, request: request)
        case .stash:
            StashSheet(model: model)
        case .identity:
            IdentitySheet(model: model)
        case .addRemote:
            AddRemoteSheet(model: model)
        case .commandLog:
            CommandLogSheet(model: model)
        case .fileHistory(let path):
            FileHistorySheet(model: model, path: path)
        case .switchBranch:
            SwitchBranchSheet(model: model)
        case .mergeFromRepository(let target):
            MergeFromRepositorySheet(model: model, initialTarget: target)
        case .githubLogin:
            GitHubLoginSheet()
        case .githubAccount(let owner):
            GitHubRepoAccountSheet(model: model, owner: owner)
        case .interactiveRebase(let base, let label):
            InteractiveRebaseSheet(model: model, base: base, baseLabel: label)
        case .blame(let path, let rev):
            BlameSheet(model: model, path: path, rev: rev)
        case .createPullRequest(let head):
            CreatePullRequestSheet(model: model, head: head)
        case .commitSigning:
            CommitSigningSheet(model: model)
        case .addWorktree:
            AddWorktreeSheet(model: model)
        case .gitFlowInit:
            GitFlowInitSheet(model: model)
        case .gitFlowStart(let kind):
            GitFlowStartSheet(model: model, kind: kind)
        case .lfsTrack:
            LFSTrackSheet(model: model)
        case .issues:
            IssuesSheet(model: model)
        }
    }
}

/// Khung chung cho các hộp thoại nhỏ.
private struct SheetFrame<Content: View>: View {
    let title: String
    let systemImage: String
    let confirmTitle: String
    let canConfirm: Bool
    let onConfirm: () -> Void
    @ViewBuilder let content: Content
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Label(title, systemImage: systemImage)
                .font(.title3.bold())
            content
            HStack {
                Spacer()
                Button("Huỷ") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button(confirmTitle) {
                    onConfirm()
                    dismiss()
                }
                .keyboardShortcut(.defaultAction)
                .disabled(!canConfirm)
            }
        }
        .padding(22)
        .frame(width: 460)
    }
}

/// Kiểm tra nhanh tên nhánh/tag theo quy tắc git-check-ref-format.
enum RefNameRules {
    static func sanitize(_ name: String) -> String {
        name.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: " ", with: "-")
    }

    static func problem(_ name: String) -> String? {
        if name.isEmpty { return nil }
        let forbidden = CharacterSet(charactersIn: "~^:?*[\\\u{7f}").union(.controlCharacters).union(.whitespaces)
        if name.unicodeScalars.contains(where: forbidden.contains) { return String(localized: "Không được chứa khoảng trắng hoặc ký tự ~ ^ : ? * [ \\") }
        if name.hasPrefix("-") || name.hasPrefix("/") || name.hasPrefix(".") { return String(localized: "Không được bắt đầu bằng - / .") }
        if name.hasSuffix("/") || name.hasSuffix(".") || name.hasSuffix(".lock") { return String(localized: "Không được kết thúc bằng / . hoặc .lock") }
        if name.contains("..") || name.contains("//") || name.contains("@{") || name.contains("/.") { return String(localized: "Không được chứa .. // @{ hoặc /.") }
        if name == "@" || name == "HEAD" { return String(localized: "Tên này được git dành riêng") }
        return nil
    }
}

private struct CreateBranchSheet: View {
    @Bindable var model: RepoModel
    let startPoint: String
    let startLabel: String
    @State private var name = ""
    @State private var checkout = true
    @FocusState private var focused: Bool

    private var cleaned: String { RefNameRules.sanitize(name) }
    private var exists: Bool { model.refs.contains { $0.kind == .localBranch && $0.name == cleaned } }
    private var problem: String? { exists ? String(localized: "Đã có nhánh tên này") : RefNameRules.problem(cleaned) }

    var body: some View {
        SheetFrame(title: String(localized: "Tạo nhánh mới"), systemImage: "arrow.triangle.branch", confirmTitle: checkout ? String(localized: "Tạo & checkout") : String(localized: "Tạo nhánh"),
                   canConfirm: !cleaned.isEmpty && problem == nil) {
            model.createBranch(name: cleaned, startPoint: startPoint, checkout: checkout)
        } content: {
            VStack(alignment: .leading, spacing: 8) {
                Text("Từ: \(startLabel)").font(.callout).foregroundStyle(.secondary)
                TextField("Tên nhánh, ví dụ feature/dang-nhap", text: $name)
                    .textFieldStyle(.roundedBorder)
                    .focused($focused)
                if let problem {
                    Text(problem).font(.caption).foregroundStyle(.red)
                } else if cleaned != name.trimmingCharacters(in: .whitespaces), !cleaned.isEmpty {
                    Text("Sẽ tạo: \(cleaned)").font(.caption).foregroundStyle(.secondary)
                }
                Toggle("Chuyển sang nhánh mới ngay", isOn: $checkout)
            }
        }
        .onAppear { focused = true }
    }
}

private struct RenameBranchSheet: View {
    @Bindable var model: RepoModel
    let oldName: String
    @State private var name = ""

    private var cleaned: String { RefNameRules.sanitize(name) }
    private var problem: String? {
        if model.refs.contains(where: { $0.kind == .localBranch && $0.name == cleaned }) && cleaned != oldName { return String(localized: "Đã có nhánh tên này") }
        return RefNameRules.problem(cleaned)
    }

    var body: some View {
        SheetFrame(title: String(localized: "Đổi tên nhánh"), systemImage: "pencil", confirmTitle: String(localized: "Đổi tên"),
                   canConfirm: !cleaned.isEmpty && cleaned != oldName && problem == nil) {
            model.renameBranch(oldName, to: cleaned)
        } content: {
            VStack(alignment: .leading, spacing: 8) {
                Text("Tên hiện tại: \(oldName)").font(.callout).foregroundStyle(.secondary)
                TextField("Tên mới", text: $name)
                    .textFieldStyle(.roundedBorder)
                if let problem { Text(problem).font(.caption).foregroundStyle(.red) }
            }
        }
        .onAppear { name = oldName }
    }
}

private struct CreateTagSheet: View {
    @Bindable var model: RepoModel
    let sha: String
    let label: String
    @State private var name = ""
    @State private var message = ""
    @State private var push = false

    private var cleaned: String { RefNameRules.sanitize(name) }
    private var problem: String? {
        if model.refs.contains(where: { $0.kind == .tag && $0.name == cleaned }) { return String(localized: "Đã có tag tên này") }
        return RefNameRules.problem(cleaned)
    }

    var body: some View {
        SheetFrame(title: String(localized: "Tạo tag"), systemImage: "tag", confirmTitle: String(localized: "Tạo tag"), canConfirm: !cleaned.isEmpty && problem == nil) {
            model.createTag(name: cleaned, sha: sha, message: message, pushToRemote: push)
        } content: {
            VStack(alignment: .leading, spacing: 8) {
                Text("Tại commit \(label)").font(.callout).foregroundStyle(.secondary)
                TextField("Tên tag, ví dụ v1.2.0", text: $name)
                    .textFieldStyle(.roundedBorder)
                if let problem { Text(problem).font(.caption).foregroundStyle(.red) }
                TextField("Ghi chú (tuỳ chọn — có ghi chú sẽ tạo annotated tag)", text: $message, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(2...4)
                Toggle("Push tag lên \(model.defaultRemote ?? "remote") ngay", isOn: $push)
                    .disabled(model.remotes.isEmpty)
            }
        }
    }
}

private struct PushSheet: View {
    @Bindable var model: RepoModel
    @State var request: PushRequest

    var body: some View {
        SheetFrame(title: "Push \(request.localBranch)", systemImage: "arrow.up.circle", confirmTitle: "Push",
                   canConfirm: !request.remoteBranch.isEmpty && RefNameRules.problem(request.remoteBranch) == nil) {
            model.performPush(request)
        } content: {
            VStack(alignment: .leading, spacing: 10) {
                Text("Nhánh này chưa có nhánh tương ứng trên remote. Nhánh mới sẽ được tạo trên remote.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                Picker("Remote", selection: $request.remote) {
                    ForEach(model.remotes) { remote in
                        Text(remote.name).tag(remote.name)
                    }
                }
                TextField("Tên nhánh trên remote", text: $request.remoteBranch)
                    .textFieldStyle(.roundedBorder)
                Toggle("Theo dõi nhánh này (đặt upstream) — lần sau chỉ cần bấm Push/Pull", isOn: $request.setUpstream)
            }
        }
    }
}

private struct StashSheet: View {
    @Bindable var model: RepoModel
    @State private var message = ""
    @State private var includeUntracked = true

    var body: some View {
        SheetFrame(title: String(localized: "Stash thay đổi"), systemImage: "archivebox", confirmTitle: "Stash", canConfirm: true) {
            model.stash(message: message, includeUntracked: includeUntracked)
        } content: {
            VStack(alignment: .leading, spacing: 8) {
                TextField("Lời nhắn (tuỳ chọn), ví dụ: đang sửa dở form đăng nhập", text: $message)
                    .textFieldStyle(.roundedBorder)
                Toggle("Gồm cả file mới (chưa track)", isOn: $includeUntracked)
            }
        }
    }
}

private struct IdentitySheet: View {
    @Bindable var model: RepoModel
    @State private var name = ""
    @State private var email = ""

    var body: some View {
        SheetFrame(title: String(localized: "Tên & email cho Git"), systemImage: "person.crop.circle", confirmTitle: String(localized: "Lưu"),
                   canConfirm: !name.trimmingCharacters(in: .whitespaces).isEmpty && email.contains("@")) {
            model.saveIdentity(name: name.trimmingCharacters(in: .whitespaces), email: email.trimmingCharacters(in: .whitespaces))
        } content: {
            VStack(alignment: .leading, spacing: 8) {
                Text("Git ghi tên và email này vào mỗi commit. Lưu cho mọi repository trên máy (git config --global).")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                TextField("Họ tên, ví dụ Phan Thái", text: $name)
                    .textFieldStyle(.roundedBorder)
                TextField("Email", text: $email)
                    .textFieldStyle(.roundedBorder)
            }
        }
        .task {
            name = await model.repository.config("user.name") ?? ""
            email = await model.repository.config("user.email") ?? ""
        }
    }
}

private struct AddRemoteSheet: View {
    @Bindable var model: RepoModel
    @State private var name = "origin"
    @State private var url = ""

    var body: some View {
        SheetFrame(title: String(localized: "Thêm remote"), systemImage: "cloud", confirmTitle: String(localized: "Thêm"),
                   canConfirm: !name.isEmpty && !url.trimmingCharacters(in: .whitespaces).isEmpty
                       && !model.remotes.contains { $0.name == name }) {
            model.addRemote(name: name, url: url.trimmingCharacters(in: .whitespaces))
        } content: {
            VStack(alignment: .leading, spacing: 8) {
                TextField("Tên (thường là origin)", text: $name)
                    .textFieldStyle(.roundedBorder)
                TextField("URL, ví dụ git@github.com:ten/du-an.git", text: $url)
                    .textFieldStyle(.roundedBorder)
                if model.remotes.contains(where: { $0.name == name }) {
                    Text("Đã có remote tên này").font(.caption).foregroundStyle(.red)
                }
            }
        }
        .onAppear {
            if model.remotes.contains(where: { $0.name == "origin" }) { name = "" }
        }
    }
}

private struct CommandLogSheet: View {
    let model: RepoModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let records = model.commandLog.records.reversed()
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label("Nhật ký lệnh git", systemImage: "terminal")
                    .font(.title3.bold())
                Spacer()
                Text("\(records.count) lệnh gần nhất").foregroundStyle(.secondary)
            }
            List(Array(records)) { record in
                VStack(alignment: .leading, spacing: 3) {
                    HStack {
                        Image(systemName: record.exitCode == 0 ? "checkmark.circle.fill" : "xmark.octagon.fill")
                            .foregroundStyle(record.exitCode == 0 ? .green : .red)
                        Text(record.commandLine)
                            .font(.system(size: 12, design: .monospaced))
                            .textSelection(.enabled)
                            .lineLimit(2)
                        Spacer()
                        Text(String(format: "%.0f ms", record.duration * 1000))
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                    if record.exitCode != 0, !record.stderr.isEmpty {
                        Text(record.stderr.trimmingCharacters(in: .whitespacesAndNewlines))
                            .font(.caption.monospaced())
                            .foregroundStyle(.red)
                            .textSelection(.enabled)
                            .lineLimit(6)
                    }
                }
                .padding(.vertical, 2)
            }
            HStack {
                Spacer()
                Button("Đóng") { dismiss() }
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(20)
        .frame(width: 760, height: 520)
    }
}

private struct FileHistorySheet: View {
    @Bindable var model: RepoModel
    let path: String
    @State private var commits: [Commit] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Lịch sử: \(path)", systemImage: "clock")
                .font(.title3.bold())
                .lineLimit(1)
                .truncationMode(.middle)
            if isLoading {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let errorMessage {
                Text(errorMessage).foregroundStyle(.red).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if commits.isEmpty {
                ContentUnavailableView("Chưa có commit nào chạm tới file này", systemImage: "clock")
            } else {
                List(commits) { commit in
                    HStack(spacing: 10) {
                        AvatarView(name: commit.authorName, email: commit.authorEmail, repo: model.githubRepo, size: 24)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(commit.subject).lineLimit(1)
                            Text("\(commit.authorName) · \(VietnameseDate.absolute(commit.authorDate))")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text(commit.shortSHA).font(.caption.monospaced()).foregroundStyle(.secondary)
                    }
                    .contentShape(Rectangle())
                    .onTapGesture {
                        dismiss()
                        model.reveal(commit: commit.id)
                    }
                }
            }
            HStack {
                Text("Bấm một commit để xem trên graph").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("Đóng") { dismiss() }
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(20)
        .frame(width: 640, height: 500)
        .task {
            do {
                commits = try await model.repository.fileHistory(path: path)
            } catch {
                errorMessage = FriendlyError.message(for: error)
            }
            isLoading = false
        }
    }
}

/// Chuyển nhánh nhanh khi repo có nhiều nhánh: gõ để lọc (cả nhánh remote), ↑↓ để chọn, ↩ để checkout.
private struct SwitchBranchSheet: View {
    @Bindable var model: RepoModel
    @State private var query = ""
    @State private var highlighted: String?
    @Environment(\.dismiss) private var dismiss

    private var results: [GitRef] {
        let text = query.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return model.recentLocalBranches(limit: 40) }
        let matches = (model.localBranches + model.remoteBranches).filter { $0.name.localizedStandardContains(text) }
        // Nhánh local trước, khớp từ đầu tên trước.
        func rank(_ ref: GitRef) -> Int {
            let prefix = ref.shortBranchName.range(of: text, options: [.anchored, .caseInsensitive, .diacriticInsensitive]) != nil
            return (ref.kind == .localBranch ? 0 : 2) + (prefix ? 0 : 1)
        }
        return matches.enumerated()
            .sorted { (rank($0.element), $0.offset) < (rank($1.element), $1.offset) }
            .prefix(100)
            .map(\.element)
    }

    var body: some View {
        let items = results
        let current = current(in: items)
        VStack(alignment: .leading, spacing: 12) {
            Label("Chuyển nhánh", systemImage: "arrow.triangle.branch")
                .font(.title3.bold())
            TextField("Gõ tên nhánh…", text: $query)
                .textFieldStyle(.roundedBorder)
                .onKeyPress(.downArrow) {
                    move(1, in: items)
                    return .handled
                }
                .onKeyPress(.upArrow) {
                    move(-1, in: items)
                    return .handled
                }
            ScrollViewReader { proxy in
                List(items, selection: $highlighted) { ref in
                    SwitchBranchRow(ref: ref)
                        .tag(ref.fullName)
                        .id(ref.fullName)
                }
                .contextMenu(forSelectionType: String.self) { _ in
                } primaryAction: { ids in
                    checkout(items.first { ids.contains($0.fullName) })
                }
                .onChange(of: highlighted) { _, id in
                    if let id { proxy.scrollTo(id) }
                }
            }
            .frame(height: 320)
            HStack {
                Text(items.isEmpty ? String(localized: "Không có nhánh khớp") : (query.isEmpty ? String(localized: "Nhánh gần đây · ") : "") + String(localized: "↑↓ chọn · ↩ checkout"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Button("Huỷ") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button("Checkout") { checkout(current) }
                    .keyboardShortcut(.defaultAction)
                    .disabled(current == nil || current?.isHead == true)
            }
        }
        .padding(20)
        .frame(width: 560)
        .onAppear { highlighted = Self.defaultChoice(in: items)?.fullName }
        .onChange(of: query) { highlighted = Self.defaultChoice(in: results)?.fullName }
    }

    /// Mặc định chọn nhánh khác nhánh hiện tại (↩ là chuyển ngay, giống `git checkout -`).
    private static func defaultChoice(in items: [GitRef]) -> GitRef? {
        items.first { !$0.isHead } ?? items.first
    }

    private func current(in items: [GitRef]) -> GitRef? {
        if let highlighted, let ref = items.first(where: { $0.fullName == highlighted }) { return ref }
        return Self.defaultChoice(in: items)
    }

    private func move(_ delta: Int, in items: [GitRef]) {
        guard !items.isEmpty else { return }
        let index = highlighted.flatMap { id in items.firstIndex { $0.fullName == id } } ?? 0
        highlighted = items[min(max(index + delta, 0), items.count - 1)].fullName
    }

    private func checkout(_ ref: GitRef?) {
        guard let ref, !ref.isHead else { return }
        dismiss()
        model.checkout(ref)
    }
}

private struct SwitchBranchRow: View {
    let ref: GitRef

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: ref.isHead ? "checkmark.circle.fill" : (ref.kind == .remoteBranch ? "cloud" : "arrow.triangle.branch"))
                .foregroundStyle(ref.isHead ? Color.accentColor : .secondary)
                .frame(width: 16)
            Text(ref.name)
                .fontWeight(ref.isHead ? .semibold : .regular)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer()
            if let date = ref.date {
                Text(VietnameseDate.relative(date))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
}
