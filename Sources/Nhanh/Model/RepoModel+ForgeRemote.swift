import AppKit
import NhanhCore

/// Máy chủ mà Pull Request / Merge Request được tạo trên đó.
enum ForgeKind: Equatable {
    case github
    case gitlab

    /// "PR" / "MR" — chữ trên nút của thanh công cụ.
    var shortName: String { self == .github ? "PR" : "MR" }
    var siteName: String { self == .github ? "GitHub" : "GitLab" }
}

/// Remote của repo ở GitHub hoặc GitLab, dùng để tạo Pull Request / Merge Request.
struct ForgeRemote: Equatable {
    let name: String
    let kind: ForgeKind
    /// "github.com/chu/repo", "gitlab.com/nhom/du-an" — hiện trong hộp thoại.
    let siteName: String
    let github: GitHubRepoRef?
    let gitlab: GitLabProjectRef?
}

extension RepoModel {
    /// Remote GitLab đầu tiên (ưu tiên remote mặc định); nhận cả máy chủ tự host của tài khoản đã thêm.
    var gitlabRemote: (name: String, project: GitLabProjectRef)? {
        let hosts = GitLabAccountManager.shared.store.hosts
        let ordered = remotes.filter { $0.name == defaultRemote } + remotes
        for remote in ordered {
            if let project = GitLabProjectRef.parse(remoteURL: remote.fetchURL, knownHosts: hosts) { return (remote.name, project) }
        }
        return nil
    }

    /// Remote dùng cho PR / MR: remote mặc định nếu ở GitHub hoặc GitLab, không thì remote đầu tiên nhận ra được.
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

    /// Có tài khoản dùng được để tạo PR / MR ở remote này — không đọc token ở đây.
    var canUseForgeAccount: Bool {
        guard let forge = forgeRemote else { return false }
        switch forge.kind {
        case .github: return canUseGitHubAccount
        case .gitlab: return forge.gitlab.map { GitLabAccountManager.shared.store.account(forHost: $0.host) != nil } ?? false
        }
    }

    /// Push (nếu cần) rồi gửi Merge Request lên GitLab. Chỉ gửi tiêu đề / mô tả / tên nhánh người dùng vừa xem trong hộp thoại.
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
            // Mở luôn review của MR vừa tạo để gán người review / người xử lý.
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
