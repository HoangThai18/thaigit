import Foundation
import NhanhCore

/// One merge from another repository: branch `branch` of `source` (a local folder or a URL) into branch `target` of the
/// open repo. Remembered per repo so next time only "Merge again" is needed.
struct ForeignMergeSource: Codable, Hashable, Identifiable {
    var source: String
    var branch: String
    var target: String

    var id: String { [source, branch, target].joined(separator: "\n") }
    var isLocal: Bool { source.hasPrefix("/") }
    /// A short name for the source repo: "/Users/a/project-a" → "project-a", "git@github.com:org/b.git" → "b".
    var repositoryName: String { GitRepository.defaultDirectoryName(forCloneURL: source) }
    var label: String { String(localized: "\(branch) của \(repositoryName)") }
}

extension RepoModel {
    private static let savedSourcesKey = "foreignMergeSources"
    private static let savedSourcesLimit = 5

    /// This repo's recently merged sources, newest first.
    var savedForeignMergeSources: [ForeignMergeSource] {
        Self.loadSavedSources()[rootPath] ?? []
    }

    private static func loadSavedSources() -> [String: [ForeignMergeSource]] {
        guard let data = UserDefaults.standard.data(forKey: savedSourcesKey) else { return [:] }
        return (try? JSONDecoder().decode([String: [ForeignMergeSource]].self, from: data)) ?? [:]
    }

    /// Remember a source (stripping "user:password@" from the URL — never store a secret in UserDefaults; next time git asks
    /// again through the credential helper / dialog if it needs to).
    private func rememberForeignMergeSource(_ request: ForeignMergeSource) {
        var source = request
        source.source = GitRepository.anonymizedSource(request.source)
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

    /// Merge another repository's branch into the target branch without adding a remote. The source branch is fetched
    /// FIRST, and only then is the target branch checked out (when it isn't the current one — like dropping a branch
    /// onto another to merge) and merged: a failing source leaves HEAD unchanged; git refusing the merge right
    /// after the checkout goes back to the old HEAD. Cancellable up to the end of the fetch. A local folder
    /// source needs no network and no sign-in. `previousHead`: HEAD before the first attempt (the "Merge anyway"
    /// button passes it back).
    func mergeFromRepository(_ request: ForeignMergeSource, allowUnrelatedHistories: Bool = false, previousHead original: HeadState? = nil) {
        rememberForeignMergeSource(request)
        let label = request.label
        let target = request.target
        let previousHead = original ?? status.head
        let switches = target != currentBranch
        let previousTarget = switches ? localBranches.first { $0.name == target }?.target : headOID
        let leftPrevious = previousHead.branchName != target
        let previousName = previousHead.branchName ?? previousHead.oid.map { String($0.prefix(7)) } ?? String(localized: "HEAD cũ")
        var newTarget: String?
        let progress = progressReporter()
        perform(String(localized: "Merge \(label) vào \(target)"), showsProgress: true, cancellable: true) { [weak self] repo in
            try await repo.fetchForeignBranch(request.branch, fromRepository: request.source, onProgress: progress)
            // From here the checkout + merge always run to completion: stopping `git merge` halfway would leave a half-written index.
            self?.busy?.canCancel = false
            try await repo.mergeFetchedForeignBranch(request.branch, fromRepository: request.source,
                                                     into: switches ? target : nil, allowUnrelatedHistories: allowUnrelatedHistories)
            newTarget = try? await repo.resolveCommit("HEAD")
        } onSuccess: { [weak self] in
            guard let self else { return }
            let goBack = leftPrevious ? [ToastAction(title: String(localized: "Quay lại \(previousName)")) { [weak self] in
                self?.restoreHead(previousHead)
            }] : []
            if let previousTarget, newTarget == previousTarget {
                toast(.success, String(localized: "\(target) đã có mọi commit của \(label)"), actions: goBack)
                return
            }
            toast(.success, String(localized: "Đã merge \(label) vào \(target)"), actions: previousTarget.map { head in
                [ToastAction(title: String(localized: "Hoàn tác")) { [weak self] in
                    self?.perform(String(localized: "Hoàn tác merge")) { repo in try await repo.resetKeepingLocalChanges(to: head) }
                    if leftPrevious { self?.restoreHead(previousHead) }
                }]
            } ?? goBack)
        } onError: { [weak self] error in
            guard let self else { return false }
            // The target branch was checked out but git refused the merge: Thaigit did (or did not) get back to the old HEAD — say so explicitly.
            let failure = error as? ForeignMergeFailure
            let mergeError = failure?.underlying ?? error
            let whereNow = failure.map { failure in
                failure.restoredHead.map { String(localized: "Đã quay lại \($0).") } ?? String(localized: "Chưa quay lại được \(previousName) — vẫn đang ở \(target).")
            }
            if let gitError = mergeError as? GitError, gitError.contains("refusing to merge unrelated histories") {
                toast(.warning, String(localized: "\(request.repositoryName) và \(name) không có commit chung"),
                      message: String(localized: "Thường gặp khi một bên là bản copy code (không clone từ bên kia). Lần đầu vẫn merge được: file có ở cả hai bên mà khác nội dung sẽ thành xung đột để bạn chọn bản giữ lại. Từ lần sau hai bên đã có commit chung nên merge bình thường.")
                          + (whereNow.map { " " + $0 } ?? ""),
                      actions: [ToastAction(title: String(localized: "Vẫn merge")) { [weak self] in
                          self?.mergeFromRepository(request, allowUnrelatedHistories: true, previousHead: previousHead)
                      }])
                return true
            }
            if let whereNow {
                showError(String(localized: "Không merge được \(label) vào \(target). \(whereNow)"), mergeError)
                return true
            }
            return handleConflictError(error, operation: "Merge")
        }
    }
}
