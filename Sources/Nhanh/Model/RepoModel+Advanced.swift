import AppKit
import NhanhCore
import SwiftUI

/// Submodule, worktree, Git Flow, LFS của repo — tải lại cùng các nhánh (lệnh đọc, không chạy gì của repo).
struct RepoExtras: Equatable {
    var submodules: [Submodule] = []
    var worktrees: [Worktree] = []
    var gitFlow: GitFlowConfig?
    var usesLFS = false

    /// Worktree phụ (không tính thư mục repo chính).
    var linkedWorktrees: [Worktree] { worktrees.filter { !$0.isMain } }

    static func load(_ repo: GitRepository) async -> RepoExtras {
        async let submodules = (try? await repo.submodules()) ?? []
        async let worktrees = (try? await repo.worktrees()) ?? []
        async let flow = repo.gitFlowConfig()
        return RepoExtras(submodules: await submodules, worktrees: await worktrees, gitFlow: await flow, usesLFS: repo.usesLFS())
    }
}

extension RepoModel {
    func loadExtras() {
        let repo = repository
        Task {
            let value = await RepoExtras.load(repo)
            if value != extras { extras = value }
        }
    }

    /// Mở thư mục (submodule, worktree) thành tab mới trong cửa sổ đang dùng.
    func openInNewTab(_ path: String) {
        AppState.shared.pendingOpenPaths.append(path)
    }

    private func absolutePath(_ relative: String) -> String {
        repository.root.appendingPathComponent(relative).path
    }

    // MARK: - Ký commit

    func saveSigning(_ config: CommitSigningConfig, global: Bool) {
        perform("Cấu hình ký commit", refresh: []) { repo in
            try await repo.configureSigning(config, global: global)
        } onSuccess: { [weak self] in
            let scope = global ? "mọi repo" : "repo này"
            self?.toast(.success, config.signCommits ? "Commit mới ở \(scope) sẽ được ký bằng \(config.format.title)" : "Đã tắt ký commit cho \(scope)")
        }
    }

    // MARK: - Submodule

    func updateSubmodules(_ paths: [String] = []) {
        let progress = progressReporter()
        let title = paths.count == 1 ? "Cập nhật submodule \(paths[0])" : "Cập nhật submodule"
        perform(title, showsProgress: true, cancellable: true) { repo in
            try await repo.updateSubmodules(paths, onProgress: progress)
        } onSuccess: { [weak self] in
            self?.toast(.success, paths.count == 1 ? "Đã cập nhật \(paths[0])" : "Đã cập nhật submodule")
            self?.loadExtras()
        } onError: { [weak self] error in
            self?.handleGitHubAuthError(error, operation: title) ?? false
        }
    }

