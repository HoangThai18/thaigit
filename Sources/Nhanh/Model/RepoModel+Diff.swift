import AppKit
import NhanhCore
import SwiftUI

/// The result of loading a diff on a background task (Sendable data only; images are created on main).
nonisolated enum LoadedDiff: Sendable {
    case text(DiffPresentation)
    case binary(FileDiff?, before: Data?, after: Data?, isImage: Bool)
    case tooLarge(FileDiff)
    case conflict(ConflictFile, ConflictEntry)
    case conflictWithoutMarkers(ConflictEntry)
    case conflictNotUTF8(ConflictEntry)
    case message(String)
}

enum HunkAction {
    case stage
    case unstage
    case discard

    var reverse: Bool { self != .stage }
    var cached: Bool { self != .discard }
}

extension RepoModel {
    // MARK: - Open / close a file

    func openDiff(_ change: FileChange, source: DiffSource) {
        let file = OpenFile(source: source, change: change)
        editorWillLeave(to: file)
        if openFile != file {
            openFile = file
            lineSelection = [:]
            diffState = .loading
        }
        openFilePosition = max(0, siblingFiles(of: source)?.firstIndex { $0.path == change.path } ?? 0)
        loadDiff()
    }

    /// The list containing the file for `source` (unstaged / staged / conflicted); `nil` for a commit's or a stash's diff.
    func siblingFiles(of source: DiffSource) -> [FileChange]? {
        switch source {
        case .unstaged: return status.unstaged
        case .staged: return status.staged
        case .conflict: return status.conflicts.map(\.asChange)
        default: return nil
        }
    }

    /// The position (from 1) and total count of files in the open file's list — for the ↑ / ↓ "2/5" button above the diff.
    var openFilePlace: (index: Int, total: Int)? {
        guard let file = openFile, let files = siblingFiles(of: file.source),
              let index = files.firstIndex(where: { $0.path == file.change.path }) else { return nil }
        return (index + 1, files.count)
    }

    /// Open the next (`step` = 1) / previous (−1) file in the same list as the open one; at either end nothing happens.
    func stepOpenFile(_ step: Int) {
        guard let file = openFile, let files = siblingFiles(of: file.source),
              let index = files.firstIndex(where: { $0.path == file.change.path }),
              files.indices.contains(index + step) else { return }
        openDiff(files[index + step], source: file.source)
    }

    /// The open file just left its list (staged / unstaged / discarded / resolved): open whatever now sits at that spot so
    /// reviewing continues without another click. Returns `false` when the list is now empty.
    private func openNeighbour(in source: DiffSource) -> Bool {
        guard let files = siblingFiles(of: source), !files.isEmpty else { return false }
        openDiff(files[min(openFilePosition, files.count - 1)], source: source)
        return true
    }

    func openConflict(_ entry: ConflictEntry) {
        openDiff(entry.asChange, source: .conflict)
    }

    func closeFile() {
        editorWillLeave(to: nil)
        diffTask?.cancel()
        openFile = nil
        diffState = .idle
        lineSelection = [:]
        selectedUnstaged = []
        selectedStaged = []
    }

    func showDiffAnyway() {
        guard case .tooLarge(let diff) = diffState else { return }
        diffState = .loading
        diffTask = Task {
            let presentation = await DiffPresentation.make(diff)
            guard !Task.isCancelled else { return }
            diffState = .text(presentation)
        }
    }

