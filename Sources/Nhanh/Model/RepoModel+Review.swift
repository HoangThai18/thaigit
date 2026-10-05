import AppKit
import NhanhCore

/// The repo's open Merge Requests on GitLab (preferred remote), loaded through the API.
struct MergeRequestList: Equatable {
    enum State: Equatable {
        case idle
        /// The repo has no GitLab remote — the sidebar hides the MERGE REQUESTS section.
        case notGitLab
        case loading
        case loaded
        /// No GitLab account exists for this server yet.
        case needsAccount
        case failed(String)
    }

    var state: State = .idle
    var items: [ForgeRequest] = []
    var project: GitLabProjectRef?
    /// The local remote name of that GitLab project, e.g. "origin".
    var remoteName: String?
    var loadedAt: Date?
}

/// The list of candidates assignable (reviewers / assignees) on the PR / MR being viewed.
enum ReviewPeopleState: Equatable {
    case idle
    case loading
    case loaded([ForgePerson])
    case failed(String)
}

/// The PR / MR open in the review panel: its branch is already fetched locally, `from` is the point where it
/// diverged from the target branch and `to` is the tip of the PR / MR
/// (which are also the two ends of the `RepoSelection.compare` currently selected).
struct ReviewSession: Equatable {
    var request: ForgeRequest
    let from: String
    let to: String
    var people: ReviewPeopleState = .idle
    /// A reviewer / assignee change is being sent to the host.
    var isSaving = false
}

enum ReviewPeopleRole {
    case reviewers
    case assignees
}

extension RepoModel {
    /// The remote matching `request` (matching host kind): a repo with both a GitHub and a GitLab remote uses each PR / MR's own
    /// host's remote. nil when the repo no longer has that remote.
    func forgeRemoteMatching(_ request: ForgeRequest) -> ForgeRemote? {
        switch request.kind {
        case .github:
            guard let github = githubRemote else { return nil }
            return ForgeRemote(name: github.name, kind: .github, siteName: "github.com/\(github.repo.owner)/\(github.repo.name)",
                               github: github.repo, gitlab: nil)
        case .gitlab:
            guard let gitlab = gitlabRemote else { return nil }
            return ForgeRemote(name: gitlab.name, kind: .gitlab, siteName: gitlab.project.displayName, github: nil, gitlab: gitlab.project)
        }
    }
}

extension RepoModel {
    // MARK: - GitLab: danh sách Merge Request

    /// Reload the open MRs (after opening the repo, changing the remote, a fetch). Not reloaded if it ran less than 20 seconds ago, unless `force`.
    func loadMergeRequests(force: Bool = false) {
        guard let gitlab = gitlabRemote else {
            mergeRequestsTask?.cancel()
            if mergeRequests.state != .notGitLab { mergeRequests = MergeRequestList(state: .notGitLab) }
            return
        }
        // A screenshot run never calls the real GitLab.
        if AutomationHarness.isActive { return }
        let project = gitlab.project, remoteName = gitlab.name
        if !force, mergeRequests.project == project, mergeRequests.state == .loading { return }
        if !force, mergeRequests.project == project, let loadedAt = mergeRequests.loadedAt, Date().timeIntervalSince(loadedAt) < 20 { return }
        mergeRequestsTask?.cancel()
        if mergeRequests.project != project || mergeRequests.remoteName != remoteName {
            mergeRequests = MergeRequestList(project: project, remoteName: remoteName)
        }
        mergeRequests.state = .loading
        let accounts = GitLabAccountManager.shared.store
        mergeRequestsTask = Task {
            // The token of the account matching the host (may require a Keychain read / a token renewal): fetched off the main actor.
            let token = await Task.detached { await accounts.apiToken(forHost: project.host) }.value
            guard let token else {
                guard !Task.isCancelled, mergeRequests.project == project else { return }
                mergeRequests = MergeRequestList(state: .needsAccount, project: project, remoteName: remoteName, loadedAt: Date())
                return
            }
            do {
                let items = try await GitLabAPI().openMergeRequests(in: project, token: token)
                guard !Task.isCancelled, mergeRequests.project == project else { return }
                mergeRequests = MergeRequestList(state: .loaded, items: items, project: project, remoteName: remoteName, loadedAt: Date())
                syncReviewWithLists(kind: .gitlab)
            } catch {
                guard !Task.isCancelled, !(error is CancellationError), mergeRequests.project == project else { return }
                let message = FriendlyError.message(for: error)
                mergeRequests = MergeRequestList(state: .failed(message), project: project, remoteName: remoteName, loadedAt: Date())
            }
        }
    }

