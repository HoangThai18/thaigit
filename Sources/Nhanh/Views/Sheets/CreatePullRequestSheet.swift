import NhanhCore
import SwiftUI

/// Tạo Pull Request trên GitHub như GitKraken: chọn nhánh đích, tiêu đề và mô tả điền sẵn từ các commit của nhánh,
/// nhánh chưa push thì push trước rồi mới tạo.
struct CreatePullRequestSheet: View {
    @Bindable var model: RepoModel
    /// Nhánh local (hoặc tên nhánh trên remote GitHub) chứa thay đổi.
    let head: String
    @Environment(\.dismiss) private var dismiss

    @State private var base = ""
    @State private var title = ""
    @State private var bodyText = ""
    @State private var draft = false
    @State private var commits: [Commit] = []
    @State private var isLoadingCommits = false
    @State private var defaultBranch: String?
    @State private var didPrefill = false
    @FocusState private var titleFocused: Bool

    private var remote: String { model.githubRemote?.name ?? "origin" }
    private var repoName: String { model.githubRemote.map { "\($0.repo.owner)/\($0.repo.name)" } ?? "" }
    private var headBranch: String { model.pullRequestHeadBranch(head) }
    private var push: PushRequest? { model.pendingPush(forPullRequestHead: head) }

    /// Nhánh đích có thể chọn: các nhánh của remote GitHub, trừ chính nhánh của PR.
    private var baseChoices: [String] {
        model.remoteBranches
            .filter { $0.remoteName == remote && $0.shortBranchName != "HEAD" && $0.shortBranchName != headBranch }
            .map(\.shortBranchName)
    }

    /// Commit sẽ có trong PR: local nếu có nhánh local tên `head`, không thì nhánh trên remote.
    private var headRevision: String {
        model.localBranches.contains { $0.name == head } ? head : "\(remote)/\(headBranch)"
    }

