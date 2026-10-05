import AppKit
import NhanhCore
import SwiftUI

/// Danh sách Pull Request đang mở của repo trên GitHub (remote mặc định), tải qua API.
struct PullRequestList: Equatable {
    enum State: Equatable {
        case idle
        /// Remote mặc định không ở github.com — sidebar ẩn mục PULL REQUESTS.
        case notGitHub
        case loading
        case loaded
        /// Repo riêng tư (hoặc không thấy) khi chưa đăng nhập GitHub.
        case needsLogin
        case failed(String)
    }

    var state: State = .idle
    var items: [GitHubPullRequest] = []
    var repo: GitHubRepoRef?
    /// Tên remote (trên máy) của repo GitHub đó, ví dụ "origin".
    var remoteName: String?
    var loadedAt: Date?
    /// PR trong cùng repo theo tên nhánh (PR từ fork không có nhánh trên remote này).
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
    /// Remote (tên + repo GitHub) dùng cho Pull Request: remote mặc định nếu ở GitHub, không thì remote GitHub đầu tiên.
    var githubRemote: (name: String, repo: GitHubRepoRef)? {
        let ordered = remotes.filter { $0.name == defaultRemote } + remotes
        for remote in ordered {
            if let repo = GitHubRepoRef.parse(remoteURL: remote.fetchURL) { return (remote.name, repo) }
        }
        return nil
    }

    /// Có tài khoản GitHub dùng được cho owner của repo (để tạo PR) — không đọc token ở đây.
    var canUseGitHubAccount: Bool {
        guard let owner = githubRemote?.repo.owner else { return false }
        return GitHubAccountManager.shared.resolution(forOwner: owner) != nil
    }

    // MARK: - Tải danh sách

    /// Tải lại PR đang mở (sau khi mở repo, đổi remote, fetch). Không tải lại nếu vừa tải trong 20 giây, trừ khi `force`.
    func loadPullRequests(force: Bool = false) {
        guard let github = githubRemote else {
            pullRequestsTask?.cancel()
            if pullRequests.state != .notGitHub { pullRequests = PullRequestList(state: .notGitHub) }
            return
        }
        // Kịch bản chụp ảnh không gọi GitHub thật.
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
            // Token của tài khoản ứng với owner (có thể phải đọc Keychain): lấy ngoài luồng chính, chỉ gửi tới api.github.com.
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

    /// PR đang mở từ một nhánh: nhánh remote của repo GitHub, hoặc nhánh local theo dõi nhánh đó.
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

    /// Gắn số PR vào nhãn nhánh trên graph (gọi khi dựng nhãn).
    func markPullRequests(in labels: inout [RefLabel]) {
        guard !pullRequests.byHeadBranch.isEmpty else { return }
        for index in labels.indices where !labels[index].isTag && !labels[index].isDetachedHead {
            if let pull = labels[index].refs.lazy.compactMap({ self.pullRequest(for: $0) }).first {
                labels[index].pullRequest = PullRequestBadge(number: pull.number, title: pull.title)
            }
        }
    }

    // MARK: - Thao tác với một PR

    /// Bấm vào PR: nhảy tới commit đầu nhánh của PR trên graph (nếu đã có trên máy).
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

    /// Checkout nhánh của PR: PR trong cùng repo thì checkout nhánh remote (tạo nhánh local theo dõi nó);
    /// PR từ fork thì lấy `refs/pull/N/head` về nhánh local `pr/N`.
    func checkoutPullRequest(_ pull: GitHubPullRequest) {
        guard let github = githubRemote else { return }
        let remote = github.name, repo = github.repo
        if pull.isSameRepository(as: repo) {
            if let remoteRef = remoteBranches.first(where: { $0.remoteName == remote && $0.shortBranchName == pull.headBranch }) {
                checkout(remoteRef)
            } else {
                // Chưa fetch nhánh này: fetch remote rồi checkout.
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

    /// Mục menu của nhánh: mở PR đang có, hoặc tạo PR mới từ nhánh này (remote GitLab: tạo Merge Request).
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

    // MARK: - Tạo PR

    /// Mở hộp tạo PR (remote GitLab: Merge Request) cho nhánh `ref` (mặc định: nhánh hiện tại).
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

    /// Nhánh local tên `head` cần push trước khi tạo PR (chưa có trên remote GitHub hoặc còn commit chưa push).
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

    /// Tên nhánh trên GitHub ứng với `head` (nhánh local đã có upstream thì lấy tên nhánh upstream).
    func pullRequestHeadBranch(_ head: String) -> String {
        if let local = localBranches.first(where: { $0.name == head }), let upstream = local.upstream,
           let target = splitUpstream(upstream), target.remote == forgeRemote?.name {
            return target.branch
        }
        return head
    }

    /// Push (nếu cần) rồi gửi PR lên GitHub (remote GitLab: Merge Request). Chỉ gửi tiêu đề / mô tả / tên nhánh người dùng vừa xem
    /// trong hộp thoại.
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
            // Mở luôn review của PR vừa tạo để gán người review / người xử lý.
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
