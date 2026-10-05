import AppKit
import NhanhCore
import SwiftUI

/// The commit name / email currently in effect in the repo (`git config user.name` / `user.email`: local > global).
struct CommitterIdentity: Equatable {
    var name: String?
    var email: String?
}

/// The commit identity of a different GitHub account than the repo's (the origin's owner matches an account) — a gentle hint in the commit box.
struct CommitIdentityHint: Equatable {
    let owner: String
    let profile: GitHubAccountProfile
    let current: CommitterIdentity
}

extension RepoModel {
    // MARK: - The repo's GitHub accounts

    /// The origin remote's address (the first remote when there is no origin).
    var originURL: String? {
        (remotes.first { $0.name == "origin" } ?? remotes.first)?.fetchURL
    }

    /// The owner (user / organisation) of the origin remote on github.com (the first remote when there is no origin).
    var originOwner: String? {
        originURL.flatMap { GitHubRemoteURL.owner(of: $0) }
    }

    /// Re-read the commit name / email in use (after opening the repo or changing the identity).
    func loadCommitterIdentity() {
        let repo = repository
        Task {
            async let name = repo.config("user.name")
            async let email = repo.config("user.email")
            committerIdentity = CommitterIdentity(name: await name, email: await email)
        }
    }

    /// Present when the origin's owner matches an account (user-assigned, matching login, or an organisation — the default
    /// account used for an unknown owner doesn't count) and the commit email in use differs from that account's email.
    var commitIdentityHint: CommitIdentityHint? {
        guard let owner = originOwner, let current = committerIdentity,
              let resolution = GitHubAccountManager.shared.resolution(forOwner: owner), resolution.match != .fallback
        else { return nil }
        let profile = resolution.profile
        if let email = current.email, email.caseInsensitiveCompare(profile.commitEmail) == .orderedSame { return nil }
        return CommitIdentityHint(owner: owner, profile: profile, current: current)
    }

    /// Write the commit name / email into THIS repo's local config (`git config user.name|user.email`, no --global).
    func applyCommitIdentity(name: String, email: String) {
        perform(String(localized: "Ghi tên & email commit cho repo"), refresh: []) { repo in
            try await repo.setConfig("user.name", name, global: false)
            try await repo.setConfig("user.email", email, global: false)
        } onSuccess: { [weak self] in
            self?.loadCommitterIdentity()
            self?.toast(.success, String(localized: "Repo này giờ commit với tên \(name) <\(email)>"))
        }
    }

    // MARK: - GitHub authentication errors

    /// A fetch / pull / push to an HTTPS remote on github.com was refused (401 / 403 / 404) for owner X: when not signed in
    /// suggest "Sign in to GitHub"; when signed in name the account that was used and suggest a different one for X.
    func handleGitHubAuthError(_ error: any Error, operation name: String) -> Bool {
        guard let gitError = error as? GitError, let failure = GitHubAuthFailure.detect(in: gitError) else { return false }
        let github = GitHubAccountManager.shared
        guard let used = github.resolution(forOwner: failure.owner)?.profile else {
            showError(String(localized: "\(name) bị GitHub từ chối — chưa đăng nhập GitHub"), error, actions: githubLoginActions(String(localized: "Đăng nhập GitHub")))
            return true
        }
        // The owner's account token couldn't be read (Keychain failure / denied): git must not fall back to another account's token.
        if !github.loginsWithToken.contains(used.login) {
            showError(String(localized: "Chưa đọc được token của @\(used.login) — đăng nhập lại tài khoản này"), error,
                      actions: githubLoginActions(String(localized: "Đăng nhập lại @\(used.login)")))
            return true
        }
        let target = failure.owner.map { "github.com/\($0)" } ?? String(localized: "repo này")
        var actions: [ToastAction] = []
        if let owner = failure.owner {
            actions.append(ToastAction(title: String(localized: "Dùng tài khoản khác cho \(owner)…")) { [weak self] in
                self?.sheet = .githubAccount(owner: owner)
            })
        }
        switch failure.kind {
        case .unauthenticated:
            showError(String(localized: "Token GitHub của @\(used.login) không còn hợp lệ — đăng nhập lại"), error,
                      actions: githubLoginActions(String(localized: "Đăng nhập lại")) + actions)
        case .forbidden:
            let settings = github.authorizationSettingsURL
            showError(String(localized: "GitHub từ chối quyền của @\(used.login) với \(target)"), error, actions: actions + [
                ToastAction(title: String(localized: "Xem quyền của Thaigit")) { NSWorkspace.shared.open(settings) },
            ])
        case .notFound:
            showError(String(localized: "@\(used.login) không thấy repo trên \(target) — repo riêng tư có thể cần tài khoản khác"), error,
                      actions: actions + githubLoginActions(String(localized: "Thêm tài khoản…")))
        }
        return true
    }

    /// The button that opens the GitHub sign-in dialog on the notification (absent when the build has no client ID configured).
    func githubLoginActions(_ title: String) -> [ToastAction] {
        guard GitHubAccountManager.shared.isConfigured else { return [] }
        return [ToastAction(title: title) { [weak self] in self?.sheet = .githubLogin }]
    }
}
