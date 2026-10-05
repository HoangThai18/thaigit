import AppKit
import NhanhCore
import SwiftUI

/// The repo's open Pull Requests on GitHub (default remote), loaded through the API.
struct PullRequestList: Equatable {
    enum State: Equatable {
        case idle
        /// The default remote isn't on github.com — the sidebar hides the PULL REQUESTS section.
        case notGitHub
        case loading
        case loaded
        /// A private repo (or not visible) while not signed in to GitHub.
        case needsLogin
        case failed(String)
    }

    var state: State = .idle
    var items: [GitHubPullRequest] = []
    var repo: GitHubRepoRef?
    /// The local remote name of that GitHub repo, e.g. "origin".
    var remoteName: String?
    var loadedAt: Date?
    /// The PR in the same repo, by branch name (a forked PR has no branch on this remote).
    var byHeadBranch: [String: GitHubPullRequest] = [:]

    init(state: State = .idle, items: [GitHubPullRequest] = [], repo: GitHubRepoRef? = nil, remoteName: String? = nil,
         loadedAt: Date? = nil) {
        self.state = state
        self.items = items
        self.repo = repo
        self.remoteName = remoteName
        self.loadedAt = loadedAt
        if let repo {
            for pull in items where pull.isSameRepository(as: repo) && byHeadBranch[pull.headBranch] == nil {
                byHeadBranch[pull.headBranch] = pull
            }
        }
    }
}

extension RepoModel {
    /// The remote (name + GitHub repo) used for Pull Requests: the default remote when it's GitHub, otherwise the first GitHub remote.
    var githubRemote: (name: String, repo: GitHubRepoRef)? {
        let ordered = remotes.filter { $0.name == defaultRemote } + remotes
        for remote in ordered {
            if let repo = GitHubRepoRef.parse(remoteURL: remote.fetchURL) { return (remote.name, repo) }
        }
        return nil
    }

    /// Whether a usable GitHub account exists for the repo's owner (to create a PR) — no token is read here.
    var canUseGitHubAccount: Bool {
        guard let owner = githubRemote?.repo.owner else { return false }
        return GitHubAccountManager.shared.resolution(forOwner: owner) != nil
    }

    // MARK: - Loading the list

    /// Reload the open PRs (after opening the repo, changing the remote, a fetch). Not reloaded if it ran less than 20 seconds ago, unless `force`.
    func loadPullRequests(force: Bool = false) {
        guard let github = githubRemote else {
            pullRequestsTask?.cancel()
            if pullRequests.state != .notGitHub { pullRequests = PullRequestList(state: .notGitHub) }
            return
        }
        // A screenshot run never calls the real GitHub.
        if AutomationHarness.isActive { return }
        let repo = github.repo, remoteName = github.name
        if !force, pullRequests.repo == repo, pullRequests.state == .loading { return }
        if !force, pullRequests.repo == repo, let loadedAt = pullRequests.loadedAt, Date().timeIntervalSince(loadedAt) < 20 { return }
        pullRequestsTask?.cancel()
        if pullRequests.repo != repo || pullRequests.remoteName != remoteName {
            pullRequests = PullRequestList(repo: repo, remoteName: remoteName)
        }
        pullRequests.state = .loading
        pullRequestsTask = Task {
            // The token of the account matching the owner (may require a Keychain read): fetched off the main actor, sent only to api.github.com.
            let token = await Task.detached { GitHubAccountManager.shared.apiToken(forOwner: repo.owner) }.value
            do {
                let items = try await GitHubRepoAPI().openPullRequests(in: repo, token: token)
                guard !Task.isCancelled, pullRequests.repo == repo else { return }
                pullRequests = PullRequestList(state: .loaded, items: items, repo: repo, remoteName: remoteName, loadedAt: Date())
                syncReviewWithLists(kind: .github)
            } catch {
                guard !Task.isCancelled, !(error is CancellationError), pullRequests.repo == repo else { return }
                var list = PullRequestList(repo: repo, remoteName: remoteName, loadedAt: Date())
                switch error {
                case GitHubRepoAPIError.notFound where token == nil, GitHubRepoAPIError.rateLimited where token == nil:
                    list.state = .needsLogin
                default:
                    list.state = .failed(FriendlyError.message(for: error))
                }
                pullRequests = list
            }
            refreshLabels()
        }
    }