    func loadDiff(silently: Bool = false) {
        diffTask?.cancel()
        guard let file = openFile else {
            diffState = .idle
            return
        }
        if !silently { diffState = .loading }
        let repo = repository
        let context = Prefs.diffContextValue
        let ignoreWhitespace = Prefs.diffIgnoreWhitespaceValue
        var commitParent: String?
        if case .commit(let sha) = file.source {
            commitParent = commit(for: sha)?.parents.first ?? (commitDetails?.commit.id == sha ? commitDetails?.commit.parents.first : nil)
        }
        var stash: Stash?
        if case .stash(let sha) = file.source { stash = stashes.first { $0.sha == sha } }
        let conflictKind = status.conflicts.first { $0.path == file.change.path }?.kind

        diffTask = Task {
            do {
                let loaded = try await Self.loadDiffContent(repo: repo, file: file, context: context, commitParent: commitParent,
                                                            stash: stash, conflictKind: conflictKind, ignoreWhitespace: ignoreWhitespace)
                guard !Task.isCancelled, openFile == file else { return }
                let state = Self.makeState(loaded)
                if silently, case .text(let old) = diffState, case .text(let new) = state, old.diff == new.diff {
                    return
                }
                if silently, case .conflict(let old, _) = diffState, case .conflict(let new, _) = state, old == new {
                    return
                }
                diffState = state
                if case .text(let presentation) = state {
                    let valid = Set(presentation.hunks.map(\.id))
                    lineSelection = lineSelection.filter { valid.contains($0.key) && !silently }
                } else {
                    lineSelection = [:]
                }
            } catch {
                guard !Task.isCancelled else { return }
                diffState = .failed(FriendlyError.message(for: error))
            }
        }
    }

    private static func makeState(_ loaded: LoadedDiff) -> DiffState {
        switch loaded {
        case .text(let presentation):
            return .text(presentation)
        case .binary(let diff, let before, let after, let isImage):
            guard isImage else { return .binary(diff, nil) }
            return .binary(diff, ImagePair(before: before.flatMap(NSImage.init(data:)), after: after.flatMap(NSImage.init(data:))))
        case .tooLarge(let diff):
            return .tooLarge(diff)
        case .conflict(let file, let entry):
            return .conflict(file, entry)
        case .conflictWithoutMarkers(let entry):
            return .conflictWithoutMarkers(entry)
        case .conflictNotUTF8(let entry):
            return .conflictNotUTF8(entry)
        case .message(let text):
            return .message(text)
        }
    }

    nonisolated static let imageExtensions: Set<String> = ["png", "jpg", "jpeg", "gif", "bmp", "tif", "tiff", "webp", "heic", "ico", "icns"]

    nonisolated static func loadDiffContent(repo: GitRepository, file: OpenFile, context: Int, commitParent: String?,
                                            stash: Stash?, conflictKind: ConflictKind?,
                                            ignoreWhitespace: Bool = false) async throws -> LoadedDiff {
        let w = ignoreWhitespace
        let change = file.change
        let diff: FileDiff?
        switch file.source {
        case .conflict:
            let kind = conflictKind ?? .bothModified
            let entry = ConflictEntry(path: change.path, kind: kind)
            if let data = repo.workingFileData(change.path) {
                switch ConflictFile.parse(data) {
                case .parsed(let parsed) where parsed.conflictCount > 0:
                    return .conflict(parsed, entry)
                case .notUTF8(let conflictCount) where conflictCount > 0:
                    // Don't decode hunk by hunk: writing it back through a string would corrupt every non-ASCII character.
                    return .conflictNotUTF8(entry)
                default:
                    break
                }
            }
            return .conflictWithoutMarkers(entry)
        case .unstaged:
            diff = try await repo.workingDiff(change, kind: change.kind == .untracked ? .untracked : .unstaged, context: context,
                                              ignoreWhitespace: w)
        case .staged:
            diff = try await repo.workingDiff(change, kind: .staged, context: context, ignoreWhitespace: w)
        case .commit(let sha):
            diff = try await repo.diff(commit: sha, parent: commitParent, file: change, context: context, ignoreWhitespace: w)
        case .compare(let from, let to):
            diff = try await repo.diff(commit: to, parent: from, file: change, context: context, ignoreWhitespace: w)
        case .stash:
            guard let stash else { return .message(String(localized: "Stash không còn tồn tại.")) }
            diff = try await repo.stashDiff(stash, file: change, ignoreWhitespace: w)
        }

        guard let diff else {
            return .message(String(localized: "Không có thay đổi để hiển thị."))
        }
        if diff.isBinary {
            let ext = (change.path as NSString).pathExtension.lowercased()
            let isImage = imageExtensions.contains(ext)
            guard isImage else { return .binary(diff, before: nil, after: nil, isImage: false) }
            let images = await loadImageData(repo: repo, file: file, commitParent: commitParent, stash: stash)
            return .binary(diff, before: images.before, after: images.after, isImage: true)
        }
        if diff.hunks.isEmpty {
            if diff.isModeChangeOnly {
                return .message(String(localized: "Chỉ đổi file mode: \(diff.oldMode ?? "?") → \(diff.newMode ?? "?")"))
            }
            if let old = diff.oldPath, let new = diff.newPath, old != new {
                return .message(String(localized: "Đổi tên “\(old)” → “\(new)”, nội dung không đổi."))
            }
            if diff.isNewFile { return .message(String(localized: "File mới, rỗng.")) }
            if diff.isDeletedFile { return .message(String(localized: "Đã xoá file rỗng.")) }
            return .message(String(localized: "Không có thay đổi nội dung."))
        }
        if diff.lineCount > 25_000 { return .tooLarge(diff) }
        return .text(await DiffPresentation.make(diff))
    }

