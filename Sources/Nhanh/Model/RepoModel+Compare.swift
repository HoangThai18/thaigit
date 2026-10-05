import Foundation
import NhanhCore

extension RepoModel {
    /// The two graph rows being compared (nil when not comparing, or when one side is outside the loaded range).
    var compareRows: IndexSet? {
        guard case .compare(let from, let to) = selection else { return nil }
        return IndexSet([row(for: .commit(from)), row(for: .commit(to))].compactMap { $0 })
    }

    /// A readable name for one side of the comparison: the branch name (a local branch preferred) or a tag pointing at that
    /// commit, otherwise the commit message (the short SHA is already shown next to it).
    func compareLabel(for sha: String) -> String {
        let pointing = refs.filter { $0.target == sha }
        if let ref = pointing.first(where: { $0.kind == .localBranch }) ?? pointing.first(where: { $0.kind == .remoteBranch })
            ?? pointing.first(where: { $0.kind == .tag }) {
            return ref.name
        }
        if let commit = commit(for: sha) { return commit.subject }
        return String(sha.prefix(7))
    }

    /// Compare branch `ref` with the current branch the "what's new on this branch" way: computed from the point where
    /// the two branches diverged (like `git diff HEAD...ref`), so only `ref`'s own changes show up.
    func compareWithCurrent(_ ref: GitRef) {
        guard let head = headOID else {
            toast(.info, String(localized: "Nhánh hiện tại chưa có commit nào để so sánh"))
            return
        }
        let repo = repository
        let target = ref.target
        Task {
            let base = await repo.mergeBase(head, target) ?? head
            select(.compare(from: base, to: target))
        }
    }
}