    private var trimmedTitle: String { title.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var canCreate: Bool {
        !trimmedTitle.isEmpty && !base.isEmpty && model.canUseGitHubAccount && !(commits.isEmpty && !isLoadingCommits && push == nil)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 3) {
                Label("Tạo Pull Request", systemImage: "arrow.triangle.pull")
                    .font(.title3.bold())
                Text("Trên github.com/\(repoName)")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }

            HStack(spacing: 8) {
                branchChip(headBranch, systemImage: "arrow.triangle.branch")
                Image(systemName: "arrow.right").foregroundStyle(.secondary)
                Picker("", selection: $base) {
                    ForEach(baseChoices, id: \.self) { name in
                        Text(name).tag(name)
                    }
                }
                .labelsHidden()
                .frame(maxWidth: 240)
                .help("Nhánh sẽ nhận thay đổi")
                Spacer()
            }

            TextField("Tiêu đề", text: $title)
                .textFieldStyle(.roundedBorder)
                .font(.body.weight(.medium))
                .focused($titleFocused)

            VStack(alignment: .leading, spacing: 4) {
                Text("Mô tả").font(.caption).foregroundStyle(.secondary)
                TextEditor(text: $bodyText)
                    .font(.body)
                    .scrollContentBackground(.hidden)
                    .padding(6)
                    .background(RoundedRectangle(cornerRadius: 6).fill(Color.primary.opacity(0.05)))
                    .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Color.primary.opacity(0.12)))
                    .frame(minHeight: 140)
            }

            commitSummary

            Toggle("Tạo dạng nháp (Draft) — chưa nhờ review", isOn: $draft)

            notes

            HStack {
                Spacer()
                Button("Huỷ") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                if model.canUseGitHubAccount {
                    Button(push == nil ? "Tạo Pull Request" : "Push & tạo Pull Request") {
                        model.createPullRequest(NewPullRequest(title: trimmedTitle, body: bodyText, head: headBranch, base: base, draft: draft),
                                                pushFirst: push)
                        dismiss()
                    }
                    .keyboardShortcut(.defaultAction)
                    .disabled(!canCreate)
                } else {
                    Button("Đăng nhập GitHub…") { model.sheet = .githubLogin }
                        .keyboardShortcut(.defaultAction)
                        .disabled(!GitHubAccountManager.shared.isConfigured)
                }
            }
        }
        .padding(22)
        .frame(width: 560)
        .task { await loadDefaultBranch() }
        .task(id: base) { await loadCommits() }
        .onAppear { titleFocused = true }
    }

    private func branchChip(_ name: String, systemImage: String) -> some View {
        Label(name, systemImage: systemImage)
            .lineLimit(1)
            .truncationMode(.middle)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(Capsule().fill(Brand.blue.opacity(0.15)))
    }

    @ViewBuilder
    private var commitSummary: some View {
        if isLoadingCommits {
            ProgressView().controlSize(.small)
        } else if !base.isEmpty {
            if commits.isEmpty {
                Text(push == nil ? "Nhánh này không có commit nào mà \(base) chưa có — chưa có gì để tạo PR."
                                 : "Chưa so được với \(base) — sẽ biết sau khi push.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                Text("\(commits.count)\(commits.count >= 300 ? "+" : "") commit sẽ vào \(base)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private var notes: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let push {
                Label(push.setUpstream ? "Nhánh \(head) chưa có trên \(remote) — sẽ push lên trước."
                                       : "Nhánh \(head) còn commit chưa push — sẽ push lên \(remote)/\(push.remoteBranch) trước.",
                      systemImage: "arrow.up.circle")
                    .foregroundStyle(.orange)
            }
            if !model.canUseGitHubAccount {
                Label(GitHubAccountManager.shared.isConfigured
                      ? "Cần đăng nhập tài khoản GitHub có quyền với \(repoName) để tạo Pull Request."
                      : GitHubAccountManager.notConfiguredMessage,
                      systemImage: "person.crop.circle.badge.exclamationmark")
                    .foregroundStyle(.secondary)
            } else {
                Text("Tiêu đề, mô tả và tên hai nhánh sẽ được gửi lên GitHub.")
                    .foregroundStyle(.secondary)
            }
        }
        .font(.caption)
    }

    // MARK: - Dữ liệu

    private func loadDefaultBranch() async {
        let choices = baseChoices
        // Đoán trước bằng nhánh hay dùng, rồi hỏi GitHub nhánh mặc định thật.
        if base.isEmpty {
            base = ["main", "master", "develop"].first(where: choices.contains) ?? choices.first ?? ""
        }
        guard let repo = model.githubRemote?.repo, !AutomationHarness.isActive else { return }
        let token = await Task.detached { GitHubAccountManager.shared.apiToken(forOwner: repo.owner) }.value
        if let branch = try? await GitHubRepoAPI().defaultBranch(of: repo, token: token), choices.contains(branch) {
            defaultBranch = branch
            if !didPrefill || commits.isEmpty { base = branch }
        }
    }

    private func loadCommits() async {
        guard !base.isEmpty else { return }
        isLoadingCommits = true
        defer { isLoadingCommits = false }
        let list = (try? await model.repository.commits(from: "\(remote)/\(base)", to: headRevision)) ?? []
        guard !Task.isCancelled else { return }
        commits = list
        guard !didPrefill, !list.isEmpty else { return }
        // Một commit: mô tả là phần thân lời commit (bỏ dòng tiêu đề).
        var singleBody = ""
        if list.count == 1, let message = try? await model.repository.commitMessage(list[0].id) {
            singleBody = message.split(separator: "\n", maxSplits: 1, omittingEmptySubsequences: false).dropFirst().joined()
                .trimmingCharacters(in: .whitespacesAndNewlines)
        }
        prefill(singleBody: singleBody)
    }

    /// Điền tiêu đề / mô tả một lần: một commit thì lấy lời commit đó, nhiều commit thì tên nhánh dễ đọc + danh sách commit.
    private func prefill(singleBody: String) {
        guard !didPrefill, !commits.isEmpty else { return }
        didPrefill = true
        if trimmedTitle.isEmpty {
            title = commits.count == 1 ? commits[0].subject : Self.readableTitle(headBranch)
        }
        if bodyText.isEmpty {
            if commits.count == 1 {
                bodyText = singleBody
            } else {
                bodyText = commits.reversed().prefix(50).map { "- \($0.subject)" }.joined(separator: "\n")
            }
        }
    }

    /// "feature/gio-hang_moi" → "Gio hang moi".
    static func readableTitle(_ branch: String) -> String {
        let last = branch.split(separator: "/").last.map(String.init) ?? branch
        let words = last.replacingOccurrences(of: "-", with: " ").replacingOccurrences(of: "_", with: " ")
            .trimmingCharacters(in: .whitespaces)
        guard let first = words.first else { return branch }
        return first.uppercased() + words.dropFirst()
    }
}