    private nonisolated static func loadImageData(repo: GitRepository, file: OpenFile, commitParent: String?, stash: Stash?) async -> (before: Data?, after: Data?) {
        let path = file.change.path
        let oldPath = file.change.oldPath ?? path
        func blob(_ spec: String) async -> Data? { try? await repo.blob(spec) }
        switch file.source {
        case .unstaged:
            let before = file.change.kind == .untracked ? nil : await blob(":" + path)
            return (before, repo.workingFileData(path))
        case .staged:
            return (await blob("HEAD:" + oldPath), await blob(":" + path))
        case .commit(let sha):
            var before: Data?
            if let commitParent { before = await blob("\(commitParent):\(oldPath)") }
            return (before, await blob("\(sha):\(path)"))
        case .compare(let from, let to):
            return (await blob("\(from):\(oldPath)"), await blob("\(to):\(path)"))
        case .stash:
            guard let stash else { return (nil, nil) }
            if file.change.kind == .untracked, stash.parents.count >= 3 {
                return (nil, await blob("\(stash.parents[2]):\(path)"))
            }
            var before: Data?
            if let parent = stash.parents.first { before = await blob("\(parent):\(oldPath)") }
            return (before, await blob("\(stash.sha):\(path)"))
        case .conflict:
            return (nil, repo.workingFileData(path))
        }
    }

    /// Called after every working tree status change.
    func statusDidChange() {
        let unstagedPaths = Set(status.unstaged.map(\.path))
        let stagedPaths = Set(status.staged.map(\.path))
        selectedUnstaged.formIntersection(unstagedPaths)
        selectedStaged.formIntersection(stagedPaths)

        if let file = openFile {
            switch file.source {
            case .unstaged:
                if let index = status.unstaged.firstIndex(where: { $0.path == file.change.path }) {
                    let change = status.unstaged[index]
                    openFilePosition = index
                    if change != file.change { openFile = OpenFile(source: .unstaged, change: change) }
                    loadDiff(silently: true)
                } else if openNeighbour(in: .unstaged) {
                    break
                } else if let change = status.staged.first(where: { $0.path == file.change.path }) {
                    openDiff(change, source: .staged)
                } else {
                    closeFile()
                }
            case .staged:
                if let index = status.staged.firstIndex(where: { $0.path == file.change.path }) {
                    let change = status.staged[index]
                    openFilePosition = index
                    if change != file.change { openFile = OpenFile(source: .staged, change: change) }
                    loadDiff(silently: true)
                } else if openNeighbour(in: .staged) {
                    break
                } else if let change = status.unstaged.first(where: { $0.path == file.change.path }) {
                    openDiff(change, source: .unstaged)
                } else {
                    closeFile()
                }
            case .conflict:
                if let index = status.conflicts.firstIndex(where: { $0.path == file.change.path }) {
                    openFilePosition = index
                    loadDiff(silently: true)
                } else if openNeighbour(in: .conflict) {
                    break
                } else if let change = status.staged.first(where: { $0.path == file.change.path }) {
                    openDiff(change, source: .staged)
                } else {
                    closeFile()
                }
            default:
                break
            }
        }

        // Mid merge / revert (including "Revert, don't commit"): prefill the suggestion from MERGE_MSG.
        if operation == .merging || operation == .reverting {
            if commitSummary.isEmpty, commitBody.isEmpty, let message = repository.pendingCommitMessage() {
                let parts = message.split(separator: "\n", maxSplits: 1, omittingEmptySubsequences: false)
                commitSummary = parts.first.map(String.init) ?? ""
                commitBody = parts.count > 1 ? parts[1].trimmingCharacters(in: .whitespacesAndNewlines) : ""
                prefilledCommitMessage = (commitSummary, commitBody)
            }
        } else if let prefilled = prefilledCommitMessage {
            // The operation finished / was cancelled outside the commit box ("Continue", "Undo", the terminal): drop a leftover
            // suggestion the user hasn't edited.
            prefilledCommitMessage = nil
            if operation == nil, commitSummary == prefilled.summary, commitBody == prefilled.body {
                commitSummary = ""
                commitBody = ""
            }
        }
    }

