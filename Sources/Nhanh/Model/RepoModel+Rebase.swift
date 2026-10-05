import Foundation
import NhanhCore

extension RepoModel {
    /// The Blame dialog for the file on screen: for a commit's file it blames at that commit, for a file being edited it blames the version on disk.
    /// nil when the file was deleted or comes from a stash (not part of history).
    func blameSheet(for file: OpenFile) -> RepoSheet? {
        guard file.change.kind != .deleted else { return nil }
        switch file.source {
        case .commit(let sha), .compare(_, let sha): return .blame(path: file.change.path, rev: sha)
        case .unstaged, .staged, .conflict: return file.change.kind == .untracked ? nil : .blame(path: file.change.path, rev: nil)
        case .stash: return nil
        }
    }

    /// The commit selected on the graph (nil when the WIP / a stash is selected, or nothing is).
    var selectedCommit: Commit? {
        if case .commit(let sha) = selection { return commit(for: sha) }
        return nil
    }

    /// Whether an interactive rebase can start from `commit`: it is on the current branch and isn't HEAD.
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

    /// Run an interactive rebase plan (old → new) onto `base`. Undo = moving the branch back to exactly the old commit.
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

    // MARK: - Quick actions on one commit (right-click menu, like GitKraken)

    /// Reword / drop / reorder only apply to an ordinary commit (one parent) while on a branch with no operation in flight.
    func canRewrite(_ commit: Commit) -> Bool {
        commit.parents.count == 1 && currentBranch != nil && operation == nil
    }

    func beginReword(_ commit: Commit) {
        guard canRewrite(commit) else { return }
        sheet = .rewordCommit(sha: commit.id, label: commit.shortSHA)
    }

    /// Reword `sha` (rebasing from its parent).
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

    /// Swap with the next (`up`) or previous commit; moving down requires an ordinary parent too (rebase from its grandparent).
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

    /// Read the commits after `base`, build a plan, validate it and run it; when it can't be built or is invalid the reason is reported.
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

    /// The commit as a patch (reappliable with `git am`) on the clipboard.
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
