import AppKit
import NhanhCore
import SwiftUI

/// Tên / email commit đang có hiệu lực trong repo (`git config user.name` / `user.email`: local > global).
struct CommitterIdentity: Equatable {
    var name: String?
    var email: String?
}

/// Danh tính commit khác tài khoản GitHub của repo (owner của origin khớp một tài khoản) — gợi ý nhẹ trong ô commit.
struct CommitIdentityHint: Equatable {
    let owner: String
    let profile: GitHubAccountProfile
    let current: CommitterIdentity
}

extension RepoModel {
    // MARK: - Tài khoản GitHub của repo

    /// Owner (người dùng / tổ chức) của remote origin trên github.com (không có origin thì remote đầu tiên).
    var originOwner: String? {
        let remote = remotes.first { $0.name == "origin" } ?? remotes.first
        return remote.flatMap { GitHubRemoteURL.owner(of: $0.fetchURL) }
    }

    /// Đọc lại tên / email commit đang dùng (sau khi mở repo hoặc đổi danh tính).
    func loadCommitterIdentity() {
        let repo = repository
        Task {
            async let name = repo.config("user.name")
            async let email = repo.config("user.email")
            committerIdentity = CommitterIdentity(name: await name, email: await email)
        }
    }

    /// Có khi owner của origin khớp một tài khoản (tự gán, trùng login, hoặc tổ chức — không tính tài khoản mặc định
    /// dùng cho owner lạ) mà email commit đang dùng khác email của tài khoản đó.
    var commitIdentityHint: CommitIdentityHint? {
        guard let owner = originOwner, let current = committerIdentity,
              let resolution = GitHubAccountManager.shared.resolution(forOwner: owner), resolution.match != .fallback
        else { return nil }
        let profile = resolution.profile
        if let email = current.email, email.caseInsensitiveCompare(profile.commitEmail) == .orderedSame { return nil }
        return CommitIdentityHint(owner: owner, profile: profile, current: current)
    }

    /// Ghi tên / email commit vào config LOCAL của repo này (`git config user.name|user.email`, không --global).
    func applyCommitIdentity(name: String, email: String) {
        perform("Ghi tên & email commit cho repo", refresh: []) { repo in
            try await repo.setConfig("user.name", name, global: false)
            try await repo.setConfig("user.email", email, global: false)
        } onSuccess: { [weak self] in
            self?.loadCommitterIdentity()
            self?.toast(.success, "Repo này giờ commit với tên \(name) <\(email)>")
        }
    }

    // MARK: - Lỗi xác thực GitHub

    /// Fetch / pull / push tới remote HTTPS trên github.com bị từ chối (401 / 403 / 404) với owner X: chưa đăng nhập
    /// thì gợi ý "Đăng nhập GitHub"; đã đăng nhập thì cho biết tài khoản nào đã dùng và gợi ý dùng tài khoản khác cho X.
    func handleGitHubAuthError(_ error: any Error, operation name: String) -> Bool {
        guard let gitError = error as? GitError, let failure = GitHubAuthFailure.detect(in: gitError) else { return false }
        let github = GitHubAccountManager.shared
        guard let used = github.resolution(forOwner: failure.owner)?.profile else {
            showError("\(name) bị GitHub từ chối — chưa đăng nhập GitHub", error, actions: githubLoginActions("Đăng nhập GitHub"))
            return true
        }
        let target = failure.owner.map { "github.com/\($0)" } ?? "repo này"
        var actions: [ToastAction] = []
        if let owner = failure.owner {
            actions.append(ToastAction(title: "Dùng tài khoản khác cho \(owner)…") { [weak self] in
                self?.sheet = .githubAccount(owner: owner)
            })
        }
        switch failure.kind {
        case .unauthenticated:
            showError("Token GitHub của @\(used.login) không còn hợp lệ — đăng nhập lại", error,
                      actions: githubLoginActions("Đăng nhập lại") + actions)
        case .forbidden:
            let settings = github.authorizationSettingsURL
            showError("GitHub từ chối quyền của @\(used.login) với \(target)", error, actions: actions + [
                ToastAction(title: "Xem quyền của Thaigit") { NSWorkspace.shared.open(settings) },
            ])
        case .notFound:
            showError("@\(used.login) không thấy repo trên \(target) — repo riêng tư có thể cần tài khoản khác", error,
                      actions: actions + githubLoginActions("Thêm tài khoản…"))
        }
        return true
    }

    /// Nút mở hộp đăng nhập GitHub trên thông báo (không có khi bản build chưa cấu hình Client ID).
    func githubLoginActions(_ title: String) -> [ToastAction] {
        guard GitHubAccountManager.shared.isConfigured else { return [] }
        return [ToastAction(title: title) { [weak self] in self?.sheet = .githubLogin }]
    }
}
