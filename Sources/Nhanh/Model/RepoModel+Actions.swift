import AppKit
import NhanhCore
import SwiftUI

extension RepoModel {
    // MARK: - Stage / unstage / huỷ file

    func stage(_ changes: [FileChange]) {
        let paths = Array(Set(changes.flatMap(\.allPaths)))
        guard !paths.isEmpty else { return }
        perform("Stage", refresh: [.status]) { repo in
            try await repo.stage(paths: paths)
        }
    }

    func stageAll() {
        guard !status.unstaged.isEmpty else { return }
        perform("Stage tất cả", refresh: [.status]) { repo in
            try await repo.stageAll()
        }
    }

    func unstage(_ changes: [FileChange]) {
        let paths = Array(Set(changes.flatMap(\.allPaths)))
        guard !paths.isEmpty else { return }
        let headExists = headOID != nil
        perform("Bỏ stage", refresh: [.status]) { repo in
            try await repo.unstage(paths: paths, headExists: headExists)
        }
    }

    func unstageAll() {
        guard !status.staged.isEmpty else { return }
        let headExists = headOID != nil
        perform("Bỏ stage tất cả", refresh: [.status]) { repo in
            try await repo.unstageAll(headExists: headExists)
        }
    }

    func discard(_ changes: [FileChange]) {
        guard !changes.isEmpty else { return }
        let tracked = changes.filter { $0.kind != .untracked }.map(\.path)
        let untracked = changes.filter { $0.kind == .untracked }.map(\.path)
        let label = changes.count == 1 ? "“\(changes[0].fileName)”" : "\(changes.count) file"
        confirmation = Confirmation(
            title: "Huỷ thay đổi trong \(label)?",
            message: "Thay đổi chưa stage sẽ bị bỏ, file chưa track được chuyển vào Thùng rác. Bạn có thể bấm “Hoàn tác” ngay sau đó.",
            confirmTitle: "Huỷ thay đổi",
            isDestructive: true
        ) { [weak self] in
            self?.performDiscard(tracked: tracked, untracked: untracked)
        }
    }

    private func performDiscard(tracked: [String], untracked: [String]) {
        var snapshot: String?
        var trashed: [String: URL] = [:]
        perform("Huỷ thay đổi", refresh: [.status]) { repo in
            if !tracked.isEmpty {
                snapshot = try await repo.snapshotChanges()
                try await repo.discard(paths: tracked)
            }
            if !untracked.isEmpty {
                trashed = try repo.trashUntracked(paths: untracked)
            }
        } onSuccess: { [weak self] in
            self?.toast(.success, "Đã huỷ thay đổi", actions: [
                ToastAction(title: "Hoàn tác") { [weak self] in
                    self?.undoDiscard(snapshot: snapshot, tracked: tracked, trashed: trashed)
                },
            ])
        }
    }

    private func undoDiscard(snapshot: String?, tracked: [String], trashed: [String: URL]) {
        perform("Hoàn tác huỷ thay đổi", refresh: [.status]) { repo in
            if let snapshot, !tracked.isEmpty {
                try await repo.restoreWorkingFiles(from: snapshot, paths: tracked)
            }
            for (path, url) in trashed {
                let destination = repo.root.appendingPathComponent(path)
                try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
                try FileManager.default.moveItem(at: url, to: destination)
            }
        }
    }

    func discardAllChanges() {
        guard !status.isClean else { return }
        if let operation {
            toast(.warning, "\(operation.title) — hãy dùng nút “Huỷ” trên thanh trạng thái thao tác")
            return
        }
        let untracked = status.unstaged.filter { $0.kind == .untracked }.map(\.path)
        confirmation = Confirmation(
            title: "Huỷ TẤT CẢ thay đổi chưa commit?",
            message: "Mọi thay đổi (kể cả đã stage) sẽ bị bỏ, file chưa track được chuyển vào Thùng rác. Có thể bấm “Hoàn tác” ngay sau đó.",
            confirmTitle: "Huỷ tất cả",
            isDestructive: true
        ) { [weak self] in
            guard let self else { return }
            var snapshot: String?
            var trashed: [String: URL] = [:]
            perform("Huỷ tất cả thay đổi") { repo in
                snapshot = try await repo.snapshotChanges()
                try await repo.hardReset()
                if !untracked.isEmpty { trashed = try repo.trashUntracked(paths: untracked) }
            } onSuccess: { [weak self] in
                self?.toast(.success, "Đã huỷ tất cả thay đổi", actions: [
                    ToastAction(title: "Hoàn tác") { [weak self] in
                        self?.perform("Hoàn tác huỷ tất cả") { repo in
                            if let snapshot { try await repo.stashApply(snapshot, restoreIndex: true) }
                            for (path, url) in trashed {
                                let destination = repo.root.appendingPathComponent(path)
                                try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
                                try FileManager.default.moveItem(at: url, to: destination)
                            }
                        }
                    },
                ])
            }
        }
    }

    func ignore(pattern: String) {
        perform("Thêm vào .gitignore", refresh: [.status]) { repo in
            try repo.addToGitignore(pattern)
        } onSuccess: { [weak self] in
            self?.toast(.success, "Đã thêm “\(pattern)” vào .gitignore")
        }
    }

    // MARK: - Commit

