import Foundation
import NhanhCore

extension RepoModel {
    /// Hộp Blame cho file đang xem: file của commit thì blame tại commit đó, file đang sửa thì blame bản trên đĩa.
    /// nil khi file đã bị xoá hoặc thuộc stash (không nằm trong lịch sử).
    func blameSheet(for file: OpenFile) -> RepoSheet? {
        guard file.change.kind != .deleted else { return nil }
        switch file.source {
        case .commit(let sha), .compare(_, let sha): return .blame(path: file.change.path, rev: sha)
        case .unstaged, .staged, .conflict: return file.change.kind == .untracked ? nil : .blame(path: file.change.path, rev: nil)
        case .stash: return nil
        }
    }

    /// Commit đang chọn trên graph (nil khi chọn WIP / stash / không chọn gì).
    var selectedCommit: Commit? {
        if case .commit(let sha) = selection { return commit(for: sha) }
        return nil
    }

    /// Có interactive rebase được từ `commit` không: commit nằm trên nhánh hiện tại và không phải HEAD.
    func canInteractiveRebase(from commit: Commit) -> Bool {
        !commit.isWorkingTree && commit.id != headOID && headOID != nil && operation == nil
    }

    func beginInteractiveRebase(from commit: Commit) {
        guard operation == nil else {
            toast(.warning, String(localized: "Đang \(operation?.shortName ?? "dở thao tác") — hãy hoàn tất hoặc huỷ trước"))
            return
        }
        sheet = .interactiveRebase(base: commit.id, label: commit.shortSHA)
    }

    /// Chạy kế hoạch interactive rebase (cũ trước mới sau) lên `base`. Hoàn tác = đưa nhánh về đúng commit cũ.
    func interactiveRebase(base: String, steps: [RebaseStep], doneTitle: String? = nil) {
        let previousHead = headOID
        let branch = currentBranch ?? "HEAD"
        var result = InteractiveRebaseResult.done
        perform("Interactive rebase \(branch)") { repo in
            result = try await repo.interactiveRebase(onto: base, steps: steps)
        } onSuccess: { [weak self] in
            guard let self else { return }
            let undo = previousHead.map { head in
                [ToastAction(title: String(localized: "Hoàn tác")) { [weak self] in
                    self?.perform(String(localized: "Hoàn tác rebase")) { repo in try await repo.resetKeepingLocalChanges(to: head) }
                }]
            } ?? []
            if result == .autostashConflict {
                toast(.warning, String(localized: "Đã rebase \(branch), nhưng trả lại thay đổi chưa commit bị xung đột"),
                      message: String(localized: "Thay đổi của bạn vẫn còn trong stash. Giải xung đột ở panel bên phải, hoặc Hoàn tác."), actions: undo)
            } else {
                toast(.success, doneTitle ?? String(localized: "Đã viết lại \(steps.count) commit trên \(branch)"), actions: undo)
            }
        } onError: { [weak self] error in
            self?.handleConflictError(error, operation: "Rebase") ?? false
        }
    }

    // MARK: - Thao tác nhanh trên một commit (menu chuột phải, như GitKraken)

    /// Sửa message / xoá / đổi chỗ chỉ cho commit thường (một cha) khi đang đứng trên nhánh, không có thao tác dở.
    func canRewrite(_ commit: Commit) -> Bool {
        commit.parents.count == 1 && currentBranch != nil && operation == nil
    }

    func beginReword(_ commit: Commit) {
        guard canRewrite(commit) else { return }
        sheet = .rewordCommit(sha: commit.id, label: commit.shortSHA)
    }

    /// Sửa message của `sha` (rebase từ cha của nó).
    func reword(_ sha: String, message: String) {
        guard let commit = commit(for: sha), let base = commit.parents.first else { return }
        quickRebase(base: base, sha: sha, doneTitle: String(localized: "Đã sửa message commit")) { commits in
            RebasePlan.single(commits, sha: sha, action: .reword, message: message)
        }
    }

    func confirmDrop(_ commit: Commit) {
        guard canRewrite(commit), let base = commit.parents.first else { return }
        let branch = currentBranch ?? "HEAD"
        confirmation = Confirmation(
            title: String(localized: "Xoá commit \(commit.shortSHA)?"),
            message: String(localized: "“\(commit.subject)” sẽ bị bỏ khỏi \(branch), các commit sau nó được viết lại. Có thể hoàn tác ngay sau khi xong."),
            confirmTitle: String(localized: "Xoá commit"),
            isDestructive: true
        ) { [weak self] in
            self?.quickRebase(base: base, sha: commit.id, doneTitle: String(localized: "Đã xoá commit khỏi nhánh")) { commits in
                RebasePlan.single(commits, sha: commit.id, action: .drop)
            }
        }
    }

    /// Đổi chỗ với commit liền sau (`up`) hoặc liền trước; đưa xuống cần cha cũng là commit thường (rebase từ ông của nó).
    func move(_ commit: Commit, up: Bool) {
        guard canRewrite(commit), let parent = commit.parents.first else { return }
        var base = parent
        if !up {
            guard let parentCommit = self.commit(for: parent), parentCommit.parents.count == 1, let grandparent = parentCommit.parents.first else {
                toast(.info, String(localized: "Không có commit thường nào bên dưới để đổi chỗ."))
                return
            }
            base = grandparent
        }
        quickRebase(base: base, sha: commit.id, doneTitle: String(localized: "Đã đổi thứ tự commit")) { commits in
            RebasePlan.swapped(commits, sha: commit.id, up: up)
        }
    }

    /// Đọc các commit sau `base`, dựng kế hoạch, kiểm rồi chạy; không dựng / không hợp lệ được thì báo lý do.
    private func quickRebase(base: String, sha: String, doneTitle: String, plan: @escaping ([Commit]) -> [RebaseStep]?) {
        guard operation == nil else {
            toast(.warning, String(localized: "Đang \(operation?.shortName ?? "dở thao tác") — hãy hoàn tất hoặc huỷ trước"))
            return
        }
        Task { [weak self] in
            guard let self else { return }
            let commits: [Commit]
            do {
                commits = try await repository.rebaseCommits(after: base)
            } catch {
                toast(.warning, String(localized: "Commit này không nằm trên nhánh hiện tại"))
                return
            }
            guard commits.contains(where: { $0.id == sha }) else {
                toast(.warning, String(localized: "Commit này không nằm trên nhánh hiện tại"))
                return
            }
            guard let steps = plan(commits) else {
                toast(.info, String(localized: "Commit này đã mới nhất trên nhánh."))
                return
            }
            if let problem = RebasePlan.problem(steps, original: commits) {
                toast(.warning, problem)
                return
            }
            interactiveRebase(base: base, steps: steps, doneTitle: doneTitle)
        }
    }

    /// Commit dạng patch (áp lại được bằng `git am`) vào clipboard.
    func copyPatch(_ commit: Commit) {
        Task { [weak self] in
            guard let self else { return }
            do {
                copy(try await repository.commitPatch(commit.id), label: "patch")
            } catch {
                toast(.error, String(localized: "Không đọc được patch của commit"))
            }
        }
    }
}
