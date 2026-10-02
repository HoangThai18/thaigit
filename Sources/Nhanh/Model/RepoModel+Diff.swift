import AppKit
import NhanhCore
import SwiftUI

/// Kết quả tải diff ở luồng nền (chỉ chứa dữ liệu Sendable; ảnh được tạo trên main).
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
    // MARK: - Mở / đóng file

    func openDiff(_ change: FileChange, source: DiffSource) {
        let file = OpenFile(source: source, change: change)
        if openFile != file {
            openFile = file
            lineSelection = [:]
            diffState = .loading
        }
        loadDiff()
    }

    func openConflict(_ entry: ConflictEntry) {
        openDiff(entry.asChange, source: .conflict)
    }

    func closeFile() {
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
                                                            stash: stash, conflictKind: conflictKind)
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
                diffState = .failed((error as? LocalizedError)?.errorDescription ?? error.localizedDescription)
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
                                            stash: Stash?, conflictKind: ConflictKind?) async throws -> LoadedDiff {
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
                    // Không giải từng đoạn: ghi lại qua chuỗi sẽ làm hỏng ký tự không phải ASCII.
                    return .conflictNotUTF8(entry)
                default:
                    break
                }
            }
            return .conflictWithoutMarkers(entry)
        case .unstaged:
            diff = try await repo.workingDiff(change, kind: change.kind == .untracked ? .untracked : .unstaged, context: context)
        case .staged:
            diff = try await repo.workingDiff(change, kind: .staged, context: context)
        case .commit(let sha):
            diff = try await repo.diff(commit: sha, parent: commitParent, file: change, context: context)
        case .compare(let from, let to):
            diff = try await repo.diff(commit: to, parent: from, file: change, context: context)
        case .stash:
            guard let stash else { return .message("Stash không còn tồn tại.") }
            diff = try await repo.stashDiff(stash, file: change)
        }

        guard let diff else {
            return .message("Không có thay đổi để hiển thị.")
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
                return .message("Chỉ đổi quyền file: \(diff.oldMode ?? "?") → \(diff.newMode ?? "?")")
            }
            if let old = diff.oldPath, let new = diff.newPath, old != new {
                return .message("Đổi tên “\(old)” → “\(new)”, nội dung không đổi.")
            }
            if diff.isNewFile { return .message("File mới, rỗng.") }
            if diff.isDeletedFile { return .message("Đã xoá file rỗng.") }
            return .message("Không có thay đổi nội dung.")
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

    /// Gọi sau mỗi lần trạng thái working tree thay đổi.
    func statusDidChange() {
        let unstagedPaths = Set(status.unstaged.map(\.path))
        let stagedPaths = Set(status.staged.map(\.path))
        selectedUnstaged.formIntersection(unstagedPaths)
        selectedStaged.formIntersection(stagedPaths)

        if let file = openFile {
            switch file.source {
            case .unstaged:
                if let change = status.unstaged.first(where: { $0.path == file.change.path }) {
                    if change != file.change { openFile = OpenFile(source: .unstaged, change: change) }
                    loadDiff(silently: true)
                } else if let change = status.staged.first(where: { $0.path == file.change.path }) {
                    openDiff(change, source: .staged)
                } else {
                    closeFile()
                }
            case .staged:
                if let change = status.staged.first(where: { $0.path == file.change.path }) {
                    if change != file.change { openFile = OpenFile(source: .staged, change: change) }
                    loadDiff(silently: true)
                } else if let change = status.unstaged.first(where: { $0.path == file.change.path }) {
                    openDiff(change, source: .unstaged)
                } else {
                    closeFile()
                }
            case .conflict:
                if status.conflicts.contains(where: { $0.path == file.change.path }) {
                    loadDiff(silently: true)
                } else if let change = status.staged.first(where: { $0.path == file.change.path }) {
                    openDiff(change, source: .staged)
                } else {
                    closeFile()
                }
            default:
                break
            }
        }

        // Đang merge / revert (kể cả "Revert, chưa commit"): gợi ý sẵn message từ MERGE_MSG.
        if operation == .merging || operation == .reverting {
            if commitSummary.isEmpty, commitBody.isEmpty, let message = repository.pendingCommitMessage() {
                let parts = message.split(separator: "\n", maxSplits: 1, omittingEmptySubsequences: false)
                commitSummary = parts.first.map(String.init) ?? ""
                commitBody = parts.count > 1 ? parts[1].trimmingCharacters(in: .whitespacesAndNewlines) : ""
                prefilledCommitMessage = (commitSummary, commitBody)
            }
        } else if let prefilled = prefilledCommitMessage {
            // Thao tác đã xong / đã huỷ ngoài ô commit ("Tiếp tục", "Hoàn tác", terminal): bỏ message gợi ý còn sót
            // nếu người dùng chưa sửa.
            prefilledCommitMessage = nil
            if operation == nil, commitSummary == prefilled.summary, commitBody == prefilled.body {
                commitSummary = ""
                commitBody = ""
            }
        }
    }

    // MARK: - Chọn dòng trong diff

    var canSelectLines: Bool {
        guard case .text(let presentation) = diffState, let file = openFile else { return false }
        guard file.source == .unstaged || file.source == .staged else { return false }
        return presentation.diff.supportsPartialStaging
    }

    /// Diff đang mở có byte không phải UTF-8 (Latin-1, CP1258…): chỉ stage/bỏ stage/huỷ được cả file.
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

    // MARK: - Stage / unstage / huỷ theo hunk hoặc dòng

    func apply(_ action: HunkAction, hunk: DiffPresentation.Hunk) {
        let changeLines = Set(hunk.lines.filter { $0.kind == .addition || $0.kind == .deletion }.map(\.index))
        applyPatch(action, selection: [hunk.id: changeLines], title: Self.title(action, unit: "hunk"))
    }

    func applySelectedLines(_ action: HunkAction) {
        guard !lineSelection.isEmpty else { return }
        applyPatch(action, selection: lineSelection, title: Self.title(action, unit: "\(selectedLineCount) dòng"))
    }

    private static func title(_ action: HunkAction, unit: String) -> String {
        switch action {
        case .stage: return "Stage \(unit)"
        case .unstage: return "Bỏ stage \(unit)"
        case .discard: return "Huỷ \(unit)"
        }
    }

    private func applyPatch(_ action: HunkAction, selection: [Int: Set<Int>], title: String) {
        guard case .text(let presentation) = diffState, let file = openFile else { return }
        guard presentation.diff.isValidUTF8 else {
            toast(.warning, "File không phải UTF-8 — chỉ thao tác được trên cả file")
            return
        }
        guard let patch = PatchBuilder.makePatch(file: presentation.diff, selection: selection, reverse: action.reverse) else {
            toast(.warning, "Không có thay đổi nào được chọn")
            return
        }
        let path = file.change.path
        // Diff tải với 0 dòng ngữ cảnh (Cài đặt): hunk không có dòng ngữ cảnh nào, git apply cần --unidiff-zero.
        let unidiffZero = presentation.diff.hunks.allSatisfy { hunk in !hunk.lines.contains { $0.kind == .context } }
        var snapshot: String?
        perform(title, refresh: [.status]) { repo in
            if action == .discard { snapshot = try await repo.snapshotChanges() }
            try await repo.applyPatch(patch, cached: action.cached, reverse: action.reverse, unidiffZero: unidiffZero)
        } onSuccess: { [weak self] in
            guard let self else { return }
            lineSelection = [:]
            if action == .discard, let snapshot {
                toast(.success, "Đã huỷ thay đổi trong \((path as NSString).lastPathComponent)", actions: [
                    ToastAction(title: "Hoàn tác") { [weak self] in self?.restoreFiles([path], from: snapshot) },
                ])
            }
        } onError: { [weak self] error in
            self?.showError("\(title) thất bại — thử thao tác trên cả hunk hoặc cả file", error)
            return true
        }
    }

    func restoreFiles(_ paths: [String], from snapshot: String) {
        perform("Hoàn tác huỷ thay đổi", refresh: [.status]) { repo in
            try await repo.restoreWorkingFiles(from: snapshot, paths: paths)
        }
    }

    // MARK: - Xung đột

    func resolveConflict(_ entry: ConflictEntry, useOurs: Bool) {
        perform(useOurs ? "Dùng bản Current" : "Dùng bản Incoming", refresh: [.status]) { repo in
            try await repo.resolveConflict(path: entry.path, kind: entry.kind, useOurs: useOurs)
        } onSuccess: { [weak self] in
            self?.toast(.success, "Đã giải quyết \((entry.path as NSString).lastPathComponent)")
        }
    }

    func saveConflictResolution(_ entry: ConflictEntry, file: ConflictFile, choices: [Int: ConflictFile.Resolution]) {
        // Ghép theo byte: BOM, kiểu xuống dòng và mọi byte ngoài các khối xung đột giữ nguyên văn.
        guard let content = file.resolvedData(with: choices) else {
            toast(.warning, "Còn xung đột chưa chọn cách giải quyết")
            return
        }
        perform("Lưu file đã giải quyết", refresh: [.status]) { repo in
            // Chỉ ghi khi file trên đĩa vẫn là bản đã mở: sửa bên ngoài trong lúc giải thì không ghi đè mất.
            try repo.replaceWorkingFile(entry.path, data: content, expecting: Data(file.bytes))
            try await repo.markResolved(paths: [entry.path])
        } onSuccess: { [weak self] in
            self?.toast(.success, "Đã giải quyết \((entry.path as NSString).lastPathComponent)")
        } onError: { [weak self] error in
            // File đã đổi trên đĩa: nạp lại để người dùng thấy nội dung mới (lựa chọn cũ không còn khớp).
            if case RepositoryError.changedOnDisk = error { self?.loadDiff() }
            return false
        }
    }

    func markResolved(_ paths: [String]) {
        perform("Đánh dấu đã giải quyết", refresh: [.status]) { repo in
            try await repo.markResolved(paths: paths)
        }
    }
}
