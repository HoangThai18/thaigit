import Foundation

/// What to do with one commit during an interactive rebase (like GitKraken).
public enum RebaseAction: String, Sendable, CaseIterable {
    /// Keep as-is.
    case pick
    /// Keep the changes, edit the commit message.
    case reword
    /// Squash into the preceding (older) commit, joining both messages.
    case squash
    /// Squash into the preceding commit, dropping this commit's message.
    case fixup
    /// Drop the commit.
    case drop
}

/// One line of a rebase plan. A plan is ordered old → new, the order git applies it in.
public struct RebaseStep: Sendable, Equatable, Identifiable {
    public var commit: Commit
    public var action: RebaseAction
    /// The new commit message when `action == .reword`.
    public var message: String?

    public init(commit: Commit, action: RebaseAction = .pick, message: String? = nil) {
        self.commit = commit
        self.action = action
        self.message = message
    }

    public var id: String { commit.id }
}

public enum RebasePlan {
    public static let unchanged = String(localized: "Chưa có thay đổi nào.")

    /// Why the plan can't run (nil means it's fine).
    public static func problem(_ steps: [RebaseStep], original: [Commit]) -> String? {
        if steps.isEmpty { return String(localized: "Không có commit nào để rebase.") }
        if steps.contains(where: { $0.commit.isMerge }) {
            return String(localized: "Đoạn này có commit merge — Thaigit chưa hỗ trợ interactive rebase qua commit merge.")
        }
        let kept = steps.filter { $0.action != .drop }
        if let first = kept.first, first.action == .squash || first.action == .fixup {
            return String(localized: "Commit cũ nhất còn lại không gộp được (không có commit nào phía trước để gộp vào).")
        }
        if steps.contains(where: { $0.action == .reword && ($0.message ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) {
            return String(localized: "Message mới không được để trống.")
        }
        if steps.map(\.commit.id) == original.map(\.id), steps.allSatisfy({ $0.action == .pick }) {
            return unchanged
        }
        return nil
    }

    /// A prebuilt plan for a quick action on one commit (right-click menu): every commit `pick`, with `sha` set to `action`.
    public static func single(_ commits: [Commit], sha: String, action: RebaseAction, message: String? = nil) -> [RebaseStep] {
        commits.map { commit in
            commit.id == sha ? RebaseStep(commit: commit, action: action, message: message) : RebaseStep(commit: commit)
        }
    }

    /// Swap `sha` with the immediately following commit (`up` — newer) or the preceding one (`down` — older); nil when there's nothing to swap.
    public static func swapped(_ commits: [Commit], sha: String, up: Bool) -> [RebaseStep]? {
        var steps = commits.map { RebaseStep(commit: $0) }
        guard let index = steps.firstIndex(where: { $0.commit.id == sha }) else { return nil }
        let other = up ? index + 1 : index - 1
        guard steps.indices.contains(other) else { return nil }
        steps.swapAt(index, other)
        return steps
    }

    /// The todo file content for `git rebase -i`. Rewording a message is `pick` followed by
    /// `exec git commit --amend` with the new message file (no editor needed); `messageFile(i)` is the message
    /// file path for line i.
    static func todo(_ steps: [RebaseStep], messageFile: (Int) -> String) -> String {
        var lines: [String] = []
        for (index, step) in steps.enumerated() {
            switch step.action {
            case .pick: lines.append("pick \(step.commit.id)")
            case .reword:
                lines.append("pick \(step.commit.id)")
                lines.append("exec git commit --amend --only --no-verify --allow-empty --cleanup=whitespace -F \(shellQuote(messageFile(index)))")
            case .squash: lines.append("squash \(step.commit.id)")
            case .fixup: lines.append("fixup \(step.commit.id)")
            case .drop: lines.append("drop \(step.commit.id)")
            }
        }
        return lines.joined(separator: "\n") + "\n"
    }

    /// Wrapped in single quotes for the shell ('a b' → 'a b', it's → 'it'\''s').
    static func shellQuote(_ text: String) -> String {
        "'" + text.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }
}

public enum RebaseError: LocalizedError, Sendable {
    case notOnCurrentBranch(String)

    public var errorDescription: String? {
        switch self {
        case .notOnCurrentBranch(let sha): return String(localized: "Commit \(String(sha.prefix(7))) không nằm trên nhánh hiện tại nên không rebase từ đó được.")
        }
    }
}

public enum InteractiveRebaseResult: Sendable, Equatable {
    case done
    /// The rebase finished but the returned uncommitted changes (which it had stashed itself) conflicted — the changes are still in the stash.
    case autostashConflict
}

extension GitRepository {
    /// Whether `ancestor` is in `descendant`'s history.
    public func isAncestor(_ ancestor: String, of descendant: String) async -> Bool {
        (try? await runner.run(["merge-base", "--is-ancestor", ancestor, descendant])) != nil
    }

    /// The commits an interactive rebase from after `base` up to HEAD would rewrite, oldest first.
    public func rebaseCommits(after base: String) async throws -> [Commit] {
        guard await isAncestor(base, of: "HEAD") else {
            throw RebaseError.notOnCurrentBranch(base)
        }
        let output = try await runner.run(["log", "-z", "--format=\(GitParsers.logFormat)", "--reverse", "--topo-order",
                                           "\(base)..HEAD", "--"])
        return GitParsers.parseLog(output.stdout)
    }

    /// Interactive-rebases the current branch onto `base` following the plan `steps` (old → new): git reads a todo
    /// file Thaigit composed up front through GIT_SEQUENCE_EDITOR, so no editor is opened. Uncommitted changes are
    /// stashed automatically and restored afterwards (`--autostash`). On a conflict git stops midway like a
    /// normal rebase (Continue / Skip / Cancel).
    public func interactiveRebase(onto base: String, steps: [RebaseStep]) async throws -> InteractiveRebaseResult {
        let directory = gitDir.appendingPathComponent("thaigit-rebase", isDirectory: true)
        try? FileManager.default.removeItem(at: directory)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        func messageFile(_ index: Int) -> String { directory.appendingPathComponent("message-\(index)").path }
        for (index, step) in steps.enumerated() where step.action == .reword {
            try Data((step.message ?? "").utf8).write(to: URL(fileURLWithPath: messageFile(index)))
        }
        let todo = directory.appendingPathComponent("todo")
        try Data(RebasePlan.todo(steps, messageFile: messageFile).utf8).write(to: todo)
        let output = try await runner.run(["rebase", "-i", "--autostash", base],
                                          environment: ["GIT_SEQUENCE_EDITOR": "cp " + RebasePlan.shellQuote(todo.path)])
        // The commit message file is still needed when the rebase stops on a conflict (the exec step runs when you press Continue); clean it up once done.
        if operationState() == nil { try? FileManager.default.removeItem(at: directory) }
        let text = output.stdoutString + output.stderrString
        return text.contains("autostash resulted in conflicts") ? .autostashConflict : .done
    }
}