    /// An open PR from a branch: the GitHub repo's remote branch, or the local branch tracking it.
    func pullRequest(for ref: GitRef) -> GitHubPullRequest? {
        guard !pullRequests.byHeadBranch.isEmpty, let remote = pullRequests.remoteName else { return nil }
        let branch: String
        switch ref.kind {
        case .remoteBranch:
            guard ref.remoteName == remote else { return nil }
            branch = ref.shortBranchName
        case .localBranch:
            guard let upstream = ref.upstream, upstream.hasPrefix(remote + "/") else { return nil }
            branch = String(upstream.dropFirst(remote.count + 1))
        case .tag:
            return nil
        }
        return pullRequests.byHeadBranch[branch]
    }

    /// Attach PR numbers to the branch labels on the graph (called while building the labels).
    func markPullRequests(in labels: inout [RefLabel]) {
        guard !pullRequests.byHeadBranch.isEmpty else { return }
        for index in labels.indices where !labels[index].isTag && !labels[index].isDetachedHead {
            if let pull = labels[index].refs.lazy.compactMap({ self.pullRequest(for: $0) }).first {
                labels[index].pullRequest = PullRequestBadge(number: pull.number, title: pull.title)
            }
        }
    }

    // MARK: - Working with one PR

    /// Clicking a PR: jump to the commit at the tip of its branch on the graph (when it's already on the machine).
    func revealPullRequest(_ pull: GitHubPullRequest) {
        if row(for: .commit(pull.headSHA)) != nil {
            reveal(commit: pull.headSHA)
            return
        }
        toast(.info, String(localized: "Commit mới nhất của PR #\(pull.number) chưa có trên graph"),
              message: String(localized: "Fetch để lấy nhánh \(pull.headBranch) về, hoặc checkout PR."),
              actions: [
                  ToastAction(title: "Fetch") { [weak self] in self?.fetch() },
                  ToastAction(title: "Checkout PR") { [weak self] in self?.checkoutPullRequest(pull) },
              ])
    }

    /// Check out a PR's branch: a same-repo PR checks out the remote branch (creating a local branch tracking it);
    /// a forked PR fetches `refs/pull/N/head` into the local branch `pr/N`.
    func checkoutPullRequest(_ pull: GitHubPullRequest) {
        guard let github = githubRemote else { return }
        let remote = github.name, repo = github.repo
        if pull.isSameRepository(as: repo) {
            if let remoteRef = remoteBranches.first(where: { $0.remoteName == remote && $0.shortBranchName == pull.headBranch }) {
                checkout(remoteRef)
            } else {
                // This branch hasn't been fetched yet: fetch the remote, then check out.
                let progress = progressReporter()
                perform("Fetch \(remote)", showsProgress: true, cancellable: true, refresh: [.refs, .status]) { repo in
                    try await repo.fetch(remote: remote, prune: false, onProgress: progress)
                } onSuccess: { [weak self] in
                    guard let self else { return }
                    Task {
                        await self.refreshAndWait([.refs])
                        if let ref = self.remoteBranches.first(where: { $0.remoteName == remote && $0.shortBranchName == pull.headBranch }) {
                            self.checkout(ref)
                        } else {
                            self.toast(.warning, String(localized: "Không thấy nhánh \(remote)/\(pull.headBranch) sau khi fetch"))
                        }
                    }
                } onError: { [weak self] error in
                    self?.handleGitHubAuthError(error, operation: "Fetch") ?? false
                }
            }
            return
        }
        let local = "pr/\(pull.number)"
        if local == currentBranch {
            toast(.info, String(localized: "Đang ở nhánh \(local)"))
            return
        }
        let progress = progressReporter()
        perform(String(localized: "Lấy PR #\(pull.number)"), showsProgress: true, cancellable: true, refresh: [.refs, .status]) { repo in
            try await repo.fetchPullRequest(pull.number, remote: remote, into: local, onProgress: progress)
        } onSuccess: { [weak self] in
            self?.switchToBranch(local)
        } onError: { [weak self] error in
            guard let self else { return false }
            if handleGitHubAuthError(error, operation: String(localized: "Lấy PR #\(pull.number)")) { return true }
            if let gitError = error as? GitError, gitError.contains("non-fast-forward") || gitError.contains("rejected") {
                showError(String(localized: "Nhánh \(local) trên máy đã có commit riêng — không ghi đè"), error)
                return true
            }
            return false
        }
    }

