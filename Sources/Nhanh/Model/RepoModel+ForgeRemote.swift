import AppKit
import NhanhCore

/// The host a Pull Request / Merge Request is created on.
enum ForgeKind: Equatable {
    case github
    case gitlab

    /// "PR" / "MR" — the label on the toolbar button.
    var shortName: String { self == .github ? "PR" : "MR" }
    var siteName: String { self == .github ? "GitHub" : "GitLab" }
}

/// The repo's remote on GitHub or GitLab, used to create Pull Requests / Merge Requests.
struct ForgeRemote: Equatable {
    let name: String
    let kind: ForgeKind
    /// "github.com/owner/repo", "gitlab.com/group/project" — shown in the dialog.
    let siteName: String
    let github: GitHubRepoRef?
    let gitlab: GitLabProjectRef?
}

extension RepoModel {
    /// The first GitLab remote (the default remote preferred); also matches the self-hosted hosts of added accounts.
    var gitlabRemote: (name: String, project: GitLabProjectRef)? {
        let hosts = GitLabAccountManager.shared.store.hosts
        let ordered = remotes.filter { $0.name == defaultRemote } + remotes
        for remote in ordered {
            if let project = GitLabProjectRef.parse(remoteURL: remote.fetchURL, knownHosts: hosts) { return (remote.name, project) }
        }
        return nil
    }

    /// The remote used for PR / MR: the default remote when it's GitHub or GitLab, otherwise the first recognisable one.
    var forgeRemote: ForgeRemote? {
        let hosts = GitLabAccountManager.shared.store.hosts
        let ordered = remotes.filter { $0.name == defaultRemote } + remotes
        for remote in ordered {
            if let repo = GitHubRepoRef.parse(remoteURL: remote.fetchURL) {
                return ForgeRemote(name: remote.name, kind: .github, siteName: "github.com/\(repo.owner)/\(repo.name)", github: repo, gitlab: nil)
            }
            if let project = GitLabProjectRef.parse(remoteURL: remote.fetchURL, knownHosts: hosts) {
                return ForgeRemote(name: remote.name, kind: .gitlab, siteName: project.displayName, github: nil, gitlab: project)
            }
        }
        return nil
    }

    /// Whether a usable account exists to create a PR / MR on this remote — no token is read here.
    var canUseForgeAccount: Bool {
        guard let forge = forgeRemote else { return false }
        switch forge.kind {
        case .github: return canUseGitHubAccount
        case .gitlab: return forge.gitlab.map { GitLabAccountManager.shared.store.account(forHost: $0.host) != nil } ?? false
        }
    }

    /// Push (if needed) then send the Merge Request to GitLab. Only the title / description / branch name the user just reviewed in the dialog are sent.
    func createMergeRequest(_ new: NewPullRequest, in project: GitLabProjectRef, pushFirst push: PushRequest?) {
        let progress = progressReporter()
        let accounts = GitLabAccountManager.shared.store
        var created: GitLabMergeRequest?
        perform(push == nil ? String(localized: "Tạo Merge Request") : String(localized: "Push & tạo Merge Request"), showsProgress: true, refresh: [.refs, .status]) { git in
            if let push {
                try await git.push(remote: push.remote, localBranch: push.localBranch, remoteBranch: push.remoteBranch,
                                   setUpstream: push.setUpstream, force: false, onProgress: progress)
            }
            let token = await Task.detached { await accounts.apiToken(forHost: project.host) }.value
            guard let token else { throw GitLabError.unauthorized }
            let request = NewMergeRequest(title: new.title, description: new.body, sourceBranch: new.head, targetBranch: new.base, draft: new.draft)
            created = try await GitLabAPI().createMergeRequest(request, in: project, token: token)
        } onSuccess: { [weak self] in
            guard let self, let created else { return }
            // Open the review of the just-created MR right away so reviewers / assignees can be set.
            let request = ForgeRequest(kind: .gitlab, number: created.iid, title: created.title, body: new.body, author: "",
                                       isDraft: new.draft, webURL: created.webURL, sourceBranch: new.head, targetBranch: new.base,
                                       headSHA: nil, updatedAt: Date())
            var actions = [ToastAction(title: String(localized: "Xem & gán reviewer")) { [weak self] in self?.openReview(request) }]
            if let url = created.webURL {
                actions.append(ToastAction(title: String(localized: "Mở trên GitLab")) { NSWorkspace.shared.open(url) })
            }
            toast(.success, String(localized: "Đã tạo Merge Request !\(created.iid)"), message: created.title, actions: actions)
            loadMergeRequests(force: true)
        } onError: { [weak self] error in
            guard let self else { return false }
            if case GitLabError.unauthorized = error {
                showError(String(localized: "Cần thêm tài khoản GitLab (có quyền với \(project.displayName)) trong Cài đặt để tạo Merge Request"), error)
                return true
            }
            return false
        }
    }
}