    var hasCommitMessage: Bool {
        !commitSummary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var canCommit: Bool {
        guard hasCommitMessage, status.conflicts.isEmpty else { return false }
        return !status.staged.isEmpty || amendLastCommit || operation == .merging
    }

    var composedCommitMessage: String {
        let summary = commitSummary.trimmingCharacters(in: .whitespacesAndNewlines)
        let body = commitBody.trimmingCharacters(in: .whitespacesAndNewlines)
        return body.isEmpty ? summary : summary + "\n\n" + body
    }

    func commit(stageAllFirst: Bool = false) {
        guard hasCommitMessage else {
            toast(.warning, "Hãy nhập tóm tắt cho commit")
            return
        }
        guard status.conflicts.isEmpty else {
            toast(.warning, "Còn \(status.conflicts.count) file xung đột chưa giải quyết")
            return
        }
        let message = composedCommitMessage
        let amend = amendLastCommit
        let previousHead = headOID
        let branch = currentBranch ?? "HEAD"
        perform(amend ? "Sửa commit trước" : "Commit") { repo in
            if stageAllFirst { try await repo.stageAll() }
            try await repo.commit(message: message, amend: amend)
        } onSuccess: { [weak self] in
            guard let self else { return }
            savedSummaryBeforeAmend = nil
            commitSummary = ""
            commitBody = ""
            amendLastCommit = false
            toast(.success, amend ? "Đã sửa commit trước" : "Đã commit vào \(branch)", actions: [
                ToastAction(title: "Hoàn tác") { [weak self] in self?.undoCommit(previousHead: previousHead, message: message) },
            ])
        } onError: { [weak self] error in
            guard let self, let gitError = error as? GitError else { return false }
            if gitError.contains("Please tell me who you are") || gitError.contains("empty ident") {
                sheet = .identity
                toast(.warning, "Cần đặt tên và email cho Git trước khi commit")
                return true
            }
            return false
        }
    }

    func undoCommit(previousHead: String?, message: String) {
        perform("Hoàn tác commit") { repo in
            if let previousHead {
                try await repo.softReset(to: previousHead)
            } else {
                try await repo.undoInitialCommit()
            }
        } onSuccess: { [weak self] in
            guard let self else { return }
            let parts = message.split(separator: "\n", maxSplits: 1, omittingEmptySubsequences: false)
            commitSummary = parts.first.map(String.init) ?? ""
            commitBody = parts.count > 1 ? parts[1].trimmingCharacters(in: .whitespacesAndNewlines) : ""
            select(.workingTree)
            toast(.info, "Đã hoàn tác commit — thay đổi vẫn còn ở trạng thái đã stage")
        }
    }

    func amendToggled() {
        if amendLastCommit {
            savedSummaryBeforeAmend = (commitSummary, commitBody)
            guard commitSummary.isEmpty, let head = headOID else { return }
            let repo = repository
            Task {
                guard let message = try? await repo.commitMessage(head), amendLastCommit, commitSummary.isEmpty else { return }
                let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
                let parts = trimmed.split(separator: "\n", maxSplits: 1, omittingEmptySubsequences: false)
                commitSummary = parts.first.map(String.init) ?? ""
                commitBody = parts.count > 1 ? parts[1].trimmingCharacters(in: .whitespacesAndNewlines) : ""
            }
        } else if let saved = savedSummaryBeforeAmend {
            commitSummary = saved.0
            commitBody = saved.1
            savedSummaryBeforeAmend = nil
        }
    }

    func saveIdentity(name: String, email: String) {
        perform("Lưu tên & email Git", refresh: []) { repo in
            try await repo.setConfig("user.name", name, global: true)
            try await repo.setConfig("user.email", email, global: true)
        } onSuccess: { [weak self] in
            self?.toast(.success, "Đã lưu tên & email cho Git")
        }
    }

    // MARK: - Checkout

    func checkout(_ ref: GitRef) {
        switch ref.kind {
        case .localBranch:
            guard ref.name != currentBranch else {
                toast(.info, "Đang ở nhánh \(ref.name)")
                return
            }
            switchToBranch(ref.name)
        case .remoteBranch:
            let localName = ref.shortBranchName
            if let local = refs.first(where: { $0.kind == .localBranch && $0.name == localName }) {
                if local.name == currentBranch {
                    toast(.info, "Đang ở nhánh \(local.name)")
                } else {
                    switchToBranch(local.name)
                }
                return
            }
            let previous = status.head
            perform("Checkout \(ref.name)") { repo in
                try await repo.checkoutTracking(remoteBranch: ref.name, localName: localName)
            } onSuccess: { [weak self] in
                self?.toast(.success, "Đã tạo nhánh \(localName) theo dõi \(ref.name)", actions: [
                    ToastAction(title: "Hoàn tác") { [weak self] in
                        self?.restoreHead(previous) { repo in try await repo.deleteBranch(localName, force: true) }
                    },
                ])
            } onError: { [weak self] error in
                self?.handleCheckoutError(error) { [weak self] in
                    self?.stashThen("Checkout \(ref.name)") { repo in
                        try await repo.checkoutTracking(remoteBranch: ref.name, localName: localName)
                    }
                } ?? false
            }
        case .tag:
            checkoutDetached(ref.target, label: "tag \(ref.name)")
        }
    }

    func switchToBranch(_ name: String) {
        let previous = status.head
        perform("Checkout \(name)") { repo in
            try await repo.switchTo(branch: name)
        } onSuccess: { [weak self] in
            self?.toast(.success, "Đã chuyển sang nhánh \(name)", actions: [
                ToastAction(title: "Hoàn tác") { [weak self] in self?.restoreHead(previous) },
            ])
        } onError: { [weak self] error in
            self?.handleCheckoutError(error) { [weak self] in
                self?.stashThen("Checkout \(name)") { repo in try await repo.switchTo(branch: name) }
            } ?? false
        }
    }

    func checkoutDetached(_ sha: String, label: String) {
        confirmation = Confirmation(
            title: "Checkout \(label)?",
            message: "Bạn sẽ ở chế độ “HEAD tách rời” (không thuộc nhánh nào). Muốn commit tiếp, hãy tạo nhánh mới tại đó.",
            confirmTitle: "Checkout"
        ) { [weak self] in
            guard let self else { return }
            let previous = status.head
            perform("Checkout \(label)") { repo in
                try await repo.switchDetached(sha)
            } onSuccess: { [weak self] in
                self?.toast(.success, "Đang ở \(label) (HEAD tách rời)", actions: [
                    ToastAction(title: "Hoàn tác") { [weak self] in self?.restoreHead(previous) },
                ])
            } onError: { [weak self] error in
                self?.handleCheckoutError(error) { [weak self] in
                    self?.stashThen("Checkout \(label)") { repo in try await repo.switchDetached(sha) }
                } ?? false
            }
        }
    }

    /// Quay lại HEAD trước đó (nhánh hoặc commit), rồi chạy thêm `then` nếu có.
    func restoreHead(_ head: HeadState, then: ((GitRepository) async throws -> Void)? = nil) {
        perform("Hoàn tác checkout") { repo in
            switch head {
            case .branch(let name, _): try await repo.switchTo(branch: name)
            case .detached(let oid): try await repo.switchDetached(oid)
            case .unknown: break
            }
            try await then?(repo)
        }
    }

    private func handleCheckoutError(_ error: any Error, stashAndRetry: @escaping () -> Void) -> Bool {
        guard let gitError = error as? GitError,
              gitError.contains("would be overwritten") || gitError.contains("Please commit your changes or stash them") else {
            return false
        }
        showError("Không checkout được vì có thay đổi chưa commit", error, actions: [
            ToastAction(title: "Stash rồi checkout", handler: stashAndRetry),
        ])
        return true
    }

    /// Cất thay đổi vào stash rồi chạy thao tác (GitKraken gọi là auto-stash).
    private func stashThen(_ title: String, _ work: @escaping (GitRepository) async throws -> Void) {
        perform(title) { repo in
            try await repo.stashPush(message: "Thaigit: tự cất trước khi \(title.lowercased())", includeUntracked: true)
            try await work(repo)
        } onSuccess: { [weak self] in
            self?.toast(.success, "\(title) xong — thay đổi đã được cất vào stash", actions: [
                ToastAction(title: "Pop stash") { [weak self] in self?.popLatestStash() },
            ])
        }
    }

    // MARK: - Nhánh

    func beginCreateBranchAtHead() {
        guard let head = headOID else {
            toast(.info, "Cần có ít nhất một commit trước khi tạo nhánh")
            return
        }
        sheet = .createBranch(startPoint: head, label: currentBranch ?? String(head.prefix(7)))
    }

    func beginCreateBranch(at commit: Commit) {
        sheet = .createBranch(startPoint: commit.id, label: commit.shortSHA)
    }

    func createBranch(name: String, startPoint: String, checkout: Bool) {
        let previous = status.head
        perform("Tạo nhánh \(name)") { repo in
            try await repo.createBranch(name, at: startPoint, checkout: checkout)
        } onSuccess: { [weak self] in
            self?.toast(.success, checkout ? "Đã tạo và chuyển sang nhánh \(name)" : "Đã tạo nhánh \(name)", actions: [
                ToastAction(title: "Hoàn tác") { [weak self] in
                    if checkout {
                        self?.restoreHead(previous) { repo in try await repo.deleteBranch(name, force: true) }
                    } else {
                        self?.perform("Xoá nhánh \(name)") { repo in try await repo.deleteBranch(name, force: true) }
                    }
                },
            ])
        } onError: { [weak self] error in
            self?.handleCheckoutError(error) { [weak self] in
                self?.stashThen("Tạo nhánh \(name)") { repo in try await repo.createBranch(name, at: startPoint, checkout: checkout) }
            } ?? false
        }
    }

    func deleteBranch(_ ref: GitRef) {
        guard ref.name != currentBranch else {
            toast(.warning, "Không thể xoá nhánh đang checkout — hãy chuyển sang nhánh khác trước")
            return
        }
        confirmation = Confirmation(
            title: "Xoá nhánh “\(ref.name)”?",
            message: "Chỉ xoá nhánh trên máy bạn. Có thể bấm “Hoàn tác” ngay sau đó.",
            confirmTitle: "Xoá nhánh",
            isDestructive: true
        ) { [weak self] in
            self?.performDeleteBranch(ref, force: false)
        }
    }

    private func performDeleteBranch(_ ref: GitRef, force: Bool) {
        perform("Xoá nhánh \(ref.name)") { repo in
            try await repo.deleteBranch(ref.name, force: force)
        } onSuccess: { [weak self] in
            self?.toast(.success, "Đã xoá nhánh \(ref.name)", actions: [
                ToastAction(title: "Hoàn tác") { [weak self] in
                    self?.perform("Khôi phục nhánh \(ref.name)") { repo in try await repo.updateRef(ref.fullName, to: ref.target) }
                },
            ])
        } onError: { [weak self] error in
            guard let self, let gitError = error as? GitError, gitError.contains("not fully merged") else { return false }
            showError("Nhánh \(ref.name) có commit chưa được merge", error, actions: [
                ToastAction(title: "Vẫn xoá") { [weak self] in self?.performDeleteBranch(ref, force: true) },
            ])
            return true
        }
    }

    func deleteRemoteBranch(_ ref: GitRef) {
        guard let remote = ref.remoteName else { return }
        let branch = ref.shortBranchName
        confirmation = Confirmation(
            title: "Xoá nhánh “\(ref.name)” trên remote?",
            message: "Nhánh \(branch) sẽ bị xoá khỏi \(remote) cho mọi người.",
            confirmTitle: "Xoá trên remote",
            isDestructive: true
        ) { [weak self] in
            guard let self else { return }
            let progress = progressReporter()
            perform("Xoá \(ref.name)", showsProgress: true, cancellable: true, refresh: [.refs, .status]) { repo in
                try await repo.deleteRemoteBranch(remote: remote, branch: branch, onProgress: progress)
            } onSuccess: { [weak self] in
                self?.toast(.success, "Đã xoá \(ref.name)", actions: [
                    ToastAction(title: "Hoàn tác") { [weak self] in
                        guard let self else { return }
                        let progress = progressReporter()
                        perform("Khôi phục \(ref.name)", showsProgress: true, refresh: [.refs]) { repo in
                            try await repo.pushCommit(ref.target, remote: remote, branch: branch, onProgress: progress)
                        }
                    },
                ])
            }
        }
    }

    func renameBranch(_ old: String, to new: String) {
        perform("Đổi tên nhánh") { repo in
            try await repo.renameBranch(old, to: new)
        } onSuccess: { [weak self] in
            self?.toast(.success, "Đã đổi tên \(old) → \(new)", actions: [
                ToastAction(title: "Hoàn tác") { [weak self] in
                    self?.perform("Đổi tên nhánh") { repo in try await repo.renameBranch(new, to: old) }
                },
            ])
        }
    }

    func fastForward(_ ref: GitRef) {
        guard let upstream = ref.upstream else { return }
        if ref.name == currentBranch {
            perform("Fast-forward \(ref.name)") { repo in try await repo.merge(upstream, style: .fastForwardOnly) }
        } else {
            perform("Fast-forward \(ref.name)") { repo in try await repo.fastForward(branch: ref.name, to: upstream) }
        }
    }

    // MARK: - Merge / rebase / cherry-pick / revert / reset

    func merge(_ refName: String, label: String) {
        guard let current = currentBranch else {
            toast(.warning, "Cần đứng trên một nhánh để merge")
            return
        }
        let previousHead = headOID
        perform("Merge \(label) vào \(current)") { repo in
            try await repo.merge(refName)
        } onSuccess: { [weak self] in
            self?.toast(.success, "Đã merge \(label) vào \(current)", actions: previousHead.map { head in
                [ToastAction(title: "Hoàn tác") { [weak self] in
                    self?.perform("Hoàn tác merge") { repo in try await repo.resetKeepingLocalChanges(to: head) }
                }]
            } ?? [])
        } onError: { [weak self] error in
            self?.handleConflictError(error, operation: "Merge") ?? false
        }
    }

    /// Kéo nhánh `source` thả lên `target` rồi chọn "Merge vào": checkout target (nếu cần) rồi merge.
    func merge(_ source: GitRef, into target: GitRef) {
        if target.name == currentBranch {
            merge(source.name, label: source.name)
            return
        }
        let previousHead = status.head
        perform("Merge \(source.name) vào \(target.name)") { repo in
            try await repo.switchTo(branch: target.name)
            try await repo.merge(source.name)
        } onSuccess: { [weak self] in
            self?.toast(.success, "Đã merge \(source.name) vào \(target.name)", actions: [
                ToastAction(title: "Quay lại \(previousHead.branchName ?? "HEAD cũ")") { [weak self] in self?.restoreHead(previousHead) },
            ])
        } onError: { [weak self] error in
            self?.handleConflictError(error, operation: "Merge") ?? false
        }
    }

    func rebaseCurrent(onto refName: String, label: String) {
        guard let current = currentBranch else {
            toast(.warning, "Cần đứng trên một nhánh để rebase")
            return
        }
        rebase(branch: current, onto: refName, label: label, switches: false)
    }

    func rebase(branch: String, onto refName: String, label: String, switches: Bool = true) {
        confirmation = Confirmation(
            title: "Rebase \(branch) lên \(label)?",
            message: "Các commit riêng của \(branch) sẽ được viết lại lên trên \(label). Tránh rebase nhánh đã push mà người khác đang dùng.",
            confirmTitle: "Rebase"
        ) { [weak self] in
            guard let self else { return }
            let previousHead = refs.first { $0.kind == .localBranch && $0.name == branch }?.target
            perform("Rebase \(branch) lên \(label)") { repo in
                try await repo.rebase(onto: refName, branch: switches ? branch : nil)
            } onSuccess: { [weak self] in
                self?.toast(.success, "Đã rebase \(branch) lên \(label)", actions: previousHead.map { head in
                    [ToastAction(title: "Hoàn tác") { [weak self] in
                        self?.perform("Hoàn tác rebase") { repo in
                            try await repo.switchTo(branch: branch)
                            try await repo.resetKeepingLocalChanges(to: head)
                        }
                    }]
                } ?? [])
            } onError: { [weak self] error in
                self?.handleConflictError(error, operation: "Rebase") ?? false
            }
        }
    }

    func cherryPick(_ commit: Commit) {
        let previousHead = headOID
        perform("Cherry-pick \(commit.shortSHA)") { repo in
            try await repo.cherryPick(commit.id, mainline: commit.isMerge ? 1 : nil)
        } onSuccess: { [weak self] in
            self?.toast(.success, "Đã cherry-pick “\(commit.subject)”", actions: previousHead.map { head in
                [ToastAction(title: "Hoàn tác") { [weak self] in
                    self?.perform("Hoàn tác cherry-pick") { repo in try await repo.resetKeepingLocalChanges(to: head) }
                }]
            } ?? [])
        } onError: { [weak self] error in
            self?.handleConflictError(error, operation: "Cherry-pick") ?? false
        }
    }

    func revert(_ commit: Commit) {
        let previousHead = headOID
        perform("Revert \(commit.shortSHA)") { repo in
            try await repo.revert(commit.id, mainline: commit.isMerge ? 1 : nil)
        } onSuccess: { [weak self] in
            self?.toast(.success, "Đã tạo commit revert “\(commit.subject)”", actions: previousHead.map { head in
                [ToastAction(title: "Hoàn tác") { [weak self] in
                    self?.perform("Hoàn tác revert") { repo in try await repo.resetKeepingLocalChanges(to: head) }
                }]
            } ?? [])
        } onError: { [weak self] error in
            self?.handleConflictError(error, operation: "Revert") ?? false
        }
    }

    func reset(to commit: Commit, mode: ResetMode) {
        let target = currentBranch ?? "HEAD"
        let previousHead = headOID
        let run = { [weak self] in
            guard let self else { return }
            perform("Reset \(target) (\(mode.rawValue))") { repo in
                try await repo.reset(to: commit.id, mode: mode)
            } onSuccess: { [weak self] in
                self?.toast(.success, "Đã reset \(target) về \(commit.shortSHA)", actions: previousHead.map { head in
                    [ToastAction(title: "Hoàn tác") { [weak self] in
                        self?.perform("Hoàn tác reset") { repo in try await repo.reset(to: head, mode: mode == .hard ? .hard : .soft) }
                    }]
                } ?? [])
            }
        }
        switch mode {
        case .hard:
            confirmation = Confirmation(
                title: "Reset cứng \(target) về \(commit.shortSHA)?",
                message: "Mọi thay đổi chưa commit sẽ MẤT VĨNH VIỄN. Các commit sau \(commit.shortSHA) sẽ không còn trên nhánh (vẫn hoàn tác được ngay sau đó).",
                confirmTitle: "Reset cứng",
                isDestructive: true,
                action: run
            )
        case .soft, .mixed:
            run()
        }
    }

    private func handleConflictError(_ error: any Error, operation name: String) -> Bool {
        guard let gitError = error as? GitError else { return false }
        if gitError.contains("CONFLICT") || gitError.contains("conflict") || gitError.contains("Resolve all conflicts") {
            toast(.warning, "\(name) gặp xung đột", message: "Mở các file xung đột ở panel bên phải để chọn bản giữ lại, rồi bấm “Tiếp tục”.",
                  tag: "conflict")
            select(.workingTree, reveal: true)
            return true
        }
        if gitError.contains("would be overwritten") || gitError.contains("Please commit your changes or stash them") {
            showError("\(name) bị chặn vì có thay đổi chưa commit", error, actions: [
                ToastAction(title: "Stash thay đổi") { [weak self] in self?.quickStash() },
            ])
            return true
        }
        return false
    }

    // MARK: - Thao tác dở dang (merge/rebase/cherry-pick)

    func continueOperation() {
        guard let operation else { return }
        guard status.conflicts.isEmpty else {
            toast(.warning, "Còn \(status.conflicts.count) file xung đột chưa giải quyết")
            return
        }
        if operation == .merging {
            if !hasCommitMessage, let message = repository.pendingCommitMessage() {
                let parts = message.split(separator: "\n", maxSplits: 1, omittingEmptySubsequences: false)
                commitSummary = parts.first.map(String.init) ?? "Merge"
                commitBody = parts.count > 1 ? parts[1].trimmingCharacters(in: .whitespacesAndNewlines) : ""
            }
            commit()
            return
        }
        perform("Tiếp tục \(operation.shortName)") { repo in
            try await repo.continueOperation(operation)
        } onSuccess: { [weak self] in
            self?.toast(.success, "Đã tiếp tục")
        } onError: { [weak self] error in
            self?.handleConflictError(error, operation: operation.title) ?? false
        }
    }

    func abortOperation() {
        guard let operation else { return }
        confirmation = Confirmation(
            title: "Huỷ \(operation.shortName)?",
            message: "Repository sẽ quay về trạng thái trước khi bắt đầu \(operation.shortName).",
            confirmTitle: "Huỷ \(operation.shortName)",
            isDestructive: true
        ) { [weak self] in
            self?.perform("Huỷ \(operation.shortName)") { repo in
                try await repo.abort(operation)
            } onSuccess: { [weak self] in
                self?.commitSummary = ""
                self?.commitBody = ""
                self?.toast(.success, "Đã huỷ \(operation.shortName)")
            }
        }
    }

    func skipOperation() {
        guard let operation, operation.canSkip else { return }
        perform("Bỏ qua commit hiện tại") { repo in
            try await repo.skip(operation)
        } onError: { [weak self] error in
            self?.handleConflictError(error, operation: operation.title) ?? false
        }
    }

    // MARK: - Remote

    func fetch() {
        guard !remotes.isEmpty else {
            toast(.info, "Repository chưa có remote nào", actions: [
                ToastAction(title: "Thêm remote") { [weak self] in self?.sheet = .addRemote },
            ])
            return
        }
        let progress = progressReporter()
        perform("Fetch", showsProgress: true, cancellable: true, refresh: [.refs, .status]) { repo in
            try await repo.fetch(remote: nil, prune: Prefs.fetchPruneValue, onProgress: progress)
        } onSuccess: { [weak self] in
            self?.lastFetch = Date()
            self?.toast(.success, "Đã fetch xong")
        }
    }

    func pull(mode: PullMode? = nil) {
        guard let branch = currentBranchRef else {
            toast(.warning, "Cần đứng trên một nhánh để pull")
            return
        }
        guard branch.upstream != nil, !branch.upstreamGone else {
            toast(.warning, "Nhánh \(branch.name) chưa có nhánh tương ứng trên remote", actions: [
                ToastAction(title: "Push lên remote") { [weak self] in self?.push() },
            ])
            return
        }
        let mode = mode ?? Prefs.pullModeValue
        let previousHead = headOID
        var newHead: String?
        let progress = progressReporter()
        perform("Pull", showsProgress: true, cancellable: true) { repo in
            try await repo.pull(mode: mode, onProgress: progress)
            newHead = try? await repo.resolveCommit("HEAD")
        } onSuccess: { [weak self] in
            guard let self else { return }
            lastFetch = Date()
            if let previousHead, let newHead, newHead != previousHead {
                toast(.success, "Đã pull về \(branch.name)", actions: [
                    ToastAction(title: "Hoàn tác") { [weak self] in
                        self?.perform("Hoàn tác pull") { repo in try await repo.resetKeepingLocalChanges(to: previousHead) }
                    },
                ])
            } else {
                toast(.success, "\(branch.name) đã mới nhất")
            }
        } onError: { [weak self] error in
            guard let self, let gitError = error as? GitError else { return false }
            if gitError.contains("Not possible to fast-forward") || gitError.contains("divergent") {
                showError("Nhánh local và remote đã tách nhau", error, actions: [
                    ToastAction(title: "Pull (merge)") { [weak self] in self?.pull(mode: .merge) },
                    ToastAction(title: "Pull (rebase)") { [weak self] in self?.pull(mode: .rebase) },
                ])
                return true
            }
            return handleConflictError(error, operation: "Pull")
        }
    }

    /// Tách "origin/feature/x" thành ("origin", "feature/x") theo danh sách remote.
    func splitUpstream(_ upstream: String) -> (remote: String, branch: String)? {
        for remote in remotes.sorted(by: { $0.name.count > $1.name.count }) where upstream.hasPrefix(remote.name + "/") {
            return (remote.name, String(upstream.dropFirst(remote.name.count + 1)))
        }
        return nil
    }

    func push(force: Bool = false) {
        guard let branch = currentBranchRef else {
            toast(.warning, "Cần đứng trên một nhánh để push")
            return
        }
        pushBranch(branch, force: force)
    }

    func pushBranch(_ branch: GitRef, force: Bool = false) {
        guard !remotes.isEmpty else {
            toast(.info, "Repository chưa có remote nào", actions: [
                ToastAction(title: "Thêm remote") { [weak self] in self?.sheet = .addRemote },
            ])
            return
        }
        if let upstream = branch.upstream, !branch.upstreamGone, let target = splitUpstream(upstream) {
            performPush(PushRequest(localBranch: branch.name, remote: target.remote, remoteBranch: target.branch,
                                    setUpstream: false, force: force))
        } else {
            sheet = .push(PushRequest(localBranch: branch.name, remote: defaultRemote ?? "origin",
                                      remoteBranch: branch.name, setUpstream: true, force: false))
        }
    }

    func performPush(_ request: PushRequest) {
        let progress = progressReporter()
        let title = request.force ? "Force push \(request.localBranch)" : "Push \(request.localBranch)"
        perform(title, showsProgress: true, cancellable: true, refresh: [.refs, .status]) { repo in
            try await repo.push(remote: request.remote, localBranch: request.localBranch, remoteBranch: request.remoteBranch,
                                setUpstream: request.setUpstream, force: request.force, onProgress: progress)
        } onSuccess: { [weak self] in
            self?.toast(.success, "Đã push \(request.localBranch) → \(request.remote)/\(request.remoteBranch)")
        } onError: { [weak self] error in
            guard let self, let gitError = error as? GitError else { return false }
            if gitError.contains("[rejected]") || gitError.contains("non-fast-forward") || gitError.contains("fetch first") {
                var forced = request
                forced.force = true
                showError("Push bị từ chối — remote có commit mà máy bạn chưa có", error, actions: [
                    ToastAction(title: "Pull trước") { [weak self] in self?.pull() },
                    ToastAction(title: "Force push…") { [weak self] in self?.confirmForcePush(forced) },
                ])
                return true
            }
            return false
        }
    }

    func confirmForcePush(_ request: PushRequest) {
        confirmation = Confirmation(
            title: "Force push \(request.localBranch)?",
            message: "Ghi đè \(request.remote)/\(request.remoteBranch) bằng bản trên máy bạn (--force-with-lease: sẽ dừng nếu remote có commit mới mà bạn chưa fetch).",
            confirmTitle: "Force push",
            isDestructive: true
        ) { [weak self] in
            self?.performPush(request)
        }
    }

    /// Đẩy nhánh local lên một nhánh remote cụ thể (kéo-thả nhánh local lên nhánh remote).
    func push(_ local: GitRef, to remoteRef: GitRef) {
        guard let remote = remoteRef.remoteName else { return }
        performPush(PushRequest(localBranch: local.name, remote: remote, remoteBranch: remoteRef.shortBranchName,
                                setUpstream: local.upstream == nil, force: false))
    }

    func addRemote(name: String, url: String) {
        perform("Thêm remote \(name)", refresh: [.refs]) { repo in
            try await repo.addRemote(name: name, url: url)
        } onSuccess: { [weak self] in
            self?.toast(.success, "Đã thêm remote \(name)", actions: [
                ToastAction(title: "Fetch ngay") { [weak self] in self?.fetch() },
            ])
        }
    }

    func removeRemote(_ remote: Remote) {
        confirmation = Confirmation(
            title: "Xoá remote “\(remote.name)”?",
            message: "Chỉ xoá cấu hình remote trên máy bạn (\(remote.fetchURL)).",
            confirmTitle: "Xoá remote",
            isDestructive: true
        ) { [weak self] in
            self?.perform("Xoá remote \(remote.name)", refresh: [.refs]) { repo in
                try await repo.removeRemote(name: remote.name)
            } onSuccess: { [weak self] in
                self?.toast(.success, "Đã xoá remote \(remote.name)", actions: [
                    ToastAction(title: "Hoàn tác") { [weak self] in self?.addRemote(name: remote.name, url: remote.fetchURL) },
                ])
            }
        }
    }

    // MARK: - Stash

    func beginStash() {
        guard !status.isClean else {
            toast(.info, "Không có thay đổi nào để stash")
            return
        }
        sheet = .stash
    }

    /// Nút Stash trên toolbar: cất ngay mọi thay đổi (kể cả file mới).
    func quickStash() {
        guard !status.isClean else {
            toast(.info, "Không có thay đổi nào để stash")
            return
        }
        stash(message: "", includeUntracked: true)
    }

    func stash(message: String, includeUntracked: Bool) {
        perform("Stash") { repo in
            try await repo.stashPush(message: message.isEmpty ? nil : message, includeUntracked: includeUntracked)
        } onSuccess: { [weak self] in
            self?.toast(.success, "Đã cất thay đổi vào stash", actions: [
                ToastAction(title: "Hoàn tác") { [weak self] in self?.popLatestStash() },
            ])
        }
    }

    func applyStash(_ stash: Stash) {
        perform("Apply stash") { repo in
            try await repo.stashApply(stash.selector)
        } onSuccess: { [weak self] in
            self?.toast(.success, "Đã áp dụng stash “\(stash.displayMessage)”")
        } onError: { [weak self] error in
            self?.handleConflictError(error, operation: "Apply stash") ?? false
        }
    }

    func popStash(_ stash: Stash) {
        perform("Pop stash") { repo in
            try await repo.stashPop(stash.selector)
        } onSuccess: { [weak self] in
            self?.toast(.success, "Đã lấy lại thay đổi từ stash")
        } onError: { [weak self] error in
            guard let self else { return false }
            if handleConflictError(error, operation: "Pop stash") {
                toast(.info, "Stash vẫn được giữ lại vì có xung đột")
                return true
            }
            return false
        }
    }

    func popLatestStash() {
        guard let latest = stashes.first else {
            toast(.info, "Không có stash nào")
            return
        }
        popStash(latest)
    }

    func dropStash(_ stash: Stash) {
        confirmation = Confirmation(
            title: "Xoá stash “\(stash.displayMessage)”?",
            message: "Có thể bấm “Hoàn tác” ngay sau đó.",
            confirmTitle: "Xoá stash",
            isDestructive: true
        ) { [weak self] in
            self?.perform("Xoá stash") { repo in
                try await repo.stashDrop(stash.selector)
            } onSuccess: { [weak self] in
                self?.toast(.success, "Đã xoá stash", actions: [
                    ToastAction(title: "Hoàn tác") { [weak self] in
                        self?.perform("Khôi phục stash") { repo in try await repo.stashStore(sha: stash.sha, message: stash.message) }
                    },
                ])
            }
        }
    }

    // MARK: - Tag

    func beginCreateTag(at commit: Commit) {
        sheet = .createTag(sha: commit.id, label: commit.shortSHA)
    }

    func createTag(name: String, sha: String, message: String, pushToRemote: Bool) {
        let remote = defaultRemote
        let progress = progressReporter()
        perform("Tạo tag \(name)", showsProgress: pushToRemote, refresh: [.refs]) { repo in
            try await repo.createTag(name, at: sha, message: message)
            if pushToRemote, let remote { try await repo.pushTag(remote: remote, tag: name, onProgress: progress) }
        } onSuccess: { [weak self] in
            self?.toast(.success, pushToRemote ? "Đã tạo và push tag \(name)" : "Đã tạo tag \(name)", actions: pushToRemote ? [] : [
                ToastAction(title: "Hoàn tác") { [weak self] in
                    self?.perform("Xoá tag \(name)", refresh: [.refs]) { repo in try await repo.deleteTag(name) }
                },
            ])
        }
    }

    func deleteTag(_ ref: GitRef) {
        confirmation = Confirmation(
            title: "Xoá tag “\(ref.name)”?",
            message: "Chỉ xoá tag trên máy bạn. Có thể bấm “Hoàn tác” ngay sau đó.",
            confirmTitle: "Xoá tag",
            isDestructive: true
        ) { [weak self] in
            self?.perform("Xoá tag \(ref.name)", refresh: [.refs]) { repo in
                try await repo.deleteTag(ref.name)
            } onSuccess: { [weak self] in
                self?.toast(.success, "Đã xoá tag \(ref.name)", actions: [
                    ToastAction(title: "Hoàn tác") { [weak self] in
                        self?.perform("Khôi phục tag", refresh: [.refs]) { repo in try await repo.updateRef(ref.fullName, to: ref.objectName) }
                    },
                ])
            }
        }
    }

    func pushTag(_ ref: GitRef) {
        guard let remote = defaultRemote else {
            toast(.info, "Repository chưa có remote nào")
            return
        }
        let progress = progressReporter()
        perform("Push tag \(ref.name)", showsProgress: true, cancellable: true, refresh: [.refs]) { repo in
            try await repo.pushTag(remote: remote, tag: ref.name, onProgress: progress)
        } onSuccess: { [weak self] in
            self?.toast(.success, "Đã push tag \(ref.name) lên \(remote)")
        }
    }

    func deleteRemoteTag(_ ref: GitRef) {
        guard let remote = defaultRemote else { return }
        confirmation = Confirmation(
            title: "Xoá tag “\(ref.name)” trên \(remote)?",
            message: "Tag sẽ bị xoá khỏi remote cho mọi người; tag trên máy bạn vẫn giữ nguyên.",
            confirmTitle: "Xoá trên remote",
            isDestructive: true
        ) { [weak self] in
            self?.perform("Xoá tag trên remote", showsProgress: true, refresh: [.refs]) { repo in
                try await repo.deleteRemoteTag(remote: remote, tag: ref.name)
            } onSuccess: { [weak self] in
                self?.toast(.success, "Đã xoá tag \(ref.name) trên \(remote)")
            }
        }
    }

    // MARK: - Ứng dụng ngoài

    func openInTerminal() {
        let configuration = NSWorkspace.OpenConfiguration()
        for bundleID in ["com.mitchellh.ghostty", "com.googlecode.iterm2", "dev.warp.Warp-Stable", "com.apple.Terminal"] {
            if let app = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID) {
                NSWorkspace.shared.open([repository.root], withApplicationAt: app, configuration: configuration)
                return
            }
        }
    }

