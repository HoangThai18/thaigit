import Foundation

public enum RepositoryError: LocalizedError, Sendable {
    case notARepository(String)
    case bareRepository(String)
    case invalidName(String)
    case notUTF8(String)
    case changedOnDisk(String)
    /// Revert một commit mà thay đổi của nó đã được đảo ngược từ trước.
    case nothingToRevert(String)

    public var errorDescription: String? {
        switch self {
        case .notARepository(let path): return String(localized: "“\(path)” không phải là một Git repository.")
        case .bareRepository(let path): return String(localized: "“\(path)” là bare repository (không có working tree) — Thaigit chưa hỗ trợ loại này.")
        case .invalidName(let name): return String(localized: "Tên “\(name)” không hợp lệ.")
        case .notUTF8(let path): return String(localized: "“\(path)” không phải văn bản UTF-8 — Thaigit không sửa nội dung file này trong app để tránh làm hỏng ký tự.")
        case .changedOnDisk(let path): return String(localized: "“\(path)” vừa được sửa bên ngoài Thaigit nên chưa ghi đè. Hãy xem lại nội dung mới rồi giải tiếp.")
        case .nothingToRevert(let sha): return String(localized: "Commit \(sha) đã được đảo ngược, không có gì để revert.")
        }
    }
}

/// Lịch sử commit đã xếp làn, sẵn sàng để vẽ.
public struct History: Sendable {
    /// Có thể có commit giả WIP ở vị trí 0.
    public let commits: [Commit]
    public let rows: [GraphRow]
    /// Số commit thật đã tải.
    public let loadedCount: Int
    /// true nếu có thể còn commit cũ hơn chưa tải (chạm giới hạn).
    public let mayHaveMore: Bool
}

public enum WorkingDiffKind: Sendable {
    case unstaged
    case staged
    case untracked
}

public enum MergeStyle: String, Sendable, CaseIterable {
    /// Fast-forward nếu có thể (mặc định của git).
    case automatic
    case noFastForward
    case fastForwardOnly
    case squash
}

/// Repository Git trên đĩa và mọi thao tác Thaigit dùng. Mỗi hàm chạy một hoặc vài lệnh `git`.
public struct GitRepository: Sendable {
    public let root: URL
    public let gitDir: URL
    public let commonDir: URL
    public let runner: GitRunner

    public var name: String { root.lastPathComponent }

    private static let literalPathspecs = ["GIT_LITERAL_PATHSPECS": "1"]

    public init(root: URL, gitDir: URL, commonDir: URL, runner: GitRunner) {
        self.root = root
        self.gitDir = gitDir
        self.commonDir = commonDir
        self.runner = runner
    }