    // MARK: - Open / close the review

    /// Open the review of a PR / MR: fetch its tip and the target branch (a single fetch), and select "compare" from the
    /// divergence point to the tip so the changed files show like the web's "Files changed" tab, with the description panel plus reviewers / assignees.
    func openReview(_ request: ForgeRequest) {
        guard let forge = forgeRemoteMatching(request) else { return }
        let remote = forge.name
        guard let refs = request.reviewRefs(remote: remote) else {
            if let url = request.webURL { NSWorkspace.shared.open(url) }
            return
        }
        let progress = progressReporter()
        var range: (from: String, to: String)?
        perform(String(localized: "Lấy thay đổi của \(request.reference)"), showsProgress: true, cancellable: true, refresh: [.refs]) { git in
            try await git.fetchRefspecs(refs.refspecs, remote: remote, onProgress: progress)
            let head = try await git.resolveCommit(refs.headRef)
            let base = try await git.resolveCommit(refs.baseRef)
            // The two branches share no history (rare): diff directly against the target branch tip.
            let from = await git.mergeBase(base, head) ?? base
            range = (from: from, to: head)
        } onSuccess: { [weak self] in
            guard let self, let range else { return }
            // Reopening the same PR / MR (Reload): keep what was already shown (including a just-saved change) and the loaded people list.
            var shown = request
            var people = ReviewPeopleState.idle
            var saving = false
            if let kept = review, kept.request.number == request.number, kept.request.kind == request.kind {
                shown = kept.request
                people = kept.people
                saving = kept.isSaving
            }
            review = ReviewSession(request: shown, from: range.from, to: range.to, people: people, isSaving: saving)
            select(.compare(from: range.from, to: range.to), reveal: true)
        } onError: { [weak self] error in
            guard let self else { return false }
            return request.kind == .github && handleGitHubAuthError(error, operation: "Fetch")
        }
    }

    /// "Reload" in the review panel: fetch the branch again and reload the PR / MR list (the title, description and reviewers may have changed).
    func reloadReview(_ request: ForgeRequest) {
        openReview(request)
        reloadForgeLists(request.kind)
    }

    func reloadForgeLists(_ kind: ForgeRequest.Kind) {
        switch kind {
        case .github: loadPullRequests(force: true)
        case .gitlab: loadMergeRequests(force: true)
        }
    }

    /// Sync the open review with the just-loaded PR / MR list (someone else may have changed the title, description or reviewers).
    /// `kind`: which list was loaded — only synced when the open review is of the same kind (the other host's list is unrelated).
    func syncReviewWithLists(kind: ForgeRequest.Kind) {
        guard let current = review, current.request.kind == kind, !current.isSaving else { return }
        let items: [ForgeRequest]
        switch current.request.kind {
        case .github: items = pullRequests.items.map(\.forgeRequest)
        case .gitlab: items = mergeRequests.items
        }
        guard let fresh = items.first(where: { $0.number == current.request.number }), fresh != current.request else { return }
        review?.request = fresh
    }

    /// Close the review panel and return to the selected commit.
    func closeReview() {
        review = nil
        if let head = headOID {
            select(.commit(head), reveal: true)
        } else {
            select(.none)
        }
    }

    /// Switching to a different selection (no longer the open review's comparison) drops the review session.
    func dropReviewIfLeft() {
        guard let review else { return }
        if case .compare(let from, let to) = selection, from == review.from, to == review.to { return }
        self.review = nil
    }

    /// Check out the branch of the PR / MR being reviewed.
    func checkoutReview(_ request: ForgeRequest) {
        switch request.kind {
        case .github:
            if let pull = pullRequests.items.first(where: { $0.number == request.number }) {
                checkoutPullRequest(pull)
            } else {
                checkoutPullRequestHead(request)
            }
        case .gitlab:
            checkoutMergeRequest(request)
        }
    }