    // MARK: - Selecting lines in a diff

    var canSelectLines: Bool {
        // A diff ignoring whitespace (-w) can't produce a patch that applies to the index: only whole-file stage / unstage.
        guard !Prefs.diffIgnoreWhitespaceValue else { return false }
        guard case .text(let presentation) = diffState, let file = openFile else { return false }
        guard file.source == .unstaged || file.source == .staged else { return false }
        return presentation.diff.supportsPartialStaging
    }

    /// The open diff has non-UTF-8 bytes (Latin-1, CP1258…): only whole-file stage / unstage / discard.
    var openDiffIsNotUTF8: Bool {
        guard case .text(let presentation) = diffState else { return false }
        return !presentation.diff.isValidUTF8
    }

    var selectedLineCount: Int { lineSelection.values.reduce(0) { $0 + $1.count } }

    func toggleLine(hunk: DiffPresentation.Hunk, index: Int, extend: Bool) {
        guard canSelectLines, hunk.lines.indices.contains(index), hunk.lines[index].kind == .addition || hunk.lines[index].kind == .deletion else { return }
        var selected = lineSelection[hunk.id] ?? []
        if extend, let anchor = selected.min(by: { abs($0 - index) < abs($1 - index) }) {
            let range = min(anchor, index)...max(anchor, index)
            for i in range where hunk.lines[i].kind == .addition || hunk.lines[i].kind == .deletion {
                selected.insert(i)
            }
        } else if selected.contains(index) {
            selected.remove(index)
        } else {
            selected.insert(index)
        }
        lineSelection[hunk.id] = selected.isEmpty ? nil : selected
    }

    func clearLineSelection() {
        lineSelection = [:]
    }

    // MARK: - Stage / unstage / discard by hunk or line

    func apply(_ action: HunkAction, hunk: DiffPresentation.Hunk) {
        let changeLines = Set(hunk.lines.filter { $0.kind == .addition || $0.kind == .deletion }.map(\.index))
        applyPatch(action, selection: [hunk.id: changeLines], title: Self.title(action, unit: "hunk"))
    }

    func applySelectedLines(_ action: HunkAction) {
        guard !lineSelection.isEmpty else { return }
        applyPatch(action, selection: lineSelection, title: Self.title(action, unit: String(localized: "\(selectedLineCount) dòng")))
    }

    private static func title(_ action: HunkAction, unit: String) -> String {
        switch action {
        case .stage: return "Stage \(unit)"
        case .unstage: return String(localized: "Bỏ stage \(unit)")
        case .discard: return String(localized: "Huỷ \(unit)")
        }
    }