    /// Tìm repository chứa thư mục `url`.
    public static func open(at url: URL, environment: GitEnvironmentStore,
                            logger: (@Sendable (GitCommandRecord) -> Void)? = nil) async throws -> GitRepository {
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory), isDirectory.boolValue else {
            throw RepositoryError.notARepository(url.path)
        }
        let probe = GitRunner(environmentStore: environment, workingDirectory: url, logger: logger)
        let output: String
        do {
            output = try await probe.output(["rev-parse", "--show-toplevel", "--absolute-git-dir", "--git-common-dir"])
        } catch let error as GitError {
            if error.contains("must be run in a work tree") { throw RepositoryError.bareRepository(url.path) }
            if error.contains("not a git repository") { throw RepositoryError.notARepository(url.path) }
            throw error
        }
        let lines = output.split(separator: "\n").map(String.init)
        guard lines.count >= 3 else { throw RepositoryError.notARepository(url.path) }
        let root = URL(fileURLWithPath: lines[0], isDirectory: true).standardizedFileURL
        let gitDir = URL(fileURLWithPath: lines[1], isDirectory: true).standardizedFileURL
        let commonPath = lines[2].hasPrefix("/") ? lines[2] : (url.path as NSString).appendingPathComponent(lines[2])
        let commonDir = URL(fileURLWithPath: commonPath, isDirectory: true).standardizedFileURL
        return GitRepository(root: root, gitDir: gitDir, commonDir: commonDir,
                             runner: GitRunner(environmentStore: environment, workingDirectory: root, logger: logger))
    }

    // MARK: - Đọc dữ liệu

    public func refs() async throws -> [GitRef] {
        let text = try await runner.output(["for-each-ref", "--format=\(GitParsers.refFormat)", "refs/heads", "refs/remotes", "refs/tags"])
        return GitParsers.parseRefs(text)
    }

    public func status() async throws -> WorkingTreeStatus {
        let output = try await runner.run(
            ["status", "--porcelain=v2", "--branch", "--show-stash", "-z", "--untracked-files=all"],
            environment: ["GIT_OPTIONAL_LOCKS": "0"]
        )
        return GitParsers.parseStatus(output.stdout)
    }

    public func stashes() async throws -> [Stash] {
        let output = try await runner.run(["stash", "list", "-z", "--format=\(GitParsers.stashFormat)"])
        return GitParsers.parseStashList(output.stdout)
    }

    public func remotes() async throws -> [Remote] {
        GitParsers.parseRemotes(try await runner.output(["remote", "-v"]))
    }

    public func log(limit: Int, order: LogOrder, includeHEAD: Bool, includeRemotes: Bool = true, includeTags: Bool = true,
                    filter: GraphRefFilter = GraphRefFilter()) async throws -> [Commit] {
        var args = ["log", "-z", "--format=\(GitParsers.logFormat)",
                    order == .topo ? "--topo-order" : "--date-order",
                    "--max-count=\(max(1, limit))"]
        args += filter.revisionArguments(includeHEAD: includeHEAD, includeRemotes: includeRemotes, includeTags: includeTags)
        args.append("--")
        do {
            let output = try await runner.run(args)
            return GitParsers.parseLog(output.stdout)
        } catch let error as GitError where error.contains("does not have any commits")
            || error.contains("bad default revision") || error.contains("unknown revision") {
            return []
        }
    }

    /// Tải lịch sử và xếp làn (chạy ở luồng nền).
    @concurrent
    public func history(limit: Int, order: LogOrder, head: HeadState, showWorkingTree: Bool,
                        includeRemotes: Bool = true, includeTags: Bool = true,
                        filter: GraphRefFilter = GraphRefFilter()) async throws -> History {
        var commits = try await log(limit: limit, order: order, includeHEAD: head.oid != nil,
                                    includeRemotes: includeRemotes, includeTags: includeTags, filter: filter)
        let loaded = commits.count
        if showWorkingTree { commits.insert(.workingTree(parent: head.oid), at: 0) }
        let rows = GraphLayout.compute(commits)
        return History(commits: commits, rows: rows, loadedCount: loaded, mayHaveMore: loaded >= limit)
    }

    @concurrent
    public static func layout(_ commits: [Commit]) async -> [GraphRow] {
        GraphLayout.compute(commits)
    }

    public func commitMessage(_ sha: String) async throws -> String {
        try await runner.output(["show", "-s", "--format=%B", sha, "--"])
    }

    /// Commit dạng patch email (như `git format-patch -1 --stdout`) — áp lại được bằng `git am`.
    public func commitPatch(_ sha: String) async throws -> String {
        try await runner.output(["show", "--format=email", "--patch", "--stat", "--binary", "--no-color", sha, "--"])
    }

    /// File thay đổi trong commit (so với cha đầu tiên; commit gốc so với cây rỗng).
    public func changedFiles(commit sha: String, parent: String?) async throws -> [FileChange] {
        var args = ["diff-tree", "-r", "-z", "--name-status", "-M", "--no-commit-id"]
        if let parent { args += [parent, sha] } else { args += ["--root", sha] }
        let output = try await runner.run(args)
        return GitParsers.parseNameStatus(output.stdout)
    }

    public func diff(commit sha: String, parent: String?, file: FileChange, context: Int = 3,
                     ignoreWhitespace: Bool = false) async throws -> FileDiff? {
        var args = ["diff-tree", "-p", "-M", "--no-color", "-U\(context)", "--src-prefix=a/", "--dst-prefix=b/", "--no-commit-id"]
        if ignoreWhitespace { args.append("-w") }
        if let parent { args += [parent, sha] } else { args += ["--root", sha] }
        args += ["--"] + file.allPaths
        let output = try await runner.run(args, environment: Self.literalPathspecs)
        return DiffParser.parse(output.stdout).first
    }

    /// Diff của file trong working tree / index. Parse thẳng từ byte của git (không qua chuỗi giải mã lỏng): dòng giữ
    /// nguyên "\r", file không phải UTF-8 bị đánh dấu `isValidUTF8 = false` nên không stage/huỷ từng dòng được.
    /// `--no-textconv`: patch phải dựng từ byte thật, và repo lạ có thể đặt `diff.<driver>.textconv` thành lệnh tuỳ ý
    /// (như `core.fsmonitor`) — chỉ xem diff không được chạy lệnh của repo.
    /// `ignoreWhitespace` (`-w`): chỉ để xem — patch dựng từ diff này không áp được, nên app tắt stage từng phần khi bật.
    public func workingDiff(_ change: FileChange, kind: WorkingDiffKind, context: Int = 3,
                            ignoreWhitespace: Bool = false) async throws -> FileDiff? {
        let common = ["--no-color", "--no-ext-diff", "--no-textconv", "-U\(context)", "--src-prefix=a/", "--dst-prefix=b/"]
            + (ignoreWhitespace ? ["-w"] : [])
        let output: ProcessOutput
        switch kind {
        case .unstaged:
            output = try await runner.run(["diff"] + common + ["--", change.path], environment: Self.literalPathspecs)
        case .staged:
            output = try await runner.run(["diff", "--cached", "-M"] + common + ["--"] + change.allPaths, environment: Self.literalPathspecs)
        case .untracked:
            output = try await runner.run(["diff", "--no-index"] + common + ["--", "/dev/null", change.path], acceptExitCodes: [0, 1])
        }
        return DiffParser.parse(output.stdout).first
    }

    /// Nội dung blob, ví dụ "HEAD:path", ":path" (index), "<sha>:path".
    public func blob(_ spec: String) async throws -> Data {
        try await runner.run(["cat-file", "blob", spec]).stdout
    }

    public func workingFileData(_ path: String) -> Data? {
        try? Data(contentsOf: root.appendingPathComponent(path))
    }

    public func fileHistory(path: String, limit: Int = 300) async throws -> [Commit] {
        let output = try await runner.run(["log", "-z", "--format=\(GitParsers.logFormat)", "--follow", "--max-count=\(limit)", "--", path],
                                          environment: Self.literalPathspecs)
        return GitParsers.parseLog(output.stdout)
    }

    public func resolveCommit(_ rev: String) async throws -> String {
        try await runner.output(["rev-parse", "--verify", "--quiet", rev + "^{commit}"]).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    public func config(_ key: String) async -> String? {
        guard let value = try? await runner.output(["config", "--get", key]) else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    public func setConfig(_ key: String, _ value: String, global: Bool) async throws {
        try await runner.run(["config"] + (global ? ["--global"] : []) + [key, value])
    }

    /// Kiểm tra tên nhánh/tag hợp lệ theo quy tắc của git.
    public func isValidRefName(_ name: String, branch: Bool) async -> Bool {
        guard !name.isEmpty else { return false }
        let args = branch ? ["check-ref-format", "--branch", name] : ["check-ref-format", "refs/tags/\(name)"]
        return (try? await runner.run(args)) != nil
    }

    // MARK: - Trạng thái thao tác dở dang

    public func operationState() -> RepoOperation? {
        let fm = FileManager.default
        func path(_ name: String) -> String { gitDir.appendingPathComponent(name).path }
        func exists(_ name: String) -> Bool { fm.fileExists(atPath: path(name)) }
        func readInt(_ name: String) -> Int? {
            guard let text = try? String(contentsOfFile: path(name), encoding: .utf8) else { return nil }
            return Int(text.trimmingCharacters(in: .whitespacesAndNewlines))
        }
        func readString(_ name: String) -> String? {
            guard let text = try? String(contentsOfFile: path(name), encoding: .utf8) else { return nil }
            let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
            return value.hasPrefix("refs/heads/") ? String(value.dropFirst("refs/heads/".count)) : value
        }
        if exists("rebase-merge") {
            return .rebasing(step: readInt("rebase-merge/msgnum"), total: readInt("rebase-merge/end"), headName: readString("rebase-merge/head-name"))
        }
        if exists("rebase-apply") {
            if exists("rebase-apply/applying") { return .applyingPatches }
            return .rebasing(step: readInt("rebase-apply/next"), total: readInt("rebase-apply/last"), headName: readString("rebase-apply/head-name"))
        }
        if exists("MERGE_HEAD") { return .merging }
        if exists("CHERRY_PICK_HEAD") { return .cherryPicking }
        if exists("REVERT_HEAD") { return .reverting }
        if exists("BISECT_LOG") { return .bisecting }
        return nil
    }

    /// Thay message gợi ý (MERGE_MSG) của thao tác dở: `revert --continue` / `cherry-pick --continue` commit bằng message này.
    public func setPendingCommitMessage(_ message: String) throws {
        try Data((message + "\n").utf8).write(to: gitDir.appendingPathComponent("MERGE_MSG"), options: .atomic)
    }

    /// Message gợi ý khi đang merge (MERGE_MSG/SQUASH_MSG), đã bỏ các dòng chú thích; xuống dòng luôn là "\n".
    public func pendingCommitMessage() -> String? {
        for name in ["MERGE_MSG", "SQUASH_MSG"] {
            guard let text = try? String(contentsOf: gitDir.appendingPathComponent(name), encoding: .utf8) else { continue }
            // Tách theo scalar "\n" ("\r\n" là MỘT Character nên `split(separator: "\n")` không tách được message CRLF).
            let lines = text.unicodeScalars.split(separator: "\n", omittingEmptySubsequences: false)
                .map { line in String(line.last == "\r" ? line.dropLast() : line) }
                .filter { !$0.hasPrefix("#") }
            let message = lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
            if !message.isEmpty { return message }
        }
        return nil
    }

    // MARK: - Stage / unstage / discard

    public func stage(paths: [String]) async throws {
        guard !paths.isEmpty else { return }
        try await runner.run(["add", "-A", "--pathspec-from-file=-", "--pathspec-file-nul"],
                             input: paths.nulSeparatedData, environment: Self.literalPathspecs)
    }

    public func stageAll() async throws {
        try await runner.run(["add", "-A"])
    }

    public func unstage(paths: [String], headExists: Bool) async throws {
        guard !paths.isEmpty else { return }
        if headExists {
            try await runner.run(["reset", "-q", "--pathspec-from-file=-", "--pathspec-file-nul", "HEAD"],
                                 input: paths.nulSeparatedData, environment: Self.literalPathspecs)
        } else {
            try await runner.run(["rm", "--cached", "-r", "-q", "--pathspec-from-file=-", "--pathspec-file-nul"],
                                 input: paths.nulSeparatedData, environment: Self.literalPathspecs)
        }
    }

    public func unstageAll(headExists: Bool) async throws {
        // Reset có pathspec để không xoá trạng thái merge đang dở.
        if headExists {
            try await runner.run(["reset", "-q", "HEAD", "--", "."])
        } else {
            try await runner.run(["rm", "--cached", "-r", "-q", "--", "."])
        }
    }

    /// Bỏ thay đổi chưa stage của file đã track (khôi phục từ index).
    public func discard(paths: [String]) async throws {
        guard !paths.isEmpty else { return }
        try await runner.run(["restore", "--worktree", "--pathspec-from-file=-", "--pathspec-file-nul"],
                             input: paths.nulSeparatedData, environment: Self.literalPathspecs)
    }

    /// Chuyển file chưa track vào Thùng rác (có thể khôi phục). Trả về vị trí mới trong Thùng rác.
    public func trashUntracked(paths: [String]) throws -> [String: URL] {
        var moved: [String: URL] = [:]
        for path in paths {
            let url = root.appendingPathComponent(path)
            var resulting: NSURL?
            try FileManager.default.trashItem(at: url, resultingItemURL: &resulting)
            if let resulting { moved[path] = resulting as URL }
        }
        return moved
    }

    /// Ảnh chụp toàn bộ thay đổi đã track (index + worktree) thành một commit stash lơ lửng,
    /// không đụng tới working tree — dùng để "Hoàn tác" sau khi huỷ thay đổi.
    public func snapshotChanges() async throws -> String? {
        let sha = try await runner.output(["stash", "create"]).trimmingCharacters(in: .whitespacesAndNewlines)
        return sha.isEmpty ? nil : sha
    }

    /// Khôi phục nội dung working tree của các file từ một commit (không đổi index).
    public func restoreWorkingFiles(from rev: String, paths: [String]) async throws {
        guard !paths.isEmpty else { return }
        try await runner.run(["restore", "--source=\(rev)", "--worktree", "--pathspec-from-file=-", "--pathspec-file-nul"],
                             input: paths.nulSeparatedData, environment: Self.literalPathspecs)
    }

    /// - Parameter unidiffZero: patch dựng từ diff không có dòng ngữ cảnh (`-U0`) — git apply chỉ nhận khi có cờ này.
    public func applyPatch(_ patch: String, cached: Bool, reverse: Bool, unidiffZero: Bool = false) async throws {
        var args = ["apply", "--whitespace=nowarn", "--recount"]
        if cached { args.append("--cached") }
        if reverse { args.append("--reverse") }
        if unidiffZero { args.append("--unidiff-zero") }
        args.append("-")
        try await runner.run(args, input: Data(patch.utf8))
    }

    public func hardReset(to rev: String = "HEAD") async throws {
        try await runner.run(["reset", "--hard", "-q", rev])
    }

    public func addToGitignore(_ pattern: String) throws {
        let url = root.appendingPathComponent(".gitignore")
        var text = (try? String(contentsOf: url, encoding: .utf8)) ?? ""
        if !text.isEmpty && !text.hasSuffix("\n") { text += "\n" }
        text += pattern + "\n"
        try text.write(to: url, atomically: true, encoding: .utf8)
    }

    // MARK: - Commit

    public func commit(message: String, amend: Bool, allowEmpty: Bool = false) async throws {
        var args = ["commit", "--cleanup=whitespace", "-F", "-"]
        if amend { args.append("--amend") }
        if allowEmpty { args.append("--allow-empty") }
        try await runner.run(args, input: Data(message.utf8))
    }

    /// Đưa nhánh hiện tại về `rev` giữ nguyên thay đổi (dùng để hoàn tác commit).
    public func softReset(to rev: String) async throws {
        try await runner.run(["reset", "--soft", rev])
    }

    /// Xoá commit đầu tiên của nhánh (nhánh trở lại trạng thái chưa có commit), giữ index.
    public func undoInitialCommit() async throws {
        try await runner.run(["update-ref", "-d", "HEAD"])
    }

    // MARK: - Nhánh

    public func switchTo(branch: String) async throws {
        try await runner.run(["switch", "--no-guess", branch])
    }

    public func switchDetached(_ rev: String) async throws {
        try await runner.run(["switch", "--detach", rev])
    }

    public func createBranch(_ name: String, at startPoint: String?, checkout: Bool) async throws {
        if checkout {
            try await runner.run(["switch", "-c", name] + (startPoint.map { [$0] } ?? []))
        } else {
            try await runner.run(["branch", name] + (startPoint.map { [$0] } ?? []))
        }
    }

    /// Tạo nhánh local theo dõi nhánh remote rồi checkout.
    public func checkoutTracking(remoteBranch: String, localName: String) async throws {
        try await runner.run(["switch", "-c", localName, "--track", remoteBranch])
    }

    public func deleteBranch(_ name: String, force: Bool) async throws {
        try await runner.run(["branch", force ? "-D" : "-d", name])
    }

    public func renameBranch(_ old: String, to new: String) async throws {
        try await runner.run(["branch", "-m", old, new])
    }

    public func setUpstream(branch: String, upstream: String) async throws {
        try await runner.run(["branch", "--set-upstream-to=\(upstream)", branch])
    }

    public func unsetUpstream(branch: String) async throws {
        try await runner.run(["branch", "--unset-upstream", branch])
    }

    /// Đặt ref về một object cụ thể (dùng để khôi phục nhánh/tag đã xoá).
    public func updateRef(_ fullName: String, to object: String) async throws {
        try await runner.run(["update-ref", fullName, object])
    }

    /// Fast-forward nhánh không phải nhánh hiện tại tới upstream của nó. `fetch .` chỉ chép ref trong repo, không chạm
    /// mạng nên không có token GitHub.
    public func fastForward(branch: String, to upstream: String) async throws {
        try await runner.run(["fetch", ".", "\(upstream):refs/heads/\(branch)"])
    }

    // MARK: - Merge / rebase / cherry-pick / revert / reset

    public func merge(_ ref: String, style: MergeStyle = .automatic) async throws {
        var args = ["merge", "--no-edit"]
        switch style {
        case .automatic: break
        case .noFastForward: args.append("--no-ff")
        case .fastForwardOnly: args.append("--ff-only")
        case .squash: args.append("--squash")
        }
        args.append(ref)
        try await runner.run(args)
    }

    /// Rebase nhánh `branch` (mặc định nhánh hiện tại) lên `ref`. Có `branch` thì git tự checkout nhánh đó trước.
    public func rebase(onto ref: String, branch: String? = nil) async throws {
        try await runner.run(["rebase", ref] + (branch.map { [$0] } ?? []))
    }

    public func cherryPick(_ sha: String, mainline: Int? = nil) async throws {
        try await runner.run(["cherry-pick"] + (mainline.map { ["-m", String($0)] } ?? []) + [sha])
    }

    /// Revert `sha` (commit merge cần `mainline`, thường là 1 = cha thứ nhất). `commit: false` (`--no-commit`) chỉ
    /// stage thay đổi đảo ngược: git để lại REVERT_HEAD (thao tác "Đang revert") và message gợi ý trong MERGE_MSG,
    /// người dùng xem lại rồi tự commit (hoặc `revert --continue`, huỷ bằng `revert --abort`).
    /// Commit đã được đảo ngược từ trước thì `--no-commit` không stage gì mà vẫn để REVERT_HEAD (commit tiếp sẽ gói thay
    /// đổi đang làm dở vào "commit revert"): huỷ ngay thao tác đó và ném `RepositoryError.nothingToRevert`.
    public func revert(_ sha: String, mainline: Int? = nil, commit: Bool = true) async throws {
        try await runner.run(["revert", commit ? "--no-edit" : "--no-commit"] + (mainline.map { ["-m", String($0)] } ?? []) + [sha])
        guard !commit, operationState() == .reverting else { return }
        let staged = try await runner.run(["diff", "--cached", "--quiet"], acceptExitCodes: [0, 1])
        if staged.exitCode == 0 {
            try await abort(.reverting)
            throw RepositoryError.nothingToRevert(String(sha.prefix(7)))
        }
    }

    public func reset(to rev: String, mode: ResetMode) async throws {
        try await runner.run(["reset", "-q", "--\(mode.rawValue)", rev])
    }

    /// Hoàn tác merge/rebase vừa xong mà vẫn giữ thay đổi local chưa commit.
    public func resetKeepingLocalChanges(to rev: String) async throws {
        try await runner.run(["reset", "-q", "--merge", rev])
    }

    public func abort(_ operation: RepoOperation) async throws {
        switch operation {
        case .merging: try await runner.run(["merge", "--abort"])
        case .rebasing: try await runner.run(["rebase", "--abort"])
        case .cherryPicking: try await runner.run(["cherry-pick", "--abort"])
        case .reverting: try await runner.run(["revert", "--abort"])
        case .applyingPatches: try await runner.run(["am", "--abort"])
        case .bisecting: try await runner.run(["bisect", "reset"])
        }
    }

    public func continueOperation(_ operation: RepoOperation) async throws {
        switch operation {
        case .merging: try await runner.run(["merge", "--continue"])
        case .rebasing: try await runner.run(["rebase", "--continue"])
        case .cherryPicking: try await runner.run(["cherry-pick", "--continue"])
        case .reverting: try await runner.run(["revert", "--continue"])
        case .applyingPatches: try await runner.run(["am", "--continue"])
        case .bisecting: break
        }
    }

    public func skip(_ operation: RepoOperation) async throws {
        switch operation {
        case .rebasing: try await runner.run(["rebase", "--skip"])
        case .cherryPicking: try await runner.run(["cherry-pick", "--skip"])
        case .reverting: try await runner.run(["revert", "--skip"])
        case .applyingPatches: try await runner.run(["am", "--skip"])
        default: break
        }
    }

    // MARK: - Xung đột

    /// Giải quyết xung đột bằng toàn bộ phiên bản của một bên.
    public func resolveConflict(path: String, kind: ConflictKind, useOurs: Bool) async throws {
        let sideMissing: Bool
        if useOurs {
            sideMissing = kind == .deletedByUs || kind == .bothDeleted || kind == .addedByThem
        } else {
            sideMissing = kind == .deletedByThem || kind == .bothDeleted || kind == .addedByUs
        }
        if sideMissing {
            try await runner.run(["rm", "-q", "--", path], environment: Self.literalPathspecs)
        } else {
            try await runner.run(["checkout", useOurs ? "--ours" : "--theirs", "--", path], environment: Self.literalPathspecs)
            try await runner.run(["add", "--", path], environment: Self.literalPathspecs)
        }
    }

    public func markResolved(paths: [String]) async throws {
        guard !paths.isEmpty else { return }
        try await runner.run(["add", "-A", "--pathspec-from-file=-", "--pathspec-file-nul"],
                             input: paths.nulSeparatedData, environment: Self.literalPathspecs)
    }

    /// Đọc file dạng UTF-8 CHẶT (giữ BOM): ném `RepositoryError.notUTF8` thay vì trả chuỗi đã thay byte lỗi bằng
    /// U+FFFD — ghi chuỗi đó trở lại sẽ làm hỏng mọi ký tự không phải ASCII của file Latin-1/CP1258.
    public func readWorkingFile(_ path: String) throws -> String {
        let data = try Data(contentsOf: root.appendingPathComponent(path))
        guard let text = UTF8Text.decodeStrict(data) else { throw RepositoryError.notUTF8(path) }
        return text
    }

    public func writeWorkingFile(_ path: String, contents: String) throws {
        try writeWorkingFile(path, data: Data(contents.utf8))
    }

    public func writeWorkingFile(_ path: String, data: Data) throws {
        try data.write(to: root.appendingPathComponent(path), options: .atomic)
    }

    /// Ghi đè file chỉ khi nội dung trên đĩa vẫn đúng `expected` (bản app đã đọc). File được sửa bên ngoài trong lúc
    /// đang giải xung đột thì ném `RepositoryError.changedOnDisk` thay vì ghi đè mất phần sửa đó.
    public func replaceWorkingFile(_ path: String, data: Data, expecting expected: Data) throws {
        guard workingFileData(path) == expected else { throw RepositoryError.changedOnDisk(path) }
        try writeWorkingFile(path, data: data)
    }

    // MARK: - Remote

    /// Địa chỉ mà lệnh mạng tới `remote` thật sự chạm — để chỉ đưa token GitHub của đúng tài khoản (xem
    /// `GitRunner.run(credentialURLs:)`). Đọc `remote.<tên>.url` / `pushurl` qua `git remote -v` (đã áp `insteadOf` /
    /// `pushInsteadOf`): fetch dùng URL đầu tiên, push dùng mọi URL push. `remote` nil: mọi remote (`fetch --all`). Tên
    /// không phải remote đã cấu hình (URL / đường dẫn gõ thẳng) thì chính nó là địa chỉ. Đọc lỗi thì không có địa chỉ nào.
    public func remoteURLs(_ remote: String?, push: Bool) async -> [String] {
        guard let text = try? await runner.output(["remote", "-v"]) else { return remote.map { [$0] } ?? [] }
        var urls: [String] = []
        var known = false
        for line in text.split(separator: "\n") {
            let parts = line.split(separator: "\t", maxSplits: 1)
            guard parts.count == 2 else { continue }
            let name = String(parts[0])
            guard remote == nil || name == remote else { continue }
            known = true
            let suffix = push ? " (push)" : " (fetch)"
            guard parts[1].hasSuffix(suffix) else { continue }
            let url = String(parts[1].dropLast(suffix.count))
            if !urls.contains(url) { urls.append(url) }
        }
        if let remote, !known { return [remote] }
        return urls
    }

    /// Remote mà `git pull` (không tham số) fetch: `branch.<nhánh hiện tại>.remote`, không có thì remote duy nhất, rồi
    /// "origin" — như git. "." (nhánh theo dõi nhánh local) không chạm mạng.
    func pullRemote() async -> String? {
        let branch = (try? await runner.output(["symbolic-ref", "--quiet", "--short", "HEAD"]))?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if let branch, !branch.isEmpty, let remote = await config("branch.\(branch).remote") {
            return remote == "." ? nil : remote
        }
        let names = ((try? await runner.output(["remote"])) ?? "").split(separator: "\n").map(String.init)
        return names.count == 1 ? names[0] : "origin"
    }

    public func fetch(remote: String?, prune: Bool, onProgress: (@Sendable (String) -> Void)? = nil,
                      environment extra: [String: String] = [:]) async throws {
        var args = ["fetch", "--progress"]
        if prune { args.append("--prune") }
        if let remote { args.append(remote) } else { args.append("--all") }
        let urls = await remoteURLs(remote, push: false)
        try await runner.run(args, environment: extra, credentialURLs: urls, onProgress: onProgress)
    }

    public func pull(mode: PullMode, onProgress: (@Sendable (String) -> Void)? = nil) async throws {
        let flag: String
        switch mode {
        case .merge: flag = "--no-rebase"
        case .rebase: flag = "--rebase"
        case .fastForwardOnly: flag = "--ff-only"
        }
        var urls: [String] = []
        if let remote = await pullRemote() { urls = await remoteURLs(remote, push: false) }
        try await runner.run(["pull", "--progress", flag], credentialURLs: urls, onProgress: onProgress)
    }

    public func push(remote: String, localBranch: String, remoteBranch: String, setUpstream: Bool, force: Bool,
                     onProgress: (@Sendable (String) -> Void)? = nil) async throws {
        var args = ["push", "--progress"]
        if setUpstream { args.append("--set-upstream") }
        if force { args.append("--force-with-lease") }
        args += [remote, "refs/heads/\(localBranch):refs/heads/\(remoteBranch)"]
        try await runner.run(args, credentialURLs: await remoteURLs(remote, push: true), onProgress: onProgress)
    }

    /// Đẩy một commit bất kỳ lên nhánh trên remote (dùng để khôi phục nhánh remote vừa xoá).
    public func pushCommit(_ sha: String, remote: String, branch: String, onProgress: (@Sendable (String) -> Void)? = nil) async throws {
        try await runner.run(["push", "--progress", remote, "\(sha):refs/heads/\(branch)"],
                             credentialURLs: await remoteURLs(remote, push: true), onProgress: onProgress)
    }

    public func deleteRemoteBranch(remote: String, branch: String, onProgress: (@Sendable (String) -> Void)? = nil) async throws {
        try await runner.run(["push", "--progress", remote, "--delete", "refs/heads/\(branch)"],
                             credentialURLs: await remoteURLs(remote, push: true), onProgress: onProgress)
    }

    public func pushTag(remote: String, tag: String, onProgress: (@Sendable (String) -> Void)? = nil) async throws {
        try await runner.run(["push", "--progress", remote, "refs/tags/\(tag)"],
                             credentialURLs: await remoteURLs(remote, push: true), onProgress: onProgress)
    }

    public func pushAllTags(remote: String, onProgress: (@Sendable (String) -> Void)? = nil) async throws {
        try await runner.run(["push", "--progress", remote, "--tags"], credentialURLs: await remoteURLs(remote, push: true),
                             onProgress: onProgress)
    }

    public func deleteRemoteTag(remote: String, tag: String) async throws {
        try await runner.run(["push", remote, "--delete", "refs/tags/\(tag)"], credentialURLs: await remoteURLs(remote, push: true))
    }

    public func addRemote(name: String, url: String) async throws {
        try await runner.run(["remote", "add", name, url])
    }

    public func removeRemote(name: String) async throws {
        try await runner.run(["remote", "remove", name])
    }

    // MARK: - Stash

    public func stashPush(message: String?, includeUntracked: Bool) async throws {
        var args = ["stash", "push"]
        if includeUntracked { args.append("--include-untracked") }
        if let message, !message.isEmpty { args += ["--message", message] }
        try await runner.run(args)
    }

    public func stashApply(_ selector: String, restoreIndex: Bool = false) async throws {
        try await runner.run(["stash", "apply"] + (restoreIndex ? ["--index"] : []) + [selector])
    }

    public func stashPop(_ selector: String) async throws {
        try await runner.run(["stash", "pop", selector])
    }

    public func stashDrop(_ selector: String) async throws {
        try await runner.run(["stash", "drop", selector])
    }

    /// Đưa lại một commit stash vào danh sách stash (hoàn tác "xoá stash").
    public func stashStore(sha: String, message: String) async throws {
        try await runner.run(["stash", "store", "-m", message, sha])
    }

    /// File trong stash: thay đổi đã track (so với HEAD lúc stash) + file chưa track (cha thứ 3).
    public func stashFiles(_ stash: Stash) async throws -> [FileChange] {
        var files = try await changedFiles(commit: stash.sha, parent: stash.parents.first)
        if stash.parents.count >= 3 {
            let untracked = try await changedFiles(commit: stash.parents[2], parent: nil)
            files += untracked.map { FileChange(path: $0.path, kind: .untracked) }
        }
        return files
    }

    public func stashDiff(_ stash: Stash, file: FileChange, ignoreWhitespace: Bool = false) async throws -> FileDiff? {
        if file.kind == .untracked, stash.parents.count >= 3 {
            return try await diff(commit: stash.parents[2], parent: nil, file: file, ignoreWhitespace: ignoreWhitespace)
        }
        return try await diff(commit: stash.sha, parent: stash.parents.first, file: file, ignoreWhitespace: ignoreWhitespace)
    }

    // MARK: - Tag

    public func createTag(_ name: String, at rev: String, message: String?) async throws {
        if let message, !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            try await runner.run(["tag", "-a", name, "-m", message, rev])
        } else {
            try await runner.run(["tag", name, rev])
        }
    }

    public func deleteTag(_ name: String) async throws {
        try await runner.run(["tag", "-d", name])
    }

    // MARK: - Tạo / clone repository

    public static func clone(url: String, to destination: URL, environment: GitEnvironmentStore,
                             onProgress: (@Sendable (String) -> Void)? = nil) async throws {
        let parent = destination.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true)
        let runner = GitRunner(environmentStore: environment, workingDirectory: parent)
        try await runner.run(["clone", "--progress", "--", url, destination.path], credentialURLs: [url], onProgress: onProgress)
    }

    public static func initialize(at url: URL, environment: GitEnvironmentStore) async throws {
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        let runner = GitRunner(environmentStore: environment, workingDirectory: url)
        let configured = (try? await runner.output(["config", "--global", "--get", "init.defaultBranch"]))?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        var args = ["init"]
        if configured.isEmpty { args.append("--initial-branch=main") }
        args.append(url.path)
        try await runner.run(args)
    }

    /// Tên thư mục mặc định khi clone từ URL ("https://github.com/a/b.git" → "b").
    public static func defaultDirectoryName(forCloneURL url: String) -> String {
        var trimmed = url.trimmingCharacters(in: .whitespacesAndNewlines)
        while trimmed.hasSuffix("/") { trimmed.removeLast() }
        if trimmed.hasSuffix(".git") { trimmed.removeLast(4) }
        let separators = CharacterSet(charactersIn: "/:")
        let last = trimmed.components(separatedBy: separators).last ?? ""
        return last.isEmpty ? "repo" : last
    }
}
