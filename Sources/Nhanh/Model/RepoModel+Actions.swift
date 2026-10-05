import AppKit
import NhanhCore
import SwiftUI

extension RepoModel {
    // MARK: - Stage / unstage / discard a file

    func stage(_ changes: [FileChange]) {
        let paths = Array(Set(changes.flatMap(\.allPaths)))
        guard !paths.isEmpty else { return }
        perform("Stage", refresh: [.status]) { repo in
            try await repo.stage(paths: paths)
        }
    }

    func stageAll() {
        guard !status.unstaged.isEmpty else { return }
        perform(String(localized: "Stage tất cả"), refresh: [.status]) { repo in
            try await repo.stageAll()
        }
    }

    func unstage(_ changes: [FileChange]) {
        let paths = Array(Set(changes.flatMap(\.allPaths)))
        guard !paths.isEmpty else { return }
        let headExists = headOID != nil
        perform(String(localized: "Bỏ stage"), refresh: [.status]) { repo in
            try await repo.unstage(paths: paths, headExists: headExists)
        }
    }

    func unstageAll() {
        guard !status.staged.isEmpty else { return }
        let headExists = headOID != nil
        perform(String(localized: "Bỏ stage tất cả"), refresh: [.status]) { repo in
            try await repo.unstageAll(headExists: headExists)
        }
    }

    func discard(_ changes: [FileChange]) {
        guard !changes.isEmpty else { return }
        let tracked = changes.filter { $0.kind != .untracked }.map(\.path)
        let untracked = changes.filter { $0.kind == .untracked }.map(\.path)
        let label = changes.count == 1 ? "“\(changes[0].fileName)”" : "\(changes.count) file"
        confirmation = Confirmation(
            title: String(localized: "Huỷ thay đổi trong \(label)?"),
            message: String(localized: "Thay đổi chưa stage sẽ bị bỏ, file chưa track được chuyển vào Thùng rác. Bạn có thể bấm “Hoàn tác” ngay sau đó."),
            confirmTitle: String(localized: "Huỷ thay đổi"),
            isDestructive: true
        ) { [weak self] in
            self?.performDiscard(tracked: tracked, untracked: untracked)
        }
    }

    private func performDiscard(tracked: [String], untracked: [String]) {
        var snapshot: String?
        var trashed: [String: URL] = [:]
        perform(String(localized: "Huỷ thay đổi"), refresh: [.status]) { repo in
            if !tracked.isEmpty {
                snapshot = try await repo.snapshotChanges()
                try await repo.discard(paths: tracked)
            }
            if !untracked.isEmpty {
                trashed = try repo.trashUntracked(paths: untracked)
            }
        } onSuccess: { [weak self] in
            self?.toast(.success, String(localized: "Đã huỷ thay đổi"), actions: [
                ToastAction(title: String(localized: "Hoàn tác")) { [weak self] in
                    self?.undoDiscard(snapshot: snapshot, tracked: tracked, trashed: trashed)
                },
            ])
        }
    }