    private func applyPatch(_ action: HunkAction, selection: [Int: Set<Int>], title: String) {
        guard case .text(let presentation) = diffState, let file = openFile else { return }
        guard presentation.diff.isValidUTF8 else {
            toast(.warning, String(localized: "File không phải UTF-8 — chỉ thao tác được trên cả file"))
            return
        }
        guard let patch = PatchBuilder.makePatch(file: presentation.diff, selection: selection, reverse: action.reverse) else {
            toast(.warning, String(localized: "Không có thay đổi nào được chọn"))
            return
        }
        let path = file.change.path
        // The diff was loaded with 0 context lines (Settings): the hunk has no context at all, so git apply needs --unidiff-zero.
        let unidiffZero = presentation.diff.hunks.allSatisfy { hunk in !hunk.lines.contains { $0.kind == .context } }
        var snapshot: String?
        perform(title, refresh: [.status]) { repo in
            if action == .discard { snapshot = try await repo.snapshotChanges() }
            try await repo.applyPatch(patch, cached: action.cached, reverse: action.reverse, unidiffZero: unidiffZero)
        } onSuccess: { [weak self] in
            guard let self else { return }
            lineSelection = [:]
            if action == .discard, let snapshot {
                toast(.success, String(localized: "Đã huỷ thay đổi trong \((path as NSString).lastPathComponent)"), actions: [
                    ToastAction(title: String(localized: "Hoàn tác")) { [weak self] in self?.restoreFiles([path], from: snapshot) },
                ])
            }
        } onError: { [weak self] error in
            self?.showError(String(localized: "\(title) thất bại — thử thao tác trên cả hunk hoặc cả file"), error)
            return true
        }
    }

    func restoreFiles(_ paths: [String], from snapshot: String) {
        perform(String(localized: "Hoàn tác huỷ thay đổi"), refresh: [.status]) { repo in
            try await repo.restoreWorkingFiles(from: snapshot, paths: paths)
        }
    }

    // MARK: - Conflicts

    func resolveConflict(_ entry: ConflictEntry, useOurs: Bool) {
        perform(useOurs ? String(localized: "Dùng bản Current") : String(localized: "Dùng bản Incoming"), refresh: [.status]) { repo in
            try await repo.resolveConflict(path: entry.path, kind: entry.kind, useOurs: useOurs)
        } onSuccess: { [weak self] in
            self?.toast(.success, String(localized: "Đã giải quyết \((entry.path as NSString).lastPathComponent)"))
        }
    }

    /// Use one whole side for several conflicting files at once.
    func resolveConflicts(_ entries: [ConflictEntry], useOurs: Bool) {
        guard !entries.isEmpty else { return }
        if entries.count == 1 { return resolveConflict(entries[0], useOurs: useOurs) }
        perform(useOurs ? String(localized: "Dùng bản Current") : String(localized: "Dùng bản Incoming"), refresh: [.status]) { repo in
            for entry in entries {
                try await repo.resolveConflict(path: entry.path, kind: entry.kind, useOurs: useOurs)
            }
        } onSuccess: { [weak self] in
            self?.toast(.success, String(localized: "Đã giải quyết \(entries.count) file"))
        }
    }

    /// The number of conflict hunks per file (read from disk, large / unreadable files skipped) — so the list can show it immediately.
    nonisolated static func conflictBlockCounts(root: URL, paths: [String]) -> [String: Int] {
        var counts: [String: Int] = [:]
        for path in paths {
            let url = root.appendingPathComponent(path)
            guard let size = (try? FileManager.default.attributesOfItem(atPath: url.path))?[.size] as? Int, size <= 4_000_000,
                  let data = try? Data(contentsOf: url) else { continue }
            switch ConflictFile.parse(data) {
            case .parsed(let file): counts[path] = file.conflictCount
            case .notUTF8(let count): counts[path] = count
            }
        }
        return counts
    }

    /// Write the resolved content (`content`: assembled byte-wise from the choices, or hand-edited) and mark it resolved.
    func saveConflictResolution(_ entry: ConflictEntry, file: ConflictFile, content: Data) {
        perform(String(localized: "Lưu file đã giải quyết"), refresh: [.status]) { repo in
            // Only write while the file on disk is still the version that was opened: an outside edit during resolution is never overwritten away.
            try repo.replaceWorkingFile(entry.path, data: content, expecting: Data(file.bytes))
            try await repo.markResolved(paths: [entry.path])
        } onSuccess: { [weak self] in
            self?.toast(.success, String(localized: "Đã giải quyết \((entry.path as NSString).lastPathComponent)"))
        } onError: { [weak self] error in
            // The file changed on disk: reload it so the user sees the new content (the old choices no longer match).
            if case RepositoryError.changedOnDisk = error { self?.loadDiff() }
            return false
        }
    }

    func markResolved(_ paths: [String]) {
        perform(String(localized: "Đánh dấu đã giải quyết"), refresh: [.status]) { repo in
            try await repo.markResolved(paths: paths)
        }
    }
}