    func submoduleMenu(_ module: Submodule) -> [MenuItemSpec] {
        [
            .action("Mở submodule trong tab mới", systemImage: "arrow.up.forward.square", enabled: module.state != .uninitialized) {
                [weak self] in guard let self else { return }
                openInNewTab(absolutePath(module.path))
            },
            .action(module.state == .uninitialized ? "Tải về (init & update)" : "Cập nhật về commit đã ghi nhận",
                    systemImage: "arrow.down.circle") { [weak self] in self?.updateSubmodules([module.path]) },
            .action("Mở trong Finder", systemImage: "folder", enabled: module.state != .uninitialized) { [weak self] in
                guard let self else { return }
                NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: absolutePath(module.path))])
            },
            .separator,
            .action("Sao chép đường dẫn", systemImage: "doc.on.doc") { [weak self] in self?.copy(module.path, label: "đường dẫn") },
        ]
    }

    // MARK: - Worktree

    func addWorktree(path: String, branch: String, createBranch: Bool, startPoint: String?) {
        perform("Tạo worktree \(branch)", refresh: [.refs, .status]) { repo in
            try await repo.addWorktree(path: path, branch: branch, createBranch: createBranch, startPoint: startPoint)
        } onSuccess: { [weak self] in
            self?.loadExtras()
            self?.toast(.success, "Đã tạo worktree cho \(branch)", message: (path as NSString).abbreviatingWithTildeInPath, actions: [
                ToastAction(title: "Mở trong tab mới") { [weak self] in self?.openInNewTab(path) },
            ])
        }
    }

    func removeWorktree(_ worktree: Worktree) {
        confirmation = Confirmation(
            title: "Xoá worktree \((worktree.path as NSString).lastPathComponent)?",
            message: "Thư mục \((worktree.path as NSString).abbreviatingWithTildeInPath) sẽ bị xoá. Nhánh \(worktree.branch ?? "") vẫn giữ nguyên. Worktree còn thay đổi chưa commit thì git sẽ từ chối.",
            confirmTitle: "Xoá worktree",
            isDestructive: true
        ) { [weak self] in
            self?.perform("Xoá worktree", refresh: [.refs]) { repo in
                try await repo.removeWorktree(path: worktree.path, force: false)
            } onSuccess: { [weak self] in
                self?.loadExtras()
                self?.toast(.success, "Đã xoá worktree")
            }
        }
    }

    func worktreeMenu(_ worktree: Worktree) -> [MenuItemSpec] {
        var items: [MenuItemSpec] = [
            .action("Mở trong tab mới", systemImage: "arrow.up.forward.square") { [weak self] in self?.openInNewTab(worktree.path) },
            .action("Mở trong Finder", systemImage: "folder") {
                NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: worktree.path)])
            },
        ]
        if !worktree.isMain {
            items.append(.separator)
            items.append(.action("Xoá worktree…", systemImage: "trash", destructive: true, enabled: !worktree.isLocked) { [weak self] in
                self?.removeWorktree(worktree)
            })
        }
        if worktree.isPrunable {
            items.append(.action("Dọn worktree đã mất thư mục", systemImage: "sparkles") { [weak self] in
                self?.perform("Dọn worktree", refresh: []) { repo in try await repo.pruneWorktrees() } onSuccess: { [weak self] in
                    self?.loadExtras()
                }
            })
        }
        return items
    }

    // MARK: - Git Flow

    func initGitFlow(_ config: GitFlowConfig) {
        perform("Khởi tạo Git Flow", refresh: [.refs]) { repo in
            try await repo.initGitFlow(config)
        } onSuccess: { [weak self] in
            self?.loadExtras()
            self?.toast(.success, "Đã bật Git Flow", message: "\(config.main) · \(config.develop) · \(config.featurePrefix)…")
        }
    }

    func startFlow(_ kind: GitFlowKind, name: String) {
        guard let config = extras.gitFlow else { return }
        perform("Bắt đầu \(kind.title) \(name)") { repo in
            try await repo.startFlow(kind, name: name, config: config)
        } onSuccess: { [weak self] in
            self?.toast(.success, "Đã tạo \(config.prefix(kind))\(name) từ \(config.base(kind))")
        } onError: { [weak self] error in
            self?.handleCheckoutError(error) { [weak self] in
                self?.stashThen("Bắt đầu \(kind.title) \(name)") { repo in try await repo.startFlow(kind, name: name, config: config) }
            } ?? false
        }
    }

    func finishFlow(_ kind: GitFlowKind, name: String) {
        guard let config = extras.gitFlow else { return }
        let branch = config.prefix(kind) + name
        let target = kind == .feature ? config.develop : "\(config.main) và \(config.develop)"
        let tag = kind == .feature ? "" : " Gắn tag \(config.versionTagPrefix)\(name)."
        confirmation = Confirmation(
            title: "Kết thúc \(kind.title.lowercased()) \(name)?",
            message: "Merge \(branch) vào \(target) (--no-ff).\(tag) Xong thì xoá nhánh \(branch).",
            confirmTitle: "Kết thúc"
        ) { [weak self] in
            self?.perform("Kết thúc \(kind.title) \(name)") { repo in
                try await repo.finishFlow(kind, name: name, config: config)
            } onSuccess: { [weak self] in
                self?.toast(.success, "Đã kết thúc \(branch)", message: kind == .feature ? nil : "Nhớ push \(config.main), \(config.develop) và tag.")
            } onError: { [weak self] error in
                guard let self, let stepError = error as? GitFlowStepError else { return false }
                showError("Git Flow dừng giữa chừng", stepError)
                return true
            }
        }
    }

    /// Mục menu Git Flow cho một nhánh local có tiền tố feature / release / hotfix.
    func gitFlowMenuItems(for ref: GitRef) -> [MenuItemSpec] {
        guard ref.kind == .localBranch, let config = extras.gitFlow, let flow = config.classify(ref.name) else { return [] }
        return [.action("Kết thúc \(flow.kind.title.lowercased()) \(flow.name) (Git Flow)…", systemImage: "flag.checkered") {
            [weak self] in self?.finishFlow(flow.kind, name: flow.name)
        }]
    }

    // MARK: - LFS

    func runLFS(_ command: LFSCommand) {
        let progress = progressReporter()
        let title = "Git LFS \(command.rawValue)"
        perform(title, showsProgress: true, cancellable: true) { repo in
            guard await repo.lfsVersion() != nil else { throw LFSMissingError() }
            try await repo.lfs(command, onProgress: progress)
        } onSuccess: { [weak self] in
            self?.toast(.success, "Đã chạy \(title)")
        } onError: { [weak self] error in
            if error is LFSMissingError {
                self?.showError("Máy chưa cài Git LFS", error, actions: [
                    ToastAction(title: "Trang cài đặt") { NSWorkspace.shared.open(URL(string: "https://git-lfs.com")!) },
                ])
                return true
            }
            return self?.handleGitHubAuthError(error, operation: title) ?? false
        }
    }

    func lfsTrack(_ pattern: String, track: Bool) {
        perform(track ? "LFS theo dõi \(pattern)" : "LFS bỏ theo dõi \(pattern)", refresh: [.status]) { repo in
            guard await repo.lfsVersion() != nil else { throw LFSMissingError() }
            try await repo.lfsTrack(pattern, track: track)
        } onSuccess: { [weak self] in
            self?.loadExtras()
            self?.toast(.success, track ? "Git LFS sẽ lưu các file \(pattern)" : "Đã bỏ \(pattern) khỏi Git LFS",
                        message: "Nhớ commit thay đổi của .gitattributes.")
        }
    }

    func lfsMenuItems() -> [MenuItemSpec] {
        [
            .action("Pull file LFS", systemImage: "arrow.down.circle") { [weak self] in self?.runLFS(.pull) },
            .action("Fetch file LFS", systemImage: "arrow.triangle.2.circlepath") { [weak self] in self?.runLFS(.fetch) },
            .action("Dọn file LFS cũ (prune)", systemImage: "sparkles") { [weak self] in self?.runLFS(.prune) },
            .separator,
            .action("Theo dõi kiểu file bằng LFS…", systemImage: "plus.rectangle.on.folder") { [weak self] in self?.sheet = .lfsTrack },
        ]
    }
}

struct LFSMissingError: LocalizedError {
    var errorDescription: String? { "Không tìm thấy git-lfs. Cài bằng `brew install git-lfs` rồi chạy `git lfs install`." }
}
