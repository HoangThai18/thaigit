import Foundation

/// The snapshot timeline of a working tree — the same spec as the Tauri app
/// (`packages/contracts/snapshot.json`; the tests compare against that file and `snapshot.vectors.json`). Each
/// worktree gets a `refs/worktree/thaigit/snapshots` ref, and each milestone is one reflog entry of it (of the
/// `refs/stash` kind). A snapshot commit is the tree of the ENTIRE working tree (honouring .gitignore) built
/// through a temporary index inside the git dir — the user's real index, branches, stash and HEAD are never
/// touched.
public enum SnapshotReason: String, Sendable, CaseIterable {
    case auto
    case beforeRestore = "before-restore"
    case manual
}

public struct SnapshotMeta: Equatable, Sendable {
    public let reason: SnapshotReason
    /// How many files differed from HEAD at capture time; nil when missing or invalid.
    public let files: Int?

    public init(reason: SnapshotReason, files: Int?) {
        self.reason = reason
        self.files = files
    }
}

public struct SnapshotEntry: Equatable, Sendable, Identifiable {
    /// Position in the reflog (0 = newest) — used to delete it (`ref@{index}`).
    public let index: Int
    public let sha: String
    public let tree: String
    /// When it was captured (seconds).
    public let time: Int
    public let reason: SnapshotReason
    public let files: Int?

    public var id: String { "\(index)-\(sha)" }
    public var date: Date { Date(timeIntervalSince1970: TimeInterval(time)) }
}

public struct SnapshotRestoreResult: Sendable {
    /// The milestone captured right before a restore — restoring to it is Undo.
    public let before: SnapshotEntry
    public let restored: [String]
    /// Untracked files created after the milestone, moved to the Trash.
    public let trashed: [String]
}

public enum SnapshotSpec {
    public static let ref = "refs/worktree/thaigit/snapshots"
    public static let indexFile = "thaigit/snapshot.index"
    public static let messageHeader = "thaigit-snapshot v1"
    public static let reflogMessage = "thaigit-snapshot"
    public static let identityName = "Thaigit"
    public static let identityEmail = "snapshot@thaigit.invalid"
    public static let quietSeconds: TimeInterval = 20
    public static let minIntervalSeconds: TimeInterval = 120
    public static let pruneIntervalSeconds: TimeInterval = 3600
    public static let defaultKeepDays = 7
    public static let defaultKeepCount = 300

    /// The ref's directory (the watcher ignores every change inside it).
    public static var refDirectory: String { String(ref[...ref.lastIndex(of: "/")!]) }

    static var identityEnvironment: [String: String] {
        ["GIT_AUTHOR_NAME": identityName, "GIT_AUTHOR_EMAIL": identityEmail,
         "GIT_COMMITTER_NAME": identityName, "GIT_COMMITTER_EMAIL": identityEmail]
    }

    public static func formatMessage(reason: SnapshotReason, files: Int) -> String {
        "\(messageHeader)\n\nreason: \(reason.rawValue)\nfiles: \(files)\n"
    }

    /// The snapshot commit's message (%B) → metadata; nil when the first line isn't `messageHeader`.
    public static func parseMessage(_ message: String) -> SnapshotMeta? {
        // Swift treats "\r\n" as ONE character, so normalise before splitting lines.
        let normalized = message.replacingOccurrences(of: "\r\n", with: "\n")
        let lines = normalized.split(separator: "\n", omittingEmptySubsequences: false).map { line in
            line.hasSuffix("\r") ? String(line.dropLast()) : String(line)
        }
        guard lines.first == messageHeader else { return nil }
        var reason = SnapshotReason.auto
        var files: Int?
        for line in lines.dropFirst() {
            guard let colon = line.firstIndex(of: ":") else { continue }
            let key = line[..<colon].trimmingCharacters(in: .whitespaces)
            let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            if key == "reason" {
                reason = SnapshotReason(rawValue: value) ?? .auto
            } else if key == "files" {
                files = !value.isEmpty && value.allSatisfy(\.isASCII) && value.allSatisfy(\.isNumber) ? Int(value) : nil
            }
        }
        return SnapshotMeta(reason: reason, files: files)
    }

    /// Reflog entry indices to delete, descending. Entry 0 is never deleted; an entry is deleted when `index >= keepCount` or
    /// it's older than `keepDays` days (a milestone dated in the future by clock skew is kept).
    public static func selectExpired(entries: [(index: Int, time: Int)], now: Int, keepDays: Int, keepCount: Int) -> [Int] {
        let maxAge = keepDays * 86_400
        return entries
            .filter { $0.index > 0 && ($0.index >= keepCount || now - $0.time > maxAge) }
            .map(\.index)
            .sorted(by: >)
    }
}