    private func undoDiscard(snapshot: String?, tracked: [String], trashed: [String: URL]) {
        perform(String(localized: "Hoàn tác huỷ thay đổi"), refresh: [.status]) { repo in
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
            toast(.warning, String(localized: "\(operation.title) — hãy dùng nút “Huỷ” trên thanh trạng thái thao tác"))
            return
        }
        let untracked = status.unstaged.filter { $0.kind == .untracked }.map(\.path)
        confirmation = Confirmation(
            title: String(localized: "Huỷ TẤT CẢ thay đổi chưa commit?"),
            message: String(localized: "Mọi thay đổi (kể cả đã stage) sẽ bị bỏ, file chưa track được chuyển vào Thùng rác. Có thể bấm “Hoàn tác” ngay sau đó."),
            confirmTitle: String(localized: "Huỷ tất cả"),
            isDestructive: true
        ) { [weak self] in
            guard let self else { return }
            var snapshot: String?
            var trashed: [String: URL] = [:]
            perform(String(localized: "Huỷ tất cả thay đổi")) { repo in
                snapshot = try await repo.snapshotChanges()
                try await repo.hardReset()
                if !untracked.isEmpty { trashed = try repo.trashUntracked(paths: untracked) }
            } onSuccess: { [weak self] in
                self?.toast(.success, String(localized: "Đã huỷ tất cả thay đổi"), actions: [
                    ToastAction(title: String(localized: "Hoàn tác")) { [weak self] in
                        self?.perform(String(localized: "Hoàn tác huỷ tất cả")) { repo in
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
        perform(String(localized: "Thêm vào .gitignore"), refresh: [.status]) { repo in
            try repo.addToGitignore(pattern)
        } onSuccess: { [weak self] in
            self?.toast(.success, String(localized: "Đã thêm “\(pattern)” vào .gitignore"))
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

    /// Whether "Commit & Push" is available: there's a remote, we're on a branch, and it's not an amend (amending a pushed
    /// commit makes a normal push get rejected, while "Pull first" creates a merge — leave the choice to the user).
    var canCommitAndPush: Bool {
        !remotes.isEmpty && currentBranchRef != nil && !amendLastCommit
    }

    /// Commit with the compose box's contents; `andPush`: push the current branch right after (no push when the commit fails).
    func commit(stageAllFirst: Bool = false, andPush: Bool = false) {
        guard hasCommitMessage else {
            toast(.warning, String(localized: "Hãy nhập tóm tắt cho commit"))
            return
        }
        guard status.conflicts.isEmpty else {
            toast(.warning, String(localized: "Còn \(status.conflicts.count) file xung đột chưa giải quyết"))
            return
        }
        let message = composedCommitMessage
        // Mid merge / revert…: the commit finishes the operation and must never modify an earlier commit (the amend box is locked meanwhile).
        let amend = amendLastCommit && operation == nil
        let previousHead = headOID
        let branch = currentBranch ?? "HEAD"
        perform(amend ? String(localized: "Sửa commit trước") : "Commit") { repo in
            if stageAllFirst { try await repo.stageAll() }
            try await repo.commit(message: message, amend: amend)
        } onSuccess: { [weak self] in
            guard let self else { return }
            savedSummaryBeforeAmend = nil
            // Turn amend OFF before clearing the compose box so the repo's saved draft is deleted too.
            amendLastCommit = false
            commitSummary = ""
            commitBody = ""
            toast(.success, amend ? String(localized: "Đã sửa commit trước") : String(localized: "Đã commit vào \(branch)"), actions: [
                ToastAction(title: String(localized: "Hoàn tác")) { [weak self] in self?.undoCommit(previousHead: previousHead, message: message) },
            ])
            if andPush { push() }
        } onError: { [weak self] error in
            guard let self, let gitError = error as? GitError else { return false }
            if gitError.contains("Please tell me who you are") || gitError.contains("empty ident") {
                sheet = .identity
                toast(.warning, String(localized: "Cần đặt tên và email cho Git trước khi commit"))
                return true
            }
            return false
        }
    }

    func undoCommit(previousHead: String?, message: String) {
        perform(String(localized: "Hoàn tác commit")) { repo in
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
            toast(.info, String(localized: "Đã hoàn tác commit — thay đổi vẫn còn ở trạng thái đã stage"))
        }
    }

    func amendToggled() {
        if amendLastCommit {
            savedSummaryBeforeAmend = (commitSummary, commitBody)
            guard commitSummary.isEmpty, let head = headOID else { return }
            let repo = repository
            Task {
                guard let message = try? await repo.commitMessage(head), amendLastCommit, commitSummary.isEmpty else { return }
                // A CRLF message (committed from another tool): "\r\n" is ONE Character in Swift, so it must be turned back into "\n" before splitting lines.
                let trimmed = message.replacingOccurrences(of: "\r\n", with: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
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
        perform(String(localized: "Lưu tên & email Git"), refresh: []) { repo in
            try await repo.setConfig("user.name", name, global: true)
            try await repo.setConfig("user.email", email, global: true)
        } onSuccess: { [weak self] in
            self?.loadCommitterIdentity()
            self?.toast(.success, String(localized: "Đã lưu tên & email cho Git"))
        }
    }

    // MARK: - Checkout

    func checkout(_ ref: GitRef) {
        switch ref.kind {
        case .localBranch:
            guard ref.name != currentBranch else {
                toast(.info, String(localized: "Đang ở nhánh \(ref.name)"))
                return
            }
            switchToBranch(ref.name)
        case .remoteBranch:
            let localName = ref.shortBranchName
            if let local = refs.first(where: { $0.kind == .localBranch && $0.name == localName }) {
                if local.name == currentBranch {
                    toast(.info, String(localized: "Đang ở nhánh \(local.name)"))
                } else {
                    switchToBranch(local.name)
                }
                return
            }
            let previous = status.head
            perform("Checkout \(ref.name)") { repo in
                try await repo.checkoutTracking(remoteBranch: ref.name, localName: localName)
            } onSuccess: { [weak self] in
                self?.toast(.success, String(localized: "Đã tạo nhánh \(localName) theo dõi \(ref.name)"), actions: [
                    ToastAction(title: String(localized: "Hoàn tác")) { [weak self] in
                        self?.restoreHead(previous) { repo in try await repo.deleteBranch(localName, force: true) }
                    },
                ])
            } onError: { [weak self] error in
                self?.handleCheckoutError(error, retry: CheckoutRetry(title: "Checkout \(ref.name)") { repo in
                    try await repo.checkoutTracking(remoteBranch: ref.name, localName: localName)
                }) ?? false
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
            self?.toast(.success, String(localized: "Đã chuyển sang nhánh \(name)"), actions: [
                ToastAction(title: String(localized: "Hoàn tác")) { [weak self] in self?.restoreHead(previous) },
            ])
        } onError: { [weak self] error in
            self?.handleCheckoutError(error, retry: CheckoutRetry(title: "Checkout \(name)") { repo in
                try await repo.switchTo(branch: name)
            }) ?? false
        }
    }

    func checkoutDetached(_ sha: String, label: String) {
        confirmation = Confirmation(
            title: "Checkout \(label)?",
            message: String(localized: "Bạn sẽ ở trạng thái detached HEAD (không thuộc nhánh nào). Muốn commit tiếp thì hãy tạo nhánh mới tại đó."),
            confirmTitle: "Checkout"
        ) { [weak self] in
            guard let self else { return }
            let previous = status.head
            perform("Checkout \(label)") { repo in
                try await repo.switchDetached(sha)
            } onSuccess: { [weak self] in
                self?.toast(.success, String(localized: "Đang ở \(label) (detached HEAD)"), actions: [
                    ToastAction(title: String(localized: "Hoàn tác")) { [weak self] in self?.restoreHead(previous) },
                ])
            } onError: { [weak self] error in
                self?.handleCheckoutError(error, retry: CheckoutRetry(title: "Checkout \(label)") { repo in
                    try await repo.switchDetached(sha)
                }) ?? false
            }
        }
    }

    /// Go back to the previous HEAD (a branch or a commit), then run `then` if there is one.
    func restoreHead(_ head: HeadState, then: ((GitRepository) async throws -> Void)? = nil) {
        perform(String(localized: "Hoàn tác checkout")) { repo in
            switch head {
            case .branch(let name, _): try await repo.switchTo(branch: name)
            case .detached(let oid): try await repo.switchDetached(oid)
            case .unknown: break
            }
            try await then?(repo)
        }
    }

    /// The work needed to redo when uncommitted changes block a checkout / branch creation. `undo` cleans up what was already
    /// created (e.g. the new branch) when we have to go back to the old place.
    struct CheckoutRetry {
        var title: String
        var work: (GitRepository) async throws -> Void
        var undo: ((GitRepository) async throws -> Void)? = nil
    }

    /// Uncommitted changes block a checkout: when they can be carried over (reapplying doesn't conflict) go ahead, like GitKraken;
    /// on conflict put everything back and ask whether to commit or stash it.
    func handleCheckoutError(_ error: any Error, retry: CheckoutRetry) -> Bool {
        guard let gitError = error as? GitError,
              gitError.contains("would be overwritten") || gitError.contains("Please commit your changes or stash them") else {
            return false
        }
        if gitError.contains("untracked working tree files") {
            askToSaveWork(retry)
        } else {
            carryThen(retry)
        }
        return true
    }

    private func topStashSHA(_ repo: GitRepository) async throws -> String? {
        try await repo.stashes().first?.sha
    }

    /// Stash the changes (tracked files), run the operation, then reapply them on the new base. When reapplying conflicts it
    /// goes back to the old HEAD, returns the changes as they were and asks the user; a failing operation restores the changes too.
    private func carryThen(_ retry: CheckoutRetry) {
        var conflict = false
        let previous = status.head
        perform(retry.title) { [weak self] repo in
            guard let self else { return }
            let before = try await topStashSHA(repo)
            try await repo.stashPush(message: String(localized: "Thaigit: tự stash trước khi \(retry.title.lowercased())"), includeUntracked: false)
            let stashed = try await topStashSHA(repo) != before
            do {
                try await retry.work(repo)
            } catch {
                if stashed { try? await repo.stashPop("stash@{0}") }
                throw error
            }
            guard stashed else { return }
            do {
                try await repo.stashApply("stash@{0}")
                try await repo.stashDrop("stash@{0}")
            } catch {
                conflict = true
                try await repo.reset(to: "HEAD", mode: .hard)
                switch previous {
                case .branch(let name, _): try await repo.switchTo(branch: name)
                case .detached(let oid): try await repo.switchDetached(oid)
                case .unknown: break
                }
                try await retry.undo?(repo)
                try await repo.stashPop("stash@{0}")
            }
        } onSuccess: { [weak self] in
            guard let self else { return }
            if conflict {
                askToSaveWork(retry)
            } else {
                toast(.success, String(localized: "\(retry.title) xong — đã mang theo thay đổi chưa commit"))
            }
        }
    }

    /// Changes clash with the target branch and can't be carried over: commit them, or stash them (keeping a draft) and then switch.
    private func askToSaveWork(_ retry: CheckoutRetry) {
        confirmation = Confirmation(
            title: String(localized: "Thay đổi chưa commit đang vướng"),
            message: String(localized: "Code bạn đang sửa xung đột với nhánh muốn chuyển sang nên không mang theo được. Hãy commit, hoặc cất vào stash (lưu nháp) rồi chuyển."),
            confirmTitle: String(localized: "Cất vào stash rồi chuyển"),
            action: { [weak self] in self?.stashThen(retry) },
            secondaryTitle: String(localized: "Để mình commit"),
            secondaryAction: { [weak self] in self?.selectWorkingTree() }
        )
    }

    /// Stash every change (including new files), run the operation, don't reapply. On failure the changes are restored.
    func stashThen(_ retry: CheckoutRetry) {
        perform(retry.title) { [weak self] repo in
            guard let self else { return }
            let before = try await topStashSHA(repo)
            try await repo.stashPush(message: String(localized: "Thaigit: tự stash trước khi \(retry.title.lowercased())"), includeUntracked: true)
            let stashed = try await topStashSHA(repo) != before
            do {
                try await retry.work(repo)
            } catch {
                if stashed { try? await repo.stashPop("stash@{0}") }
                throw error
            }
        } onSuccess: { [weak self] in
            self?.toast(.success, String(localized: "\(retry.title) xong — thay đổi chưa commit đã được cất vào stash mới nhất"))
        }
    }

    // MARK: - Nhánh

    func beginCreateBranchAtHead() {
        guard let head = headOID else {
            toast(.info, String(localized: "Cần có ít nhất một commit trước khi tạo nhánh"))
            return
        }
        sheet = .createBranch(startPoint: head, label: currentBranch ?? String(head.prefix(7)))
    }

    func beginCreateBranch(at commit: Commit) {
        sheet = .createBranch(startPoint: commit.id, label: commit.shortSHA)
    }

    func createBranch(name: String, startPoint: String, checkout: Bool) {
        let previous = status.head
        perform(String(localized: "Tạo nhánh \(name)")) { repo in
            try await repo.createBranch(name, at: startPoint, checkout: checkout)
        } onSuccess: { [weak self] in
            self?.toast(.success, checkout ? String(localized: "Đã tạo và chuyển sang nhánh \(name)") : String(localized: "Đã tạo nhánh \(name)"), actions: [
                ToastAction(title: String(localized: "Hoàn tác")) { [weak self] in
                    if checkout {
                        self?.restoreHead(previous) { repo in try await repo.deleteBranch(name, force: true) }
                    } else {
                        self?.perform(String(localized: "Xoá nhánh \(name)")) { repo in try await repo.deleteBranch(name, force: true) }
                    }
                },
            ])
        } onError: { [weak self] error in
            self?.handleCheckoutError(error, retry: CheckoutRetry(
                title: String(localized: "Tạo nhánh \(name)"),
                work: { repo in try await repo.createBranch(name, at: startPoint, checkout: checkout) },
                undo: { repo in try await repo.deleteBranch(name, force: true) }
            )) ?? false
        }
    }

    func deleteBranch(_ ref: GitRef) {
        guard ref.name != currentBranch else {
            toast(.warning, String(localized: "Không thể xoá nhánh đang checkout — hãy chuyển sang nhánh khác trước"))
            return
        }
        confirmation = Confirmation(
            title: String(localized: "Xoá nhánh “\(ref.name)”?"),
            message: String(localized: "Chỉ xoá nhánh trên máy bạn. Có thể bấm “Hoàn tác” ngay sau đó."),
            confirmTitle: String(localized: "Xoá nhánh"),
            isDestructive: true
        ) { [weak self] in
            self?.performDeleteBranch(ref, force: false)
        }
    }

    private func performDeleteBranch(_ ref: GitRef, force: Bool) {
        perform(String(localized: "Xoá nhánh \(ref.name)")) { repo in
            try await repo.deleteBranch(ref.name, force: force)
        } onSuccess: { [weak self] in
            self?.toast(.success, String(localized: "Đã xoá nhánh \(ref.name)"), actions: [
                ToastAction(title: String(localized: "Hoàn tác")) { [weak self] in
                    self?.perform(String(localized: "Khôi phục nhánh \(ref.name)")) { repo in try await repo.updateRef(ref.fullName, to: ref.target) }
                },
            ])
        } onError: { [weak self] error in
            guard let self, let gitError = error as? GitError, gitError.contains("not fully merged") else { return false }
            showError(String(localized: "Nhánh \(ref.name) có commit chưa được merge"), error, actions: [
                ToastAction(title: String(localized: "Vẫn xoá")) { [weak self] in self?.performDeleteBranch(ref, force: true) },
            ])
            return true
        }
    }

    func deleteRemoteBranch(_ ref: GitRef) {
        guard let remote = ref.remoteName else { return }
        let branch = ref.shortBranchName
        confirmation = Confirmation(
            title: String(localized: "Xoá nhánh “\(ref.name)” trên remote?"),
            message: String(localized: "Nhánh \(branch) sẽ bị xoá khỏi \(remote) cho mọi người."),
            confirmTitle: String(localized: "Xoá trên remote"),
            isDestructive: true
        ) { [weak self] in
            guard let self else { return }
            let progress = progressReporter()
            perform(String(localized: "Xoá \(ref.name)"), showsProgress: true, cancellable: true, refresh: [.refs, .status]) { repo in
                try await repo.deleteRemoteBranch(remote: remote, branch: branch, onProgress: progress)
            } onSuccess: { [weak self] in
                self?.toast(.success, String(localized: "Đã xoá \(ref.name)"), actions: [
                    ToastAction(title: String(localized: "Hoàn tác")) { [weak self] in
                        guard let self else { return }
                        let progress = progressReporter()
                        perform(String(localized: "Khôi phục \(ref.name)"), showsProgress: true, refresh: [.refs]) { repo in
                            try await repo.pushCommit(ref.target, remote: remote, branch: branch, onProgress: progress)
                        }
                    },
                ])
            } onError: { [weak self] error in
                self?.handleGitHubAuthError(error, operation: String(localized: "Xoá \(ref.name)")) ?? false
            }
        }
    }

    func renameBranch(_ old: String, to new: String) {
        perform(String(localized: "Đổi tên nhánh")) { repo in
            try await repo.renameBranch(old, to: new)
        } onSuccess: { [weak self] in
            self?.toast(.success, String(localized: "Đã đổi tên \(old) → \(new)"), actions: [
                ToastAction(title: String(localized: "Hoàn tác")) { [weak self] in
                    self?.perform(String(localized: "Đổi tên nhánh")) { repo in try await repo.renameBranch(new, to: old) }
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
            toast(.warning, String(localized: "Cần đứng trên một nhánh để merge"))
            return
        }
        let previousHead = headOID
        perform(String(localized: "Merge \(label) vào \(current)")) { repo in
            try await repo.merge(refName)
        } onSuccess: { [weak self] in
            self?.toast(.success, String(localized: "Đã merge \(label) vào \(current)"), actions: previousHead.map { head in
                [ToastAction(title: String(localized: "Hoàn tác")) { [weak self] in
                    self?.perform(String(localized: "Hoàn tác merge")) { repo in try await repo.resetKeepingLocalChanges(to: head) }
                }]
            } ?? [])
        } onError: { [weak self] error in
            self?.handleConflictError(error, operation: "Merge") ?? false
        }
    }

    /// Drag branch `source` onto `target` then choose "Merge into": check out target (if needed) and merge.
    func merge(_ source: GitRef, into target: GitRef) {
        if target.name == currentBranch {
            merge(source.name, label: source.name)
            return
        }
        let previousHead = status.head
        perform(String(localized: "Merge \(source.name) vào \(target.name)")) { repo in
            try await repo.switchTo(branch: target.name)
            try await repo.merge(source.name)
        } onSuccess: { [weak self] in
            self?.toast(.success, String(localized: "Đã merge \(source.name) vào \(target.name)"), actions: [
                ToastAction(title: String(localized: "Quay lại \(previousHead.branchName ?? "HEAD cũ")")) { [weak self] in self?.restoreHead(previousHead) },
            ])
        } onError: { [weak self] error in
            self?.handleConflictError(error, operation: "Merge") ?? false
        }
    }

    func rebaseCurrent(onto refName: String, label: String) {
        guard let current = currentBranch else {
            toast(.warning, String(localized: "Cần đứng trên một nhánh để rebase"))
            return
        }
        rebase(branch: current, onto: refName, label: label, switches: false)
    }

    func rebase(branch: String, onto refName: String, label: String, switches: Bool = true) {
        confirmation = Confirmation(
            title: String(localized: "Rebase \(branch) lên \(label)?"),
            message: String(localized: "Các commit riêng của \(branch) sẽ được viết lại lên trên \(label). Tránh rebase nhánh đã push mà người khác đang dùng."),
            confirmTitle: "Rebase"
        ) { [weak self] in
            guard let self else { return }
            let previousHead = refs.first { $0.kind == .localBranch && $0.name == branch }?.target
            perform(String(localized: "Rebase \(branch) lên \(label)")) { repo in
                try await repo.rebase(onto: refName, branch: switches ? branch : nil)
            } onSuccess: { [weak self] in
                self?.toast(.success, String(localized: "Đã rebase \(branch) lên \(label)"), actions: previousHead.map { head in
                    [ToastAction(title: String(localized: "Hoàn tác")) { [weak self] in
                        self?.perform(String(localized: "Hoàn tác rebase")) { repo in
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
            self?.toast(.success, String(localized: "Đã cherry-pick “\(commit.subject)”"), actions: previousHead.map { head in
                [ToastAction(title: String(localized: "Hoàn tác")) { [weak self] in
                    self?.perform(String(localized: "Hoàn tác cherry-pick")) { repo in try await repo.resetKeepingLocalChanges(to: head) }
                }]
            } ?? [])
        } onError: { [weak self] error in
            self?.handleConflictError(error, operation: "Cherry-pick") ?? false
        }
    }

    /// Ask first like GitKraken ("Do you want to immediately commit the revert?"): revert & commit right away, or only stage
    /// the reverse changes so they can be reviewed / edited and committed later.
    func revert(_ commit: Commit) {
        var message = String(localized: "Tạo một commit mới trên \(currentBranch ?? "HEAD") đảo ngược thay đổi của \(commit.shortSHA). Lịch sử cũ giữ nguyên.")
        if commit.isMerge, let firstParent = commit.parents.first {
            message += String(localized: "\n\nĐây là merge commit: thay đổi được đảo ngược so với parent đầu tiên (\(String(firstParent.prefix(7)))).")
        }
        message += String(localized: "\n\n“Revert, chưa commit” chỉ stage thay đổi đảo ngược để bạn xem lại hoặc sửa trước khi tự commit.")
        confirmation = Confirmation(
            title: "Revert commit “\(commit.subject)”?",
            message: message,
            confirmTitle: "Revert & commit",
            action: { [weak self] in self?.performRevert(commit, commitImmediately: true) },
            secondaryTitle: String(localized: "Revert, chưa commit"),
            secondaryAction: { [weak self] in self?.performRevert(commit, commitImmediately: false) }
        )
    }

    private func performRevert(_ commit: Commit, commitImmediately: Bool) {
        let mainline = commit.isMerge ? 1 : nil
        guard commitImmediately else {
            // `revert --no-commit` folds already staged changes into the revert, and "Undo" (revert --abort) would delete them
            // too — blocked exactly like git blocks "Revert & commit" on a dirty index.
            guard status.staged.isEmpty else {
                toast(.warning, String(localized: "Revert bị chặn vì có thay đổi đã stage"),
                      message: String(localized: "Commit hoặc stash chúng trước, nếu không chúng sẽ lẫn vào commit revert."),
                      actions: [ToastAction(title: String(localized: "Stash thay đổi")) { [weak self] in self?.quickStash() }])
                return
            }
            perform(String(localized: "Revert \(commit.shortSHA) (chưa commit)")) { repo in
                try await repo.revert(commit.id, mainline: mainline, commit: false)
            } onSuccess: { [weak self] in
                guard let self else { return }
                // "Reverting" banner + the compose box prefilled with the MERGE_MSG message (after the refresh).
                select(.workingTree, reveal: true)
                toast(.success, String(localized: "Đã revert “\(commit.subject)” — chưa commit"), message: nil, actions: [
                    ToastAction(title: String(localized: "Hoàn tác")) { [weak self] in
                        self?.perform(String(localized: "Hoàn tác revert")) { repo in try await repo.abort(.reverting) }
                    },
                ])
            } onError: { [weak self] error in
                // The commit was already reverted beforehand: the core already cancelled the "Reverting" state, just report it.
                if case RepositoryError.nothingToRevert = error {
                    self?.toast(.info, String(localized: "Commit này đã được đảo ngược, không có gì để revert"))
                    return true
                }
                return self?.handleConflictError(error, operation: "Revert") ?? false
            }
            return
        }
        let previousHead = headOID
        perform("Revert \(commit.shortSHA)") { repo in
            try await repo.revert(commit.id, mainline: mainline)
        } onSuccess: { [weak self] in
            self?.toast(.success, String(localized: "Đã tạo commit revert “\(commit.subject)”"), actions: previousHead.map { head in
                [ToastAction(title: String(localized: "Hoàn tác")) { [weak self] in
                    self?.perform(String(localized: "Hoàn tác revert")) { repo in try await repo.resetKeepingLocalChanges(to: head) }
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
                self?.toast(.success, String(localized: "Đã reset \(target) về \(commit.shortSHA)"), actions: previousHead.map { head in
                    [ToastAction(title: String(localized: "Hoàn tác")) { [weak self] in
                        self?.perform(String(localized: "Hoàn tác reset")) { repo in try await repo.reset(to: head, mode: mode == .hard ? .hard : .soft) }
                    }]
                } ?? [])
            }
        }
        switch mode {
        case .hard:
            confirmation = Confirmation(
                title: String(localized: "Hard reset \(target) về \(commit.shortSHA)?"),
                message: String(localized: "Mọi thay đổi chưa commit sẽ MẤT VĨNH VIỄN. Các commit sau \(commit.shortSHA) sẽ không còn trên nhánh (vẫn hoàn tác được ngay sau đó)."),
                confirmTitle: String(localized: "Hard reset"),
                isDestructive: true,
                action: run
            )
        case .soft, .mixed:
            run()
        }
    }

    func handleConflictError(_ error: any Error, operation name: String) -> Bool {
        guard let gitError = error as? GitError else { return false }
        if gitError.contains("CONFLICT") || gitError.contains("conflict") || gitError.contains("Resolve all conflicts") {
            toast(.warning, String(localized: "\(name) gặp xung đột"), message: String(localized: "Mở các file xung đột ở panel bên phải để chọn bản giữ lại, rồi bấm “Tiếp tục”."),
                  tag: "conflict")
            select(.workingTree, reveal: true)
            return true
        }
        if gitError.contains("would be overwritten") || gitError.contains("Please commit your changes or stash them") {
            showError(String(localized: "\(name) bị chặn vì có thay đổi chưa commit"), error, actions: [
                ToastAction(title: String(localized: "Stash thay đổi")) { [weak self] in self?.quickStash() },
            ])
            return true
        }
        return false
    }

    // MARK: - In-flight operations (merge / rebase / cherry-pick)

    func continueOperation() {
        guard let operation else { return }
        guard status.conflicts.isEmpty else {
            toast(.warning, String(localized: "Còn \(status.conflicts.count) file xung đột chưa giải quyết"))
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
        // Mid revert with a prefilled commit box and staged changes: commit straight away (`--cleanup=whitespace`), like the
        // "Finish revert" button — `revert --continue` always uses `--cleanup=strip`, which would drop every line starting
        // with "#" (#123, #hotfix…).
        if operation == .reverting, hasCommitMessage, !status.staged.isEmpty {
            commit()
            return
        }
        // The compose box was prefilled from MERGE_MSG and the user then edited it: `revert --continue` must use the edited version.
        let editedMessage: String?
        if operation == .reverting, hasCommitMessage, let prefilled = prefilledCommitMessage,
           commitSummary != prefilled.summary || commitBody != prefilled.body {
            editedMessage = composedCommitMessage
        } else {
            editedMessage = nil
        }
        perform(String(localized: "Tiếp tục \(operation.shortName)")) { repo in
            if let editedMessage { try repo.setPendingCommitMessage(editedMessage) }
            try await repo.continueOperation(operation)
        } onSuccess: { [weak self] in
            guard let self else { return }
            if editedMessage != nil {
                commitSummary = ""
                commitBody = ""
            }
            toast(.success, String(localized: "Đã tiếp tục"))
        } onError: { [weak self] error in
            self?.handleConflictError(error, operation: operation.title) ?? false
        }
    }

    func abortOperation() {
        guard let operation else { return }
        confirmation = Confirmation(
            title: String(localized: "Huỷ \(operation.shortName)?"),
            message: String(localized: "Repository sẽ quay về trạng thái trước khi bắt đầu \(operation.shortName)."),
            confirmTitle: String(localized: "Huỷ \(operation.shortName)"),
            isDestructive: true
        ) { [weak self] in
            self?.perform(String(localized: "Huỷ \(operation.shortName)")) { repo in
                try await repo.abort(operation)
            } onSuccess: { [weak self] in
                self?.commitSummary = ""
                self?.commitBody = ""
                self?.toast(.success, String(localized: "Đã huỷ \(operation.shortName)"))
            }
        }
    }

    func skipOperation() {
        guard let operation, operation.canSkip else { return }
        perform(String(localized: "Bỏ qua commit hiện tại")) { repo in
            try await repo.skip(operation)
        } onError: { [weak self] error in
            self?.handleConflictError(error, operation: operation.title) ?? false
        }
    }

    // MARK: - Remote

    func fetch() {
        guard !remotes.isEmpty else {
            toast(.info, String(localized: "Repository chưa có remote nào"), actions: [
                ToastAction(title: String(localized: "Thêm remote")) { [weak self] in self?.sheet = .addRemote },
            ])
            return
        }
        let progress = progressReporter()
        perform("Fetch", showsProgress: true, cancellable: true, refresh: [.refs, .status]) { repo in
            try await repo.fetch(remote: nil, prune: Prefs.fetchPruneValue, onProgress: progress)
        } onSuccess: { [weak self] in
            self?.lastFetch = Date()
            self?.toast(.success, String(localized: "Đã fetch xong"))
        } onError: { [weak self] error in
            self?.handleGitHubAuthError(error, operation: "Fetch") ?? false
        }
    }

    /// "Fetch everything from remote" (the bar shown when the repo is missing branches / history): a remote tracking only a few
    /// branches gets an all-branches refspec added (keeping the old ones), a shallow clone gets its old commits, then fetch so branches like `main` show up.
    func completeHistory() {
        guard !remotes.isEmpty else { return }
        let gaps = extras.historyGaps
        let source = defaultRemote
        let progress = progressReporter()
        perform(String(localized: "Fetch đầy đủ từ remote"), showsProgress: true, cancellable: true, refresh: .all) { repo in
            for remote in gaps.narrowRemotes { try await repo.trackAllBranches(remote: remote) }
            if gaps.shallow, let source { try await repo.unshallow(remote: source, onProgress: progress) }
            try await repo.fetch(remote: nil, prune: Prefs.fetchPruneValue, onProgress: progress)
        } onSuccess: { [weak self] in
            self?.lastFetch = Date()
            self?.toast(.success, String(localized: "Đã lấy đủ nhánh và lịch sử từ remote"))
        } onError: { [weak self] error in
            self?.handleGitHubAuthError(error, operation: String(localized: "Fetch đầy đủ từ remote")) ?? false
        }
    }

    /// Pull the current branch; `next` runs after a pull that didn't fail (used by "Pull then push").
    func pull(mode: PullMode? = nil, then next: (() -> Void)? = nil) {
        guard let branch = currentBranchRef else {
            toast(.warning, String(localized: "Cần đứng trên một nhánh để pull"))
            return
        }
        guard branch.upstream != nil, !branch.upstreamGone else {
            toast(.warning, String(localized: "Nhánh \(branch.name) chưa có upstream trên remote"), actions: [
                ToastAction(title: String(localized: "Push lên remote")) { [weak self] in self?.push() },
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
                toast(.success, String(localized: "Đã pull về \(branch.name)"), actions: [
                    ToastAction(title: String(localized: "Hoàn tác")) { [weak self] in
                        self?.perform(String(localized: "Hoàn tác pull")) { repo in try await repo.resetKeepingLocalChanges(to: previousHead) }
                    },
                ])
            } else {
                toast(.success, String(localized: "\(branch.name) đã mới nhất"))
            }
            next?()
        } onError: { [weak self] error in
            guard let self, let gitError = error as? GitError else { return false }
            if handleGitHubAuthError(error, operation: "Pull") { return true }
            if gitError.contains("Not possible to fast-forward") || gitError.contains("divergent") {
                showError(String(localized: "Nhánh local và remote đã diverge"), error, actions: [
                    ToastAction(title: "Pull (merge)") { [weak self] in self?.pull(mode: .merge) },
                    ToastAction(title: "Pull (rebase)") { [weak self] in self?.pull(mode: .rebase) },
                ])
                return true
            }
            return handleConflictError(error, operation: "Pull")
        }
    }

    /// Sync the current branch: pull (using the configured style) then push if the pull didn't fail — "Pull then push" when a push
    /// was rejected, and the "Sync" item in the Pull menu. With no upstream it only pushes (asking for the remote and setting the upstream).
    func sync() {
        guard let branch = currentBranchRef, branch.upstream != nil, !branch.upstreamGone else {
            push()
            return
        }
        pull { [weak self] in self?.push() }
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
            toast(.warning, String(localized: "Cần đứng trên một nhánh để push"))
            return
        }
        pushBranch(branch, force: force)
    }

    func pushBranch(_ branch: GitRef, force: Bool = false) {
        guard !remotes.isEmpty else {
            toast(.info, String(localized: "Repository chưa có remote nào"), actions: [
                ToastAction(title: String(localized: "Thêm remote")) { [weak self] in self?.sheet = .addRemote },
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
            self?.toast(.success, String(localized: "Đã push \(request.localBranch) → \(request.remote)/\(request.remoteBranch)"))
        } onError: { [weak self] error in
            guard let self, let gitError = error as? GitError else { return false }
            if handleGitHubAuthError(error, operation: "Push") { return true }
            if gitError.contains("[rejected]") || gitError.contains("non-fast-forward") || gitError.contains("fetch first") {
                var forced = request
                forced.force = true
                showError(String(localized: "Push bị từ chối — remote có commit mà máy bạn chưa có"), error, actions: [
                    ToastAction(title: String(localized: "Pull rồi Push")) { [weak self] in self?.sync() },
                    ToastAction(title: String(localized: "Pull trước")) { [weak self] in self?.pull() },
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
            message: String(localized: "Ghi đè \(request.remote)/\(request.remoteBranch) bằng bản trên máy bạn (--force-with-lease: sẽ dừng nếu remote có commit mới mà bạn chưa fetch)."),
            confirmTitle: "Force push",
            isDestructive: true
        ) { [weak self] in
            self?.performPush(request)
        }
    }

    /// Push a local branch to a specific remote branch (dragging a local branch onto a remote branch).
    func push(_ local: GitRef, to remoteRef: GitRef) {
        guard let remote = remoteRef.remoteName else { return }
        performPush(PushRequest(localBranch: local.name, remote: remote, remoteBranch: remoteRef.shortBranchName,
                                setUpstream: local.upstream == nil, force: false))
    }

    func addRemote(name: String, url: String) {
        perform(String(localized: "Thêm remote \(name)"), refresh: [.refs]) { repo in
            try await repo.addRemote(name: name, url: url)
        } onSuccess: { [weak self] in
            self?.toast(.success, String(localized: "Đã thêm remote \(name)"), actions: [
                ToastAction(title: "Fetch ngay") { [weak self] in self?.fetch() },
            ])
        }
    }

    func removeRemote(_ remote: Remote) {
        confirmation = Confirmation(
            title: String(localized: "Xoá remote “\(remote.name)”?"),
            message: String(localized: "Chỉ xoá cấu hình remote trên máy bạn (\(remote.fetchURL))."),
            confirmTitle: String(localized: "Xoá remote"),
            isDestructive: true
        ) { [weak self] in
            self?.perform(String(localized: "Xoá remote \(remote.name)"), refresh: [.refs]) { repo in
                try await repo.removeRemote(name: remote.name)
            } onSuccess: { [weak self] in
                self?.toast(.success, String(localized: "Đã xoá remote \(remote.name)"), actions: [
                    ToastAction(title: String(localized: "Hoàn tác")) { [weak self] in self?.addRemote(name: remote.name, url: remote.fetchURL) },
                ])
            }
        }
    }

    // MARK: - Stash

    func beginStash() {
        guard !status.isClean else {
            toast(.info, String(localized: "Không có thay đổi nào để stash"))
            return
        }
        sheet = .stash
    }

    /// The toolbar's Stash button: stash every change (including new files) immediately.
    func quickStash() {
        guard !status.isClean else {
            toast(.info, String(localized: "Không có thay đổi nào để stash"))
            return
        }
        stash(message: "", includeUntracked: true)
    }

    func stash(message: String, includeUntracked: Bool) {
        perform("Stash") { repo in
            try await repo.stashPush(message: message.isEmpty ? nil : message, includeUntracked: includeUntracked)
        } onSuccess: { [weak self] in
            self?.toast(.success, String(localized: "Đã stash thay đổi"), actions: [
                ToastAction(title: String(localized: "Hoàn tác")) { [weak self] in self?.popLatestStash() },
            ])
        }
    }

    func applyStash(_ stash: Stash) {
        perform("Apply stash") { repo in
            try await repo.stashApply(stash.selector)
        } onSuccess: { [weak self] in
            self?.toast(.success, String(localized: "Đã apply stash “\(stash.displayMessage)”"))
        } onError: { [weak self] error in
            self?.handleConflictError(error, operation: "Apply stash") ?? false
        }
    }

    func popStash(_ stash: Stash) {
        perform("Pop stash") { repo in
            try await repo.stashPop(stash.selector)
        } onSuccess: { [weak self] in
            self?.toast(.success, String(localized: "Đã pop thay đổi từ stash"))
        } onError: { [weak self] error in
            guard let self else { return false }
            if handleConflictError(error, operation: "Pop stash") {
                toast(.info, String(localized: "Stash vẫn được giữ lại vì có xung đột"))
                return true
            }
            return false
        }
    }

    func popLatestStash() {
        guard let latest = stashes.first else {
            toast(.info, String(localized: "Không có stash nào"))
            return
        }
        popStash(latest)
    }

    func dropStash(_ stash: Stash) {
        confirmation = Confirmation(
            title: String(localized: "Xoá stash “\(stash.displayMessage)”?"),
            message: String(localized: "Có thể bấm “Hoàn tác” ngay sau đó."),
            confirmTitle: String(localized: "Xoá stash"),
            isDestructive: true
        ) { [weak self] in
            self?.perform(String(localized: "Xoá stash")) { repo in
                try await repo.stashDrop(stash.selector)
            } onSuccess: { [weak self] in
                self?.toast(.success, String(localized: "Đã xoá stash"), actions: [
                    ToastAction(title: String(localized: "Hoàn tác")) { [weak self] in
                        self?.perform(String(localized: "Khôi phục stash")) { repo in try await repo.stashStore(sha: stash.sha, message: stash.message) }
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
        perform(String(localized: "Tạo tag \(name)"), showsProgress: pushToRemote, refresh: [.refs]) { repo in
            try await repo.createTag(name, at: sha, message: message)
            if pushToRemote, let remote { try await repo.pushTag(remote: remote, tag: name, onProgress: progress) }
        } onSuccess: { [weak self] in
            self?.toast(.success, pushToRemote ? String(localized: "Đã tạo và push tag \(name)") : String(localized: "Đã tạo tag \(name)"), actions: pushToRemote ? [] : [
                ToastAction(title: String(localized: "Hoàn tác")) { [weak self] in
                    self?.perform(String(localized: "Xoá tag \(name)"), refresh: [.refs]) { repo in try await repo.deleteTag(name) }
                },
            ])
        } onError: { [weak self] error in
            self?.handleGitHubAuthError(error, operation: "Push tag \(name)") ?? false
        }
    }

    func deleteTag(_ ref: GitRef) {
        confirmation = Confirmation(
            title: String(localized: "Xoá tag “\(ref.name)”?"),
            message: String(localized: "Chỉ xoá tag trên máy bạn. Có thể bấm “Hoàn tác” ngay sau đó."),
            confirmTitle: String(localized: "Xoá tag"),
            isDestructive: true
        ) { [weak self] in
            self?.perform(String(localized: "Xoá tag \(ref.name)"), refresh: [.refs]) { repo in
                try await repo.deleteTag(ref.name)
            } onSuccess: { [weak self] in
                self?.toast(.success, String(localized: "Đã xoá tag \(ref.name)"), actions: [
                    ToastAction(title: String(localized: "Hoàn tác")) { [weak self] in
                        self?.perform(String(localized: "Khôi phục tag"), refresh: [.refs]) { repo in try await repo.updateRef(ref.fullName, to: ref.objectName) }
                    },
                ])
            }
        }
    }

    func pushTag(_ ref: GitRef) {
        guard let remote = defaultRemote else {
            toast(.info, String(localized: "Repository chưa có remote nào"))
            return
        }
        let progress = progressReporter()
        perform("Push tag \(ref.name)", showsProgress: true, cancellable: true, refresh: [.refs]) { repo in
            try await repo.pushTag(remote: remote, tag: ref.name, onProgress: progress)
        } onSuccess: { [weak self] in
            self?.toast(.success, String(localized: "Đã push tag \(ref.name) lên \(remote)"))
        } onError: { [weak self] error in
            self?.handleGitHubAuthError(error, operation: "Push tag \(ref.name)") ?? false
        }
    }

    func deleteRemoteTag(_ ref: GitRef) {
        guard let remote = defaultRemote else { return }
        confirmation = Confirmation(
            title: String(localized: "Xoá tag “\(ref.name)” trên \(remote)?"),
            message: String(localized: "Tag sẽ bị xoá khỏi remote cho mọi người; tag trên máy bạn vẫn giữ nguyên."),
            confirmTitle: String(localized: "Xoá trên remote"),
            isDestructive: true
        ) { [weak self] in
            self?.perform(String(localized: "Xoá tag trên remote"), showsProgress: true, refresh: [.refs]) { repo in
                try await repo.deleteRemoteTag(remote: remote, tag: ref.name)
            } onSuccess: { [weak self] in
                self?.toast(.success, String(localized: "Đã xoá tag \(ref.name) trên \(remote)"))
            }
        }
    }

    // MARK: - External applications

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
        toast(.info, String(localized: "Đã sao chép \(label)"))
    }

    /// A commit's web address on GitHub / GitLab / Bitbucket (when the remote is one of those).
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

    // MARK: - Context menu

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
            .action(String(localized: "Tạo nhánh tại đây…"), systemImage: "arrow.triangle.branch") { [weak self] in self?.beginCreateBranch(at: commit) },
            .action(String(localized: "Tạo tag tại đây…"), systemImage: "tag") { [weak self] in self?.beginCreateTag(at: commit) },
            .action(String(localized: "Checkout commit này"), systemImage: "arrow.uturn.right", enabled: !isHead) { [weak self] in
                self?.checkoutDetached(commit.id, label: "commit \(commit.shortSHA)")
            },
            .separator,
            .action(String(localized: "Cherry-pick vào \(branchLabel)"), systemImage: "leaf", enabled: !isHead) { [weak self] in self?.cherryPick(commit) },
            .action(String(localized: "Revert commit này…"), systemImage: "arrow.uturn.backward", enabled: headOID != nil) { [weak self] in self?.revert(commit) },
            .submenu(String(localized: "Reset \(branchLabel) về đây"), systemImage: "clock.arrow.circlepath", items: [
                .action(String(localized: "Soft — giữ mọi thay đổi ở trạng thái đã stage")) { [weak self] in self?.reset(to: commit, mode: .soft) },
                .action(String(localized: "Mixed — giữ thay đổi, bỏ stage")) { [weak self] in self?.reset(to: commit, mode: .mixed) },
                .action(String(localized: "Hard — bỏ mọi thay đổi"), destructive: true) { [weak self] in self?.reset(to: commit, mode: .hard) },
            ]),
            .action(String(localized: "Interactive rebase \(branchLabel) từ đây…"), systemImage: "list.bullet.indent",
                    enabled: canInteractiveRebase(from: commit)) { [weak self] in self?.beginInteractiveRebase(from: commit) },
            .separator,
            .action(String(localized: "Sửa message commit…"), systemImage: "pencil", enabled: canRewrite(commit)) { [weak self] in
                self?.beginReword(commit)
            },
            .submenu(String(localized: "Đổi thứ tự"), systemImage: "arrow.up.arrow.down", items: [
                .action(String(localized: "Đưa lên (sau commit mới hơn)"), systemImage: "arrow.up", enabled: canRewrite(commit) && !isHead) { [weak self] in
                    self?.move(commit, up: true)
                },
                .action(String(localized: "Đưa xuống (trước commit cũ hơn)"), systemImage: "arrow.down", enabled: canRewrite(commit)) { [weak self] in
                    self?.move(commit, up: false)
                },
            ]),
            .action(String(localized: "Xoá commit này…"), systemImage: "trash", destructive: true, enabled: canRewrite(commit)) { [weak self] in
                self?.confirmDrop(commit)
            },
            .separator,
            .action(String(localized: "Sao chép SHA"), systemImage: "number") { [weak self] in self?.copy(commit.id, label: "SHA") },
            .action(String(localized: "Sao chép message"), systemImage: "doc.on.doc") { [weak self] in self?.copy(commit.subject, label: "message") },
            .action(String(localized: "Sao chép patch"), systemImage: "doc.plaintext") { [weak self] in self?.copyPatch(commit) },
        ]
        if let url = webURL(forCommit: commit.id) {
            items.append(.separator)
            items.append(.action(String(localized: "Mở trên web"), systemImage: "safari") { NSWorkspace.shared.open(url) })
            items.append(.action(String(localized: "Sao chép link commit"), systemImage: "link") { [weak self] in
                self?.copy(url.absoluteString, label: "link")
            })
        }
        return items
    }

    func workingTreeMenu() -> [MenuItemSpec] {
        [
            .action(String(localized: "Stage tất cả"), systemImage: "plus.circle", enabled: !status.unstaged.isEmpty) { [weak self] in self?.stageAll() },
            .action(String(localized: "Bỏ stage tất cả"), systemImage: "minus.circle", enabled: !status.staged.isEmpty) { [weak self] in self?.unstageAll() },
            .separator,
            .action(String(localized: "Stash tất cả thay đổi"), systemImage: "archivebox") { [weak self] in self?.quickStash() },
            .action(String(localized: "Stash kèm message…"), systemImage: "square.and.pencil") { [weak self] in self?.beginStash() },
            .separator,
            .action(String(localized: "Huỷ tất cả thay đổi…"), systemImage: "trash", destructive: true, enabled: operation == nil) { [weak self] in
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
                    items.append(.action(String(localized: "Merge \(ref.name) vào \(current)"), systemImage: "arrow.triangle.merge") { [weak self] in
                        self?.merge(ref.name, label: ref.name)
                    })
                    items.append(.action(String(localized: "Rebase \(current) lên \(ref.name)"), systemImage: "arrow.triangle.swap") { [weak self] in
                        self?.rebaseCurrent(onto: ref.name, label: ref.name)
                    })
                    items.append(.action(String(localized: "So sánh với \(current) — \(ref.name) có gì mới"), systemImage: "arrow.left.arrow.right") { [weak self] in
                        self?.compareWithCurrent(ref)
                    })
                }
                items.append(.action("Push \(ref.name)", systemImage: "arrow.up") { [weak self] in self?.pushBranch(ref) })
            }
            if ref.upstream != nil, ref.behind > 0, ref.ahead == 0 {
                items.append(.action("Fast-forward theo \(ref.upstream ?? "")", systemImage: "forward") { [weak self] in self?.fastForward(ref) })
            }
            items.append(.action(String(localized: "Merge từ repository khác vào \(ref.name)…"), systemImage: "arrow.triangle.merge") { [weak self] in
                self?.beginMergeFromRepository(into: ref.name)
            })
            items.append(.separator)
            items.append(.action(String(localized: "Tạo nhánh từ \(ref.name)…"), systemImage: "arrow.triangle.branch") { [weak self] in
                self?.sheet = .createBranch(startPoint: ref.target, label: ref.name)
            })
            items.append(.action(String(localized: "Đổi tên…"), systemImage: "pencil") { [weak self] in self?.sheet = .renameBranch(ref.name) })
            items.append(.action(String(localized: "Xoá nhánh…"), systemImage: "trash", destructive: true, enabled: !isCurrent) { [weak self] in
                self?.deleteBranch(ref)
            })
        case .remoteBranch:
            items.append(.action("Checkout \(ref.shortBranchName)", systemImage: "arrow.uturn.right") { [weak self] in self?.checkout(ref) })
            if let current {
                items.append(.action(String(localized: "Merge \(ref.name) vào \(current)"), systemImage: "arrow.triangle.merge") { [weak self] in
                    self?.merge(ref.name, label: ref.name)
                })
                items.append(.action(String(localized: "Rebase \(current) lên \(ref.name)"), systemImage: "arrow.triangle.swap") { [weak self] in
                    self?.rebaseCurrent(onto: ref.name, label: ref.name)
                })
                items.append(.action(String(localized: "So sánh với \(current) — \(ref.name) có gì mới"), systemImage: "arrow.left.arrow.right") { [weak self] in
                    self?.compareWithCurrent(ref)
                })
            }
            items.append(.separator)
            items.append(.action(String(localized: "Tạo nhánh từ \(ref.name)…"), systemImage: "arrow.triangle.branch") { [weak self] in
                self?.sheet = .createBranch(startPoint: ref.target, label: ref.name)
            })
            items.append(.action(String(localized: "Xoá trên remote…"), systemImage: "trash", destructive: true) { [weak self] in self?.deleteRemoteBranch(ref) })
        case .tag:
            items.append(.action("Checkout tag \(ref.name)", systemImage: "arrow.uturn.right") { [weak self] in self?.checkout(ref) })
            items.append(.action(String(localized: "Push tag lên remote"), systemImage: "arrow.up", enabled: !remotes.isEmpty) { [weak self] in self?.pushTag(ref) })
            items.append(.action(String(localized: "Tạo nhánh từ tag…"), systemImage: "arrow.triangle.branch") { [weak self] in
                self?.sheet = .createBranch(startPoint: ref.target, label: ref.name)
            })
            items.append(.separator)
            items.append(.action(String(localized: "Xoá tag…"), systemImage: "trash", destructive: true) { [weak self] in self?.deleteTag(ref) })
            items.append(.action(String(localized: "Xoá tag trên remote…"), systemImage: "icloud.slash", destructive: true, enabled: !remotes.isEmpty) { [weak self] in
                self?.deleteRemoteTag(ref)
            })
        }
        let pullItems = pullRequestMenuItems(for: ref)
        if !pullItems.isEmpty {
            items.append(.separator)
            items += pullItems
        }
        let flowItems = gitFlowMenuItems(for: ref)
        if !flowItems.isEmpty {
            items.append(.separator)
            items += flowItems
        }
        let filterItems = graphFilterMenuItems(for: ref)
        if !filterItems.isEmpty {
            items.append(.separator)
            items += filterItems
        }
        items.append(.separator)
        items.append(.action(String(localized: "Sao chép tên"), systemImage: "doc.on.doc") { [weak self] in self?.copy(ref.name, label: String(localized: "tên")) })
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
            .action(String(localized: "Apply (giữ stash)"), systemImage: "tray.and.arrow.down") { [weak self] in self?.applyStash(stash) },
            .action(String(localized: "Pop (apply rồi xoá stash)"), systemImage: "tray.and.arrow.up") { [weak self] in self?.popStash(stash) },
            .separator,
            .action(String(localized: "Xoá stash…"), systemImage: "trash", destructive: true) { [weak self] in self?.dropStash(stash) },
        ]
    }

    func fileMenu(_ change: FileChange, source: DiffSource) -> [MenuItemSpec] {
        var items: [MenuItemSpec] = []
        switch source {
        case .unstaged:
            items.append(.action("Stage file", systemImage: "plus.circle") { [weak self] in self?.stage([change]) })
            items.append(.action(String(localized: "Huỷ thay đổi…"), systemImage: "arrow.uturn.backward", destructive: true) { [weak self] in self?.discard([change]) })
            if change.kind == .untracked {
                let ext = (change.path as NSString).pathExtension
                var ignoreItems: [MenuItemSpec] = [
                    .action(String(localized: "Bỏ qua file này")) { [weak self] in self?.ignore(pattern: "/" + change.path) },
                ]
                if !ext.isEmpty {
                    ignoreItems.append(.action(String(localized: "Bỏ qua mọi file *.\(ext)")) { [weak self] in self?.ignore(pattern: "*." + ext) })
                }
                if !change.directory.isEmpty {
                    ignoreItems.append(.action(String(localized: "Bỏ qua thư mục \(change.directory)/")) { [weak self] in self?.ignore(pattern: "/" + change.directory + "/") })
                }
                items.append(.submenu(String(localized: "Thêm vào .gitignore"), systemImage: "eye.slash", items: ignoreItems))
            }
        case .staged:
            items.append(.action(String(localized: "Bỏ stage file"), systemImage: "minus.circle") { [weak self] in self?.unstage([change]) })
        default:
            break
        }
        if !items.isEmpty { items.append(.separator) }
        let fileExists = FileManager.default.fileExists(atPath: repository.root.appendingPathComponent(change.path).path)
        items.append(.action(String(localized: "Mở file"), systemImage: "doc", enabled: fileExists) { [weak self] in self?.openFileInDefaultApp(change.path) })
        items.append(.action(String(localized: "Mở bằng trình soạn thảo"), systemImage: "chevron.left.forwardslash.chevron.right", enabled: fileExists) { [weak self] in
            self?.openInEditor(path: change.path)
        })
        items.append(.action(String(localized: "Hiện trong Finder"), systemImage: "folder", enabled: fileExists) { [weak self] in self?.revealFile(change.path) })
        items.append(.action(String(localized: "Lịch sử file"), systemImage: "clock") { [weak self] in self?.sheet = .fileHistory(change.path) })
        if let blame = blameSheet(for: OpenFile(source: source, change: change)) {
            items.append(.action(String(localized: "Blame — ai sửa từng dòng"), systemImage: "person.text.rectangle") { [weak self] in self?.sheet = blame })
        }
        items.append(.separator)
        items.append(.action(String(localized: "Sao chép đường dẫn"), systemImage: "doc.on.doc") { [weak self] in self?.copy(change.path, label: String(localized: "đường dẫn")) })
        return items
    }

    /// The options shown when dragging branch `source` onto a target branch / remote.
    func dropOptions(_ request: DragRequest) -> [MenuItemSpec] {
        let source = request.source
        var items: [MenuItemSpec] = []
        switch request.target {
        case .ref(let target):
            guard source.fullName != target.fullName else { return [] }
            if target.kind == .localBranch {
                items.append(.action(String(localized: "Merge \(source.name) vào \(target.name)"), systemImage: "arrow.triangle.merge") { [weak self] in
                    self?.merge(source, into: target)
                })
                if source.kind == .localBranch {
                    items.append(.action(String(localized: "Rebase \(source.name) lên \(target.name)"), systemImage: "arrow.triangle.swap") { [weak self] in
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
                    items.append(.action(String(localized: "Push \(source.name) lên \(target.name)"), systemImage: "arrow.up") { [weak self] in
                        self?.push(source, to: target)
                    })
                }
                if let current = currentBranch, source.kind == .localBranch, source.name == current {
                    items.append(.action(String(localized: "Rebase \(current) lên \(target.name)"), systemImage: "arrow.triangle.swap") { [weak self] in
                        self?.rebaseCurrent(onto: target.name, label: target.name)
                    })
                }
            }
            if target.kind == .tag {
                items.append(.action(String(localized: "Không có thao tác khi thả lên tag"), enabled: false) {})
            }
        case .remote(let remote):
            if source.kind == .localBranch {
                items.append(.action(String(localized: "Push \(source.name) lên \(remote.name)"), systemImage: "arrow.up") { [weak self] in
                    self?.performPush(PushRequest(localBranch: source.name, remote: remote.name, remoteBranch: source.name,
                                                  setUpstream: source.upstream == nil, force: false))
                })
            } else if source.kind == .tag {
                items.append(.action(String(localized: "Push tag \(source.name) lên \(remote.name)"), systemImage: "arrow.up") { [weak self] in
                    self?.pushTag(source)
                })
            }
        }
        return items
    }
}
