import AppKit
import NhanhCore

/// Danh sách Merge Request đang mở của repo trên GitLab (remote ưu tiên), tải qua API.
struct MergeRequestList: Equatable {
    enum State: Equatable {
        case idle
        /// Repo không có remote GitLab — sidebar ẩn mục MERGE REQUESTS.
        case notGitLab
        case loading
        case loaded
        /// Chưa có tài khoản GitLab nào cho máy chủ này.
        case needsAccount
        case failed(String)
    }

    var state: State = .idle
    var items: [ForgeRequest] = []
    var project: GitLabProjectRef?
    /// Tên remote (trên máy) của project GitLab đó, ví dụ "origin".
    var remoteName: String?
    var loadedAt: Date?
}

/// Danh sách ứng viên để gán (người review / người xử lý) của PR / MR đang xem.
enum ReviewPeopleState: Equatable {
    case idle
    case loading
    case loaded([ForgePerson])
    case failed(String)
}

/// PR / MR đang xem ở panel review: nhánh đã lấy về máy, `from` là điểm tách khỏi nhánh đích và `to` là đầu của PR / MR
/// (cũng chính là hai đầu của `RepoSelection.compare` đang chọn).
struct ReviewSession: Equatable {
    var request: ForgeRequest
    let from: String
    let to: String
    var people: ReviewPeopleState = .idle
    /// Đang gửi thay đổi người review / người được gán lên máy chủ.
    var isSaving = false
}

enum ReviewPeopleRole {
    case reviewers
    case assignees
}

extension RepoModel {
    /// Remote PR / MR ứng với `request` (đúng loại máy chủ): repo có cả remote GitHub lẫn GitLab thì mỗi PR / MR dùng remote của
    /// chính máy chủ đó. nil nếu repo không còn remote đó.
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

    /// Tải lại MR đang mở (sau khi mở repo, đổi remote, fetch). Không tải lại nếu vừa tải trong 20 giây, trừ khi `force`.
    func loadMergeRequests(force: Bool = false) {
        guard let gitlab = gitlabRemote else {
            mergeRequestsTask?.cancel()
            if mergeRequests.state != .notGitLab { mergeRequests = MergeRequestList(state: .notGitLab) }
            return
        }
        // Kịch bản chụp ảnh không gọi GitLab thật.
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
            // Token của tài khoản ứng với host (có thể phải đọc Keychain / làm mới token): lấy ngoài luồng chính.
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

    // MARK: - Mở / đóng review

    /// Mở review của PR / MR: lấy đầu PR / MR và nhánh đích về máy (một lần fetch), chọn "so sánh" từ điểm tách tới đầu PR / MR
    /// để xem file thay đổi như tab "Files changed" trên web, kèm panel mô tả + người review / người được gán.
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
            // Hai nhánh không có lịch sử chung (hiếm): so thẳng với đầu nhánh đích.
            let from = await git.mergeBase(base, head) ?? base
            range = (from: from, to: head)
        } onSuccess: { [weak self] in
            guard let self, let range else { return }
            // Mở lại đúng PR / MR đang xem (Tải lại): giữ bản đã thấy (kể cả thay đổi vừa lưu) và danh sách người đã nạp.
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

    /// "Tải lại" ở panel review: lấy lại nhánh về máy và nạp lại danh sách PR / MR (tiêu đề, mô tả, người review có thể đã đổi).
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

    /// Cập nhật review đang mở theo danh sách PR / MR vừa tải về (người khác có thể đã sửa tiêu đề, mô tả, người review).
    /// `kind`: loại danh sách vừa tải — chỉ đồng bộ khi review đang mở cùng loại (danh sách của máy chủ kia không liên quan).
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

    /// Đóng panel review và quay về commit đang đứng.
    func closeReview() {
        review = nil
        if let head = headOID {
            select(.commit(head), reveal: true)
        } else {
            select(.none)
        }
    }

    /// Chọn sang mục khác (không còn là phép so sánh của review đang mở) thì bỏ phiên review.
    func dropReviewIfLeft() {
        guard let review else { return }
        if case .compare(let from, let to) = selection, from == review.from, to == review.to { return }
        self.review = nil
    }

    /// Checkout nhánh của PR / MR đang xem.
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

    /// Lấy MR về nhánh local `mr/N` (GitLab giữ đầu MR ở `refs/merge-requests/N/head`, kể cả MR từ fork) rồi chuyển sang nhánh đó.
    /// Không ép: nhánh local đã có commit riêng thì git từ chối thay vì ghi đè.
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

    /// Lấy PR về nhánh local `pr/N` (GitHub giữ đầu PR ở `refs/pull/N/head`, kể cả PR từ fork) rồi chuyển sang nhánh đó — dùng khi
    /// PR chưa có trong danh sách ở sidebar (vừa tạo, chưa tải xong). Không ép: nhánh local đã có commit riêng thì git từ chối.
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

    // MARK: - Người review / người được gán

    /// Tải danh sách người có thể gán cho PR / MR đang xem (một lần cho mỗi phiên review).
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

    /// Thử lại sau khi tải danh sách người bị lỗi.
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

    /// Gửi danh sách người review / người được gán mới lên máy chủ; xong thì cập nhật panel và tải lại danh sách ở sidebar
    /// (để mở lại review từ danh sách vẫn thấy đúng).
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
            // Thành công hay lỗi đều nạp lại danh sách: máy chủ có thể đã áp dụng một phần (vd. GitHub bỏ người cũ xong mà thêm người mới
            // lỗi) và sidebar cần khớp khi mở lại review.
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