    func openOnGitHub(_ pull: GitHubPullRequest) {
        guard let url = pull.webURL else { return }
        NSWorkspace.shared.open(url)
    }

    func pullRequestMenu(_ pull: GitHubPullRequest) -> [MenuItemSpec] {
        var items: [MenuItemSpec] = [
            .action(String(localized: "Mở PR #\(pull.number) trên GitHub"), systemImage: "safari", enabled: pull.webURL != nil) { [weak self] in
                self?.openOnGitHub(pull)
            },
            .action(String(localized: "Checkout nhánh của PR"), systemImage: "arrow.uturn.right") { [weak self] in self?.checkoutPullRequest(pull) },
            .action(String(localized: "Xem & review PR #\(pull.number)"), systemImage: "text.badge.checkmark") { [weak self] in
                self?.openReview(pull.forgeRequest)
            },
            .action(String(localized: "Tới commit mới nhất của PR"), systemImage: "scope") { [weak self] in self?.revealPullRequest(pull) },
            .separator,
        ]
        if let url = pull.webURL {
            items.append(.action(String(localized: "Sao chép đường dẫn PR"), systemImage: "link") { [weak self] in
                self?.copy(url.absoluteString, label: String(localized: "đường dẫn PR"))
            })
        }
        items.append(.action(String(localized: "Tải lại danh sách PR"), systemImage: "arrow.clockwise") { [weak self] in
            self?.loadPullRequests(force: true)
        })
        return items
    }

    /// A branch's menu item: open its existing PR, or create a new one from that branch (on a GitLab remote: create a Merge Request).
    func pullRequestMenuItems(for ref: GitRef) -> [MenuItemSpec] {
        if let forge = forgeRemote, forge.kind == .gitlab, ref.kind != .tag {
            if ref.kind == .remoteBranch, ref.remoteName != forge.name { return [] }
            return [.action(String(localized: "Tạo Merge Request từ \(ref.kind == .remoteBranch ? ref.shortBranchName : ref.name)…"),
                            systemImage: "arrow.triangle.pull") { [weak self] in
                self?.beginCreatePullRequest(from: ref)
            }]
        }
        guard let remote = githubRemote?.name, ref.kind != .tag else { return [] }
        if let pull = pullRequest(for: ref) {
            return [.action(String(localized: "Mở Pull Request #\(pull.number) trên GitHub"), systemImage: "arrow.triangle.pull", enabled: pull.webURL != nil) {
                [weak self] in self?.openOnGitHub(pull)
            }]
        }
        if ref.kind == .remoteBranch, ref.remoteName != remote { return [] }
        return [.action(String(localized: "Tạo Pull Request từ \(ref.kind == .remoteBranch ? ref.shortBranchName : ref.name)…"),
                        systemImage: "arrow.triangle.pull") { [weak self] in
            self?.beginCreatePullRequest(from: ref)
        }]
    }

    // MARK: - Creating a PR

