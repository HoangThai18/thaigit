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
            toast(.warning, "Đang \(operation?.shortName ?? "dở thao tác") — hãy hoàn tất hoặc huỷ trước")
            return
        }
        sheet = .interactiveRebase(base: commit.id, label: commit.shortSHA)
    }

    /// Chạy kế hoạch interactive rebase (cũ trước mới sau) lên `base`. Hoàn tác = đưa nhánh về đúng commit cũ.
    func interactiveRebase(base: String, steps: [RebaseStep]) {
        let previousHead = headOID
        let branch = currentBranch ?? "HEAD"
        var result = InteractiveRebaseResult.done
        perform("Interactive rebase \(branch)") { repo in
            result = try await repo.interactiveRebase(onto: base, steps: steps)
        } onSuccess: { [weak self] in
            guard let self else { return }
            let undo = previousHead.map { head in
                [ToastAction(title: "Hoàn tác") { [weak self] in
                    self?.perform("Hoàn tác rebase") { repo in try await repo.resetKeepingLocalChanges(to: head) }
                }]
            } ?? []
            if result == .autostashConflict {
                toast(.warning, "Đã rebase \(branch), nhưng trả lại thay đổi chưa commit bị xung đột",
                      message: "Thay đổi của bạn vẫn còn trong stash. Giải xung đột ở panel bên phải, hoặc Hoàn tác.", actions: undo)
            } else {
                toast(.success, "Đã viết lại \(steps.count) commit trên \(branch)", actions: undo)
            }
        } onError: { [weak self] error in
            self?.handleConflictError(error, operation: "Rebase") ?? false
        }
    }
}
