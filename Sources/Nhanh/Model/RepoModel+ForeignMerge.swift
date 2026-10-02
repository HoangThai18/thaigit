import Foundation
import NhanhCore

/// Một lần merge từ repository khác: nhánh `branch` của `source` (thư mục trên máy hoặc URL) vào nhánh `target` của repo
/// đang mở. Được nhớ theo từng repo để lần sau chỉ cần bấm "Merge lại".
struct ForeignMergeSource: Codable, Hashable, Identifiable {
    var source: String
    var branch: String
    var target: String

    var id: String { [source, branch, target].joined(separator: "\n") }
    var isLocal: Bool { source.hasPrefix("/") }
    /// Tên ngắn của repo nguồn: "/Users/a/du-an-a" → "du-an-a", "git@github.com:cty/b.git" → "b".
    var repositoryName: String { GitRepository.defaultDirectoryName(forCloneURL: source) }
    var label: String { "\(branch) của \(repositoryName)" }
}

extension RepoModel {
    private static let savedSourcesKey = "foreignMergeSources"
    private static let savedSourcesLimit = 5

    /// Nguồn đã merge gần đây của repo này, mới nhất trước.
    var savedForeignMergeSources: [ForeignMergeSource] {
        Self.loadSavedSources()[rootPath] ?? []
    }

    private static func loadSavedSources() -> [String: [ForeignMergeSource]] {
        guard let data = UserDefaults.standard.data(forKey: savedSourcesKey) else { return [:] }
        return (try? JSONDecoder().decode([String: [ForeignMergeSource]].self, from: data)) ?? [:]
    }

    private func rememberForeignMergeSource(_ source: ForeignMergeSource) {
        var all = Self.loadSavedSources()
        var list = all[rootPath] ?? []
        list.removeAll { $0 == source }
        list.insert(source, at: 0)
        all[rootPath] = Array(list.prefix(Self.savedSourcesLimit))
        if let data = try? JSONEncoder().encode(all) { UserDefaults.standard.set(data, forKey: Self.savedSourcesKey) }
    }

    func forgetForeignMergeSource(_ source: ForeignMergeSource) {
        var all = Self.loadSavedSources()
        all[rootPath]?.removeAll { $0 == source }
        if let data = try? JSONEncoder().encode(all) { UserDefaults.standard.set(data, forKey: Self.savedSourcesKey) }
    }

    func beginMergeFromRepository(into target: String? = nil) {
        sheet = .mergeFromRepository(target: target)
    }

    /// Merge nhánh của repository khác vào nhánh đích, không thêm remote. Nhánh đích khác nhánh hiện tại thì checkout
    /// trước (như thả nhánh lên nhánh để merge). Nguồn là thư mục trên máy thì không cần mạng hay đăng nhập.
    func mergeFromRepository(_ request: ForeignMergeSource, allowUnrelatedHistories: Bool = false) {
        rememberForeignMergeSource(request)
        let label = request.label
        let target = request.target
        let previousHead = status.head
        let switches = target != currentBranch
        let previousTarget = switches ? localBranches.first { $0.name == target }?.target : headOID
        var newTarget: String?
        let progress = progressReporter()
        perform("Merge \(label) vào \(target)", showsProgress: true, cancellable: true) { repo in
            if switches { try await repo.switchTo(branch: target) }
            try await repo.mergeBranch(request.branch, fromRepository: request.source,
                                       allowUnrelatedHistories: allowUnrelatedHistories, onProgress: progress)
            newTarget = try? await repo.resolveCommit("HEAD")
        } onSuccess: { [weak self] in
            guard let self else { return }
            let goBack = switches ? [ToastAction(title: "Quay lại \(previousHead.branchName ?? "HEAD cũ")") { [weak self] in
                self?.restoreHead(previousHead)
            }] : []
            if let previousTarget, newTarget == previousTarget {
                toast(.success, "\(target) đã có mọi commit của \(label)", actions: goBack)
                return
            }
            toast(.success, "Đã merge \(label) vào \(target)", actions: previousTarget.map { head in
                [ToastAction(title: "Hoàn tác") { [weak self] in
                    self?.perform("Hoàn tác merge") { repo in try await repo.resetKeepingLocalChanges(to: head) }
                    if switches { self?.restoreHead(previousHead) }
                }]
            } ?? goBack)
        } onError: { [weak self] error in
            guard let self else { return false }
            if let gitError = error as? GitError, gitError.contains("refusing to merge unrelated histories") {
                toast(.warning, "\(request.repositoryName) và \(name) không có commit chung",
                      message: "Thường gặp khi một bên là bản copy code (không clone từ bên kia). Lần đầu vẫn merge được: file có ở cả hai bên mà khác nội dung sẽ thành xung đột để bạn chọn bản giữ lại. Từ lần sau hai bên đã có commit chung nên merge bình thường.",
                      actions: [ToastAction(title: "Vẫn merge") { [weak self] in
                          self?.mergeFromRepository(request, allowUnrelatedHistories: true)
                      }])
                return true
            }
            return handleConflictError(error, operation: "Merge")
        }
    }
}