    /// Open the create-PR dialog (on a GitLab remote: Merge Request) for branch `ref` (the current branch by default).
    func beginCreatePullRequest(from ref: GitRef? = nil) {
        guard let forge = forgeRemote else {
            toast(.info, String(localized: "Repo này chưa có remote trên GitHub hoặc GitLab"))
            return
        }
        guard let ref = ref ?? currentBranchRef else {
            toast(.warning, forge.kind == .github
                ? String(localized: "Cần đứng trên một nhánh (hoặc chuột phải vào nhánh) để tạo Pull Request")
                : String(localized: "Cần đứng trên một nhánh (hoặc chuột phải vào nhánh) để tạo Merge Request"))
            return
        }
        sheet = .createPullRequest(head: ref.kind == .remoteBranch ? ref.shortBranchName : ref.name)
    }

    /// The local branch `head` that has to be pushed before creating a PR (not on the GitHub remote yet, or with commits still unpushed).
    func pendingPush(forPullRequestHead head: String) -> PushRequest? {
        guard let remote = forgeRemote?.name,
              let local = localBranches.first(where: { $0.name == head }) else { return nil }
        if let upstream = local.upstream, !local.upstreamGone, let target = splitUpstream(upstream), target.remote == remote {
            return local.ahead > 0
                ? PushRequest(localBranch: local.name, remote: remote, remoteBranch: target.branch, setUpstream: false, force: false)
                : nil
        }
        return PushRequest(localBranch: local.name, remote: remote, remoteBranch: local.name, setUpstream: true, force: false)
    }

    /// The branch name on GitHub matching `head` (a local branch with an upstream uses that upstream's branch name).
    func pullRequestHeadBranch(_ head: String) -> String {
        if let local = localBranches.first(where: { $0.name == head }), let upstream = local.upstream,
           let target = splitUpstream(upstream), target.remote == forgeRemote?.name {
            return target.branch
        }
        return head
    }

    /// Push (if needed) then send the PR to GitHub (on a GitLab remote: a Merge Request). Only the title / description / branch name
    /// the user just reviewed in the dialog are sent.
    func createPullRequest(_ new: NewPullRequest, pushFirst push: PushRequest?) {
        if let forge = forgeRemote, forge.kind == .gitlab, let project = forge.gitlab {
            createMergeRequest(new, in: project, pushFirst: push)
            return
        }
        guard let repo = forgeRemote?.github else { return }
        let progress = progressReporter()
        var created: GitHubPullRequest?
        perform(push == nil ? String(localized: "Tạo Pull Request") : String(localized: "Push & tạo Pull Request"), showsProgress: true, refresh: [.refs, .status]) { git in
            if let push {
                try await git.push(remote: push.remote, localBranch: push.localBranch, remoteBranch: push.remoteBranch,
                                   setUpstream: push.setUpstream, force: false, onProgress: progress)
            }
            let token = await Task.detached { GitHubAccountManager.shared.apiToken(forOwner: repo.owner) }.value
            guard let token else { throw GitHubError.unauthorized }
            created = try await GitHubRepoAPI().createPullRequest(new, in: repo, token: token)
        } onSuccess: { [weak self] in
            guard let self, let created else { return }
            // Open the review of the just-created PR right away so reviewers / assignees can be set.
            let request = created.forgeRequest
            var actions = [ToastAction(title: String(localized: "Xem & gán reviewer")) { [weak self] in self?.openReview(request) }]
            if let url = created.webURL {
                actions.append(ToastAction(title: String(localized: "Mở trên GitHub")) { NSWorkspace.shared.open(url) })
            }
            toast(.success, String(localized: "Đã tạo Pull Request #\(created.number)"), message: created.title, actions: actions)
            loadPullRequests(force: true)
        } onError: { [weak self] error in
            guard let self else { return false }
            if handleGitHubAuthError(error, operation: "Push") { return true }
            if case GitHubError.unauthorized = error {
                showError(String(localized: "Cần đăng nhập GitHub (tài khoản có quyền với \(repo.owner)/\(repo.name)) để tạo Pull Request"), error,
                          actions: githubLoginActions(String(localized: "Đăng nhập GitHub")))
                return true
            }
            return false
        }
    }
}
