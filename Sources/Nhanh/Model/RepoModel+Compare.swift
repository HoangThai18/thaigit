import Foundation
import NhanhCore

extension RepoModel {
    /// Hai dòng trên graph đang so sánh (nil nếu không so sánh hoặc một đầu nằm ngoài phần đã tải).
    var compareRows: IndexSet? {
        guard case .compare(let from, let to) = selection else { return nil }
        return IndexSet([row(for: .commit(from)), row(for: .commit(to))].compactMap { $0 })
    }

    /// Tên dễ đọc cho một đầu so sánh: tên nhánh (ưu tiên nhánh local) hoặc tag trỏ vào commit đó, không có thì lời commit
    /// (SHA ngắn đã hiện riêng bên cạnh).
    func compareLabel(for sha: String) -> String {
        let pointing = refs.filter { $0.target == sha }
        if let ref = pointing.first(where: { $0.kind == .localBranch }) ?? pointing.first(where: { $0.kind == .remoteBranch })
            ?? pointing.first(where: { $0.kind == .tag }) {
            return ref.name
        }
        if let commit = commit(for: sha) { return commit.subject }
        return String(sha.prefix(7))
    }

    /// So sánh nhánh `ref` với nhánh hiện tại kiểu "nhánh này có gì mới": tính từ điểm hai nhánh tách nhau (như
    /// `git diff HEAD...ref`), nên chỉ thấy thay đổi của riêng `ref`.
    func compareWithCurrent(_ ref: GitRef) {
        guard let head = headOID else {
            toast(.info, "Nhánh hiện tại chưa có commit nào để so sánh")
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