    func revealInFinder() {
        NSWorkspace.shared.activateFileViewerSelecting([repository.root])
    }

    func openInEditor(path: String? = nil) {
        let target = path.map { repository.root.appendingPathComponent($0) } ?? repository.root
        for bundleID in ["com.microsoft.VSCode", "com.todesktop.230313mzl4w4u92", "dev.zed.Zed", "com.sublimetext.4"] {
            if let app = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID) {
                NSWorkspace.shared.open([target], withApplicationAt: app, configuration: NSWorkspace.OpenConfiguration())
                return
            }
        }
        NSWorkspace.shared.open(target)
    }

    func openFileInDefaultApp(_ path: String) {
        NSWorkspace.shared.open(repository.root.appendingPathComponent(path))
    }

    func revealFile(_ path: String) {
        NSWorkspace.shared.activateFileViewerSelecting([repository.root.appendingPathComponent(path)])
    }

    func copy(_ text: String, label: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        toast(.info, "Đã sao chép \(label)")
    }

    /// Đường dẫn web của commit trên GitHub/GitLab/Bitbucket (nếu remote là một trong số đó).
    func webURL(forCommit sha: String) -> URL? {
        guard let remote = remotes.first(where: { $0.name == defaultRemote }) ?? remotes.first else { return nil }
        var url = remote.fetchURL
        if url.hasPrefix("git@") {
            url = "https://" + url.dropFirst(4).replacingOccurrences(of: ":", with: "/")
        } else if url.hasPrefix("ssh://git@") {
            url = "https://" + url.dropFirst("ssh://git@".count)
        }
        if url.hasSuffix(".git") { url.removeLast(4) }
        guard let base = URL(string: url), let host = base.host else { return nil }
        if host.contains("github") { return URL(string: url + "/commit/" + sha) }
        if host.contains("gitlab") { return URL(string: url + "/-/commit/" + sha) }
        if host.contains("bitbucket") { return URL(string: url + "/commits/" + sha) }
        return nil
    }

    // MARK: - Menu ngữ cảnh

    func menu(for entry: GraphEntry) -> [MenuItemSpec] {
        if entry.commit.isWorkingTree { return workingTreeMenu() }
        let commit = entry.commit
        var items: [MenuItemSpec] = []
        for label in entry.labels where !label.isDetachedHead {
            for ref in label.refs {
                items.append(.submenu(ref.name, systemImage: icon(for: ref), items: menu(for: ref)))
            }
        }
        if !items.isEmpty { items.append(.separator) }
        let isHead = commit.id == headOID
        let branchLabel = currentBranch ?? "HEAD"
        items += [
            .action("Tạo nhánh tại đây…", systemImage: "arrow.triangle.branch") { [weak self] in self?.beginCreateBranch(at: commit) },
            .action("Tạo tag tại đây…", systemImage: "tag") { [weak self] in self?.beginCreateTag(at: commit) },
            .action("Checkout commit này", systemImage: "arrow.uturn.right", enabled: !isHead) { [weak self] in
                self?.checkoutDetached(commit.id, label: "commit \(commit.shortSHA)")
            },
            .separator,
            .action("Cherry-pick vào \(branchLabel)", systemImage: "leaf", enabled: !isHead) { [weak self] in self?.cherryPick(commit) },
            .action("Revert commit này", systemImage: "arrow.uturn.backward", enabled: headOID != nil) { [weak self] in self?.revert(commit) },
            .submenu("Reset \(branchLabel) về đây", systemImage: "clock.arrow.circlepath", items: [
                .action("Soft — giữ mọi thay đổi ở trạng thái đã stage") { [weak self] in self?.reset(to: commit, mode: .soft) },
                .action("Mixed — giữ thay đổi, bỏ stage") { [weak self] in self?.reset(to: commit, mode: .mixed) },
                .action("Hard — bỏ mọi thay đổi", destructive: true) { [weak self] in self?.reset(to: commit, mode: .hard) },
            ]),
            .separator,
            .action("Sao chép SHA", systemImage: "number") { [weak self] in self?.copy(commit.id, label: "SHA") },
            .action("Sao chép message", systemImage: "doc.on.doc") { [weak self] in self?.copy(commit.subject, label: "message") },
        ]
        if let url = webURL(forCommit: commit.id) {
            items.append(.action("Mở trên web", systemImage: "safari") { NSWorkspace.shared.open(url) })
        }
        return items
    }

    func workingTreeMenu() -> [MenuItemSpec] {
        [
            .action("Stage tất cả", systemImage: "plus.circle", enabled: !status.unstaged.isEmpty) { [weak self] in self?.stageAll() },
            .action("Bỏ stage tất cả", systemImage: "minus.circle", enabled: !status.staged.isEmpty) { [weak self] in self?.unstageAll() },
            .separator,
            .action("Stash tất cả thay đổi", systemImage: "archivebox") { [weak self] in self?.quickStash() },
            .action("Stash kèm lời nhắn…", systemImage: "square.and.pencil") { [weak self] in self?.beginStash() },
            .separator,
            .action("Huỷ tất cả thay đổi…", systemImage: "trash", destructive: true, enabled: operation == nil) { [weak self] in
                self?.discardAllChanges()
            },
        ]
    }

    func menu(for ref: GitRef) -> [MenuItemSpec] {
        let current = currentBranch
        var items: [MenuItemSpec] = []
        switch ref.kind {
        case .localBranch:
            let isCurrent = ref.name == current
            if isCurrent {
                items.append(.action("Pull", systemImage: "arrow.down") { [weak self] in self?.pull() })
                items.append(.action("Push", systemImage: "arrow.up") { [weak self] in self?.push() })
            } else {
                items.append(.action("Checkout \(ref.name)", systemImage: "arrow.uturn.right") { [weak self] in self?.checkout(ref) })
                if let current {
                    items.append(.action("Merge \(ref.name) vào \(current)", systemImage: "arrow.triangle.merge") { [weak self] in
                        self?.merge(ref.name, label: ref.name)
                    })
                    items.append(.action("Rebase \(current) lên \(ref.name)", systemImage: "arrow.triangle.swap") { [weak self] in
                        self?.rebaseCurrent(onto: ref.name, label: ref.name)
                    })
                }
                items.append(.action("Push \(ref.name)", systemImage: "arrow.up") { [weak self] in self?.pushBranch(ref) })
            }
            if ref.upstream != nil, ref.behind > 0, ref.ahead == 0 {
                items.append(.action("Fast-forward theo \(ref.upstream ?? "")", systemImage: "forward") { [weak self] in self?.fastForward(ref) })
            }
            items.append(.separator)
            items.append(.action("Tạo nhánh từ \(ref.name)…", systemImage: "arrow.triangle.branch") { [weak self] in
                self?.sheet = .createBranch(startPoint: ref.target, label: ref.name)
            })
            items.append(.action("Đổi tên…", systemImage: "pencil") { [weak self] in self?.sheet = .renameBranch(ref.name) })
            items.append(.action("Xoá nhánh…", systemImage: "trash", destructive: true, enabled: !isCurrent) { [weak self] in
                self?.deleteBranch(ref)
            })
        case .remoteBranch:
            items.append(.action("Checkout \(ref.shortBranchName)", systemImage: "arrow.uturn.right") { [weak self] in self?.checkout(ref) })
            if let current {
                items.append(.action("Merge \(ref.name) vào \(current)", systemImage: "arrow.triangle.merge") { [weak self] in
                    self?.merge(ref.name, label: ref.name)
                })
                items.append(.action("Rebase \(current) lên \(ref.name)", systemImage: "arrow.triangle.swap") { [weak self] in
                    self?.rebaseCurrent(onto: ref.name, label: ref.name)
                })
            }
            items.append(.separator)
            items.append(.action("Tạo nhánh từ \(ref.name)…", systemImage: "arrow.triangle.branch") { [weak self] in
                self?.sheet = .createBranch(startPoint: ref.target, label: ref.name)
            })
            items.append(.action("Xoá trên remote…", systemImage: "trash", destructive: true) { [weak self] in self?.deleteRemoteBranch(ref) })
        case .tag:
            items.append(.action("Checkout tag \(ref.name)", systemImage: "arrow.uturn.right") { [weak self] in self?.checkout(ref) })
            items.append(.action("Push tag lên remote", systemImage: "arrow.up", enabled: !remotes.isEmpty) { [weak self] in self?.pushTag(ref) })
            items.append(.action("Tạo nhánh từ tag…", systemImage: "arrow.triangle.branch") { [weak self] in
                self?.sheet = .createBranch(startPoint: ref.target, label: ref.name)
            })
            items.append(.separator)
            items.append(.action("Xoá tag…", systemImage: "trash", destructive: true) { [weak self] in self?.deleteTag(ref) })
            items.append(.action("Xoá tag trên remote…", systemImage: "icloud.slash", destructive: true, enabled: !remotes.isEmpty) { [weak self] in
                self?.deleteRemoteTag(ref)
            })
        }
        items.append(.separator)
        items.append(.action("Sao chép tên", systemImage: "doc.on.doc") { [weak self] in self?.copy(ref.name, label: "tên") })
        return items
    }

    func icon(for ref: GitRef) -> String {
        switch ref.kind {
        case .localBranch: return "laptopcomputer"
        case .remoteBranch: return "cloud"
        case .tag: return "tag"
        }
    }

    func stashMenu(_ stash: Stash) -> [MenuItemSpec] {
        [
            .action("Apply (giữ stash)", systemImage: "tray.and.arrow.down") { [weak self] in self?.applyStash(stash) },
            .action("Pop (áp dụng rồi xoá)", systemImage: "tray.and.arrow.up") { [weak self] in self?.popStash(stash) },
            .separator,
            .action("Xoá stash…", systemImage: "trash", destructive: true) { [weak self] in self?.dropStash(stash) },
        ]
    }

    func fileMenu(_ change: FileChange, source: DiffSource) -> [MenuItemSpec] {
        var items: [MenuItemSpec] = []
        switch source {
        case .unstaged:
            items.append(.action("Stage file", systemImage: "plus.circle") { [weak self] in self?.stage([change]) })
            items.append(.action("Huỷ thay đổi…", systemImage: "arrow.uturn.backward", destructive: true) { [weak self] in self?.discard([change]) })
            if change.kind == .untracked {
                let ext = (change.path as NSString).pathExtension
                var ignoreItems: [MenuItemSpec] = [
                    .action("Bỏ qua file này") { [weak self] in self?.ignore(pattern: "/" + change.path) },
                ]
                if !ext.isEmpty {
                    ignoreItems.append(.action("Bỏ qua mọi file *.\(ext)") { [weak self] in self?.ignore(pattern: "*." + ext) })
                }
                if !change.directory.isEmpty {
                    ignoreItems.append(.action("Bỏ qua thư mục \(change.directory)/") { [weak self] in self?.ignore(pattern: "/" + change.directory + "/") })
                }
                items.append(.submenu("Thêm vào .gitignore", systemImage: "eye.slash", items: ignoreItems))
            }
        case .staged:
            items.append(.action("Bỏ stage file", systemImage: "minus.circle") { [weak self] in self?.unstage([change]) })
        default:
            break
        }
        if !items.isEmpty { items.append(.separator) }
        let fileExists = FileManager.default.fileExists(atPath: repository.root.appendingPathComponent(change.path).path)
        items.append(.action("Mở file", systemImage: "doc", enabled: fileExists) { [weak self] in self?.openFileInDefaultApp(change.path) })
        items.append(.action("Mở bằng trình soạn thảo", systemImage: "chevron.left.forwardslash.chevron.right", enabled: fileExists) { [weak self] in
            self?.openInEditor(path: change.path)
        })
        items.append(.action("Hiện trong Finder", systemImage: "folder", enabled: fileExists) { [weak self] in self?.revealFile(change.path) })
        items.append(.action("Lịch sử file", systemImage: "clock") { [weak self] in self?.sheet = .fileHistory(change.path) })
        items.append(.separator)
        items.append(.action("Sao chép đường dẫn", systemImage: "doc.on.doc") { [weak self] in self?.copy(change.path, label: "đường dẫn") })
        return items
    }

    /// Lựa chọn khi kéo nhánh `source` thả lên nhánh/remote đích.
    func dropOptions(_ request: DragRequest) -> [MenuItemSpec] {
        let source = request.source
        var items: [MenuItemSpec] = []
        switch request.target {
        case .ref(let target):
            guard source.fullName != target.fullName else { return [] }
            if target.kind == .localBranch {
                items.append(.action("Merge \(source.name) vào \(target.name)", systemImage: "arrow.triangle.merge") { [weak self] in
                    self?.merge(source, into: target)
                })
                if source.kind == .localBranch {
                    items.append(.action("Rebase \(source.name) lên \(target.name)", systemImage: "arrow.triangle.swap") { [weak self] in
                        self?.rebase(branch: source.name, onto: target.name, label: target.name, switches: source.name != self?.currentBranch)
                    })
                }
                if source.kind == .remoteBranch, target.upstream == source.name, target.behind > 0, target.ahead == 0 {
                    items.append(.action("Fast-forward \(target.name) theo \(source.name)", systemImage: "forward") { [weak self] in
                        self?.fastForward(target)
                    })
                }
            }
            if target.kind == .remoteBranch {
                if source.kind == .localBranch {
                    items.append(.action("Push \(source.name) lên \(target.name)", systemImage: "arrow.up") { [weak self] in
                        self?.push(source, to: target)
                    })
                }
                if let current = currentBranch, source.kind == .localBranch, source.name == current {
                    items.append(.action("Rebase \(current) lên \(target.name)", systemImage: "arrow.triangle.swap") { [weak self] in
                        self?.rebaseCurrent(onto: target.name, label: target.name)
                    })
                }
            }
            if target.kind == .tag {
                items.append(.action("Không có thao tác khi thả lên tag", enabled: false) {})
            }
        case .remote(let remote):
            if source.kind == .localBranch {
                items.append(.action("Push \(source.name) lên \(remote.name)", systemImage: "arrow.up") { [weak self] in
                    self?.performPush(PushRequest(localBranch: source.name, remote: remote.name, remoteBranch: source.name,
                                                  setUpstream: source.upstream == nil, force: false))
                })
            } else if source.kind == .tag {
                items.append(.action("Push tag \(source.name) lên \(remote.name)", systemImage: "arrow.up") { [weak self] in
                    self?.pushTag(source)
                })
            }
        }
        return items
    }
}