    /// Fetch the MR into local branch `mr/N` (GitLab keeps an MR's tip at `refs/merge-requests/N/head`, even for forked MRs), then switch to it.
    /// No force: if the local branch has its own commits git refuses rather than overwriting.
    func checkoutMergeRequest(_ request: ForgeRequest) {
        guard request.kind == .gitlab, let forge = forgeRemoteMatching(request) else { return }
        let remote = forge.name
        let local = "mr/\(request.number)"
        if local == currentBranch {
            toast(.info, String(localized: "Đang ở nhánh \(local)"))
            return
        }
        let progress = progressReporter()
        let number = request.number
        perform(String(localized: "Lấy MR !\(number)"), showsProgress: true, cancellable: true, refresh: [.refs, .status]) { git in
            try await git.fetchRefspecs(["refs/merge-requests/\(number)/head:refs/heads/\(local)"], remote: remote, onProgress: progress)
        } onSuccess: { [weak self] in
            self?.switchToBranch(local)
        }
    }

    /// Fetch the PR into local branch `pr/N` (GitHub keeps a PR's tip at `refs/pull/N/head`, even for forked PRs), then switch to
    /// it — used when the PR isn't in the sidebar list yet (just created, still loading). No force: if the local branch has its own commits git refuses.
    func checkoutPullRequestHead(_ request: ForgeRequest) {
        guard request.kind == .github, let github = githubRemote else { return }
        let remote = github.name
        let local = "pr/\(request.number)"
        if local == currentBranch {
            toast(.info, String(localized: "Đang ở nhánh \(local)"))
            return
        }
        let progress = progressReporter()
        let number = request.number
        perform(String(localized: "Lấy PR #\(number)"), showsProgress: true, cancellable: true, refresh: [.refs, .status]) { git in
            try await git.fetchPullRequest(number, remote: remote, into: local, onProgress: progress)
        } onSuccess: { [weak self] in
            self?.switchToBranch(local)
        } onError: { [weak self] error in
            self?.handleGitHubAuthError(error, operation: String(localized: "Lấy PR #\(number)")) ?? false
        }
    }

    func openOnForge(_ request: ForgeRequest) {
        guard let url = request.webURL else { return }
        NSWorkspace.shared.open(url)
    }

    func mergeRequestMenu(_ request: ForgeRequest) -> [MenuItemSpec] {
        var items: [MenuItemSpec] = [
            .action(String(localized: "Xem & review MR !\(request.number)"), systemImage: "text.badge.checkmark") { [weak self] in
                self?.openReview(request)
            },
            .action(String(localized: "Mở MR !\(request.number) trên GitLab"), systemImage: "safari", enabled: request.webURL != nil) { [weak self] in
                self?.openOnForge(request)
            },
            .action(String(localized: "Checkout nhánh của MR"), systemImage: "arrow.uturn.right") { [weak self] in
                self?.checkoutMergeRequest(request)
            },
            .separator,
        ]
        if let url = request.webURL {
            items.append(.action(String(localized: "Sao chép đường dẫn MR"), systemImage: "link") { [weak self] in
                self?.copy(url.absoluteString, label: String(localized: "đường dẫn MR"))
            })
        }
        items.append(.action(String(localized: "Tải lại danh sách MR"), systemImage: "arrow.clockwise") { [weak self] in
            self?.loadMergeRequests(force: true)
        })
        return items
    }

    // MARK: - Reviewers / assignees

    /// Load the list of people assignable to the PR / MR being reviewed (once per review session).
    func loadReviewPeople() {
        guard let session = review, session.people == .idle, let forge = forgeRemoteMatching(session.request) else { return }
        let number = session.request.number
        let kind = session.request.kind
        review?.people = .loading
        Task {
            let state: ReviewPeopleState
            do {
                let people = try await reviewCandidates(in: forge)
                state = .loaded(people)
            } catch {
                state = .failed(FriendlyError.message(for: error))
            }
            guard let current = review, current.request.number == number, current.request.kind == kind else { return }
            review?.people = state
        }
    }