extension GitRepository {
    private static let snapshotLiteral = ["GIT_LITERAL_PATHSPECS": "1"]
    /// How many paths / reflog entries per call (so the command line doesn't get too long).
    private static let snapshotBatch = 100

    /// A runner that doesn't write the command log: automatic capture every few minutes would flood it.
    private var quietRunner: GitRunner {
        GitRunner(environmentStore: runner.environmentStore, workingDirectory: runner.workingDirectory, logger: nil)
    }

    /// Create `<gitDir>/thaigit/` (a real directory, not a symlink) and return the temporary index; `reset` deletes the temporary index and its lock file.
    private func snapshotIndex(reset: Bool) throws -> URL {
        let parts = SnapshotSpec.indexFile.split(separator: "/").map(String.init)
        let dir = gitDir.appendingPathComponent(parts[0], isDirectory: true)
        let manager = FileManager.default
        if let type = try? manager.attributesOfItem(atPath: dir.path)[.type] as? FileAttributeType {
            guard type == .typeDirectory else {
                throw RepositoryError.invalidName(SnapshotSpec.indexFile)
            }
        } else {
            try manager.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        let index = dir.appendingPathComponent(parts[1])
        if reset {
            for url in [index, dir.appendingPathComponent(parts[1] + ".lock")] where manager.fileExists(atPath: url.path) {
                try manager.removeItem(at: url)
            }
        }
        return index
    }

    /// The milestones, newest first (reflog entries that aren't Thaigit snapshots are skipped, but their reflog indices stay accurate).
    public func snapshots(limit: Int? = nil) async throws -> [SnapshotEntry] {
        try await readSnapshots(runner: runner, limit: limit)
    }

    /// Capture the working tree. A tree identical to the newest milestone returns that milestone. `quiet` (the default for the `.auto` reason): don't write the command log.
    @discardableResult
    public func takeSnapshot(reason: SnapshotReason, quiet: Bool? = nil) async throws -> SnapshotEntry {
        let runner = (quiet ?? (reason == .auto)) ? quietRunner : self.runner
        var index = try snapshotIndex(reset: false)
        do {
            try await runner.run(["add", "-A"], environment: ["GIT_INDEX_FILE": index.path])
        } catch let error as GitError where error.contains(".lock") && error.contains("exists") {
            // An orphaned lock when the app quits between `git add` calls: the temporary index is just a buffer, rebuilt from scratch.
            index = try snapshotIndex(reset: true)
            try await runner.run(["add", "-A"], environment: ["GIT_INDEX_FILE": index.path])
        }
        let indexEnvironment = ["GIT_INDEX_FILE": index.path]
        let tree = try await runner.output(["write-tree"], environment: indexEnvironment)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if let latest = try await readSnapshots(runner: runner, limit: 1).first, latest.index == 0, latest.tree == tree {
            return latest
        }
        let headOutput = try await runner.run(["rev-parse", "--verify", "-q", "HEAD"], acceptExitCodes: [0, 1])
        let head = headOutput.exitCode == 0 ? headOutput.stdoutString.trimmingCharacters(in: .whitespacesAndNewlines) : nil
        var changedEnvironment = indexEnvironment
        changedEnvironment["GIT_OPTIONAL_LOCKS"] = "0"
        let changed = try await runner.output(["diff", "--cached", "--name-only", "-z"], environment: changedEnvironment)
        let files = changed.split(separator: "\0").count
        var arguments = ["commit-tree", tree]
        if let head { arguments += ["-p", head] }
        arguments += ["--no-gpg-sign", "-F", "-"]
        let sha = try await runner.output(arguments, input: Data(SnapshotSpec.formatMessage(reason: reason, files: files).utf8),
                                          environment: SnapshotSpec.identityEnvironment)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        try await runner.run(["update-ref", "--create-reflog", "-m", SnapshotSpec.reflogMessage, SnapshotSpec.ref, sha])
        return try await readSnapshots(runner: runner, limit: 1).first
            ?? SnapshotEntry(index: 0, sha: sha, tree: tree, time: Int(Date().timeIntervalSince1970), reason: reason, files: files)
    }

    /// Files that differ between two milestones (`from` → `to`).
    public func snapshotDifferences(from: String, to: String) async throws -> [FileChange] {
        try await changedFiles(commit: to, parent: from)
    }

    /// Bring the working tree (all of it, or only `paths` — files or directories) back to milestone `target`. A
    /// "before restore" milestone is always captured first; only the working tree is written. Untracked files
    /// created after the milestone are moved to the Trash rather than deleted.
    public func restoreSnapshot(_ target: String, paths: [String]?) async throws -> SnapshotRestoreResult {
        let before = try await takeSnapshot(reason: .beforeRestore, quiet: false)
        let diff = try await runner.run(["diff-tree", "-r", "-z", "--name-status", "--no-renames", target, before.sha])
        let changes = GitParsers.parseNameStatus(diff.stdout).filter { change in
            guard let paths else { return true }
            return paths.contains { change.path == $0 || change.path.hasPrefix($0 + "/") }
        }
        guard !changes.isEmpty else { return SnapshotRestoreResult(before: before, restored: [], trashed: []) }

        let added = changes.filter { $0.kind == .added }.map(\.path)
        var tracked = Set<String>()
        var start = 0
        while start < added.count {
            let batch = Array(added[start..<min(start + Self.snapshotBatch, added.count)])
            let output = try await runner.output(["ls-files", "-z", "--cached", "--"] + batch, environment: Self.snapshotLiteral)
            tracked.formUnion(output.split(separator: "\0").map(String.init))
            start += Self.snapshotBatch
        }
        let untracked = added.filter { !tracked.contains($0) }
        let untrackedSet = Set(untracked)
        let restored = changes.map(\.path).filter { !untrackedSet.contains($0) }
        if !untracked.isEmpty { _ = try trashUntracked(paths: untracked) }
        if !restored.isEmpty {
            try await runner.run(["restore", "--source=\(target)", "--worktree", "--pathspec-from-file=-", "--pathspec-file-nul"],
                                 input: restored.nulSeparatedData, environment: Self.snapshotLiteral)
        }
        return SnapshotRestoreResult(before: before, restored: restored, trashed: untracked)
    }

    /// Delete milestones that are too old / too numerous (the shared rule); returns how many were deleted.
    @discardableResult
    public func pruneSnapshots(now: Int, keepDays: Int, keepCount: Int) async throws -> Int {
        let runner = quietRunner
        guard try await snapshotRefExists(runner: runner) else { return 0 }
        let output = try await runner.output(["log", "-g", "-z", "--format=%ct", SnapshotSpec.ref, "--"])
        let entries = output.split(separator: "\0", omittingEmptySubsequences: true).enumerated().map { item in
            (index: item.offset, time: Int(item.element.trimmingCharacters(in: .whitespacesAndNewlines)) ?? 0)
        }
        let expired = SnapshotSpec.selectExpired(entries: entries, now: now, keepDays: keepDays, keepCount: keepCount)
        var start = 0
        while start < expired.count {
            let batch = expired[start..<min(start + Self.snapshotBatch, expired.count)].map { "\(SnapshotSpec.ref)@{\($0)}" }
            try await runner.run(["reflog", "delete", "--rewrite"] + batch)
            start += Self.snapshotBatch
        }
        return expired.count
    }

    private func snapshotRefExists(runner: GitRunner) async throws -> Bool {
        try await runner.run(["rev-parse", "--verify", "-q", SnapshotSpec.ref], acceptExitCodes: [0, 1]).exitCode == 0
    }

    private func readSnapshots(runner: GitRunner, limit: Int?) async throws -> [SnapshotEntry] {
        guard try await snapshotRefExists(runner: runner) else { return [] }
        var arguments = ["log", "-g", "-z", "--format=%H%x1f%T%x1f%ct%x1f%B"]
        if let limit { arguments.append("--max-count=\(max(1, limit))") }
        let output = try await runner.output(arguments + [SnapshotSpec.ref, "--"])
        var entries: [SnapshotEntry] = []
        for (index, record) in output.split(separator: "\0", omittingEmptySubsequences: false).enumerated() where !record.isEmpty {
            let fields = record.split(separator: "\u{1f}", maxSplits: 3, omittingEmptySubsequences: false).map(String.init)
            guard fields.count == 4, let meta = SnapshotSpec.parseMessage(fields[3]) else { continue }
            entries.append(SnapshotEntry(index: index, sha: fields[0], tree: fields[1], time: Int(fields[2]) ?? 0,
                                         reason: meta.reason, files: meta.files))
        }
        return entries
    }
}