    /// Retry after loading the people list failed.
    func reloadReviewPeople() {
        guard review != nil else { return }
        review?.people = .idle
        loadReviewPeople()
    }

    private func reviewCandidates(in forge: ForgeRemote) async throws -> [ForgePerson] {
        switch forge.kind {
        case .github:
            guard let repo = forge.github else { return [] }
            let token = await Task.detached { GitHubAccountManager.shared.apiToken(forOwner: repo.owner) }.value
            guard let token else { throw GitHubError.unauthorized }
            return try await GitHubRepoAPI().assignableUsers(in: repo, token: token)
        case .gitlab:
            guard let project = forge.gitlab else { return [] }
            let accounts = GitLabAccountManager.shared.store
            let token = await Task.detached { await accounts.apiToken(forHost: project.host) }.value
            guard let token else { throw GitLabError.unauthorized }
            return try await GitLabAPI().projectMembers(of: project, token: token)
        }
    }

    /// Send the new reviewer / assignee list to the host; on success update the panel and reload the sidebar list
    /// (so reopening the review from the list still shows the right thing).
    func updateReviewPeople(_ role: ReviewPeopleRole, to people: [ForgePerson]) {
        guard let session = review, !session.isSaving, let forge = forgeRemoteMatching(session.request) else { return }
        let request = session.request
        let old = role == .reviewers ? request.reviewers : request.assignees
        guard Set(old.map(\.id)) != Set(people.map(\.id)) else { return }
        review?.isSaving = true
        Task {
            do {
                try await sendPeople(role, old: old, new: people, request: request, forge: forge)
                if var current = review, current.request.number == request.number, current.request.kind == request.kind {
                    if role == .reviewers {
                        current.request.reviewers = people
                    } else {
                        current.request.assignees = people
                    }
                    current.isSaving = false
                    review = current
                }
                toast(.success, role == .reviewers ? String(localized: "Đã cập nhật người review") : String(localized: "Đã cập nhật người được gán"))
            } catch {
                if let current = review, current.request.number == request.number, current.request.kind == request.kind {
                    review?.isSaving = false
                }
                let title = String(localized: "Không cập nhật được người review / người được gán")
                if case GitHubError.unauthorized = error {
                    showError(title, error, actions: githubLoginActions(String(localized: "Đăng nhập GitHub")))
                } else {
                    showError(title, error)
                }
            }
            // Reload the list on success AND on failure: the host may have applied part of it (e.g. GitHub removed the old reviewer
            // but adding the new one failed) and the sidebar has to match when the review is reopened.
            reloadForgeLists(request.kind)
        }
    }

    private func sendPeople(_ role: ReviewPeopleRole, old: [ForgePerson], new: [ForgePerson], request: ForgeRequest,
                            forge: ForgeRemote) async throws {
        switch forge.kind {
        case .github:
            guard let repo = forge.github else { return }
            let token = await Task.detached { GitHubAccountManager.shared.apiToken(forOwner: repo.owner) }.value
            guard let token else { throw GitHubError.unauthorized }
            let api = GitHubRepoAPI()
            if role == .assignees {
                try await api.setAssignees(new.map(\.username), number: request.number, in: repo, token: token)
            } else {
                let added = new.filter { !old.contains($0) }.map(\.username)
                let removed = old.filter { !new.contains($0) }.map(\.username)
                try await api.updateReviewers(add: added, remove: removed, number: request.number, in: repo, token: token)
            }
        case .gitlab:
            guard let project = forge.gitlab else { return }
            let accounts = GitLabAccountManager.shared.store
            let token = await Task.detached { await accounts.apiToken(forHost: project.host) }.value
            guard let token else { throw GitLabError.unauthorized }
            let ids = new.compactMap(\.gitlabID)
            let api = GitLabAPI()
            if role == .assignees {
                try await api.setPeople(iid: request.number, assigneeIDs: ids, reviewerIDs: nil, in: project, token: token)
            } else {
                try await api.setPeople(iid: request.number, assigneeIDs: nil, reviewerIDs: ids, in: project, token: token)
            }
        }
    }
}
