import Foundation

/// Việc làm với một commit trong interactive rebase (như GitKraken).
public enum RebaseAction: String, Sendable, CaseIterable {
    /// Giữ nguyên.
    case pick
    /// Giữ thay đổi, sửa lời commit.
    case reword
    /// Gộp vào commit phía trước (cũ hơn), nối lời của cả hai.
    case squash
    /// Gộp vào commit phía trước, bỏ lời của commit này.
    case fixup
    /// Bỏ commit.
    case drop
}

/// Một dòng của kế hoạch rebase. Kế hoạch xếp từ cũ tới mới, đúng thứ tự git áp dụng.
public struct RebaseStep: Sendable, Equatable, Identifiable {
    public var commit: Commit
    public var action: RebaseAction
    /// Lời commit mới khi `action == .reword`.
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

    /// Lý do kế hoạch không chạy được (nil là hợp lệ).
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

    /// Nội dung file todo cho `git rebase -i`. Sửa lời commit = `pick` rồi `exec git commit --amend` với file lời
    /// mới (không cần mở trình soạn thảo); `messageFile(i)` là đường dẫn file lời cho dòng thứ i.
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

    /// Bọc trong nháy đơn cho shell ('a b' → 'a b', it's → 'it'\''s').
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
    /// Rebase xong nhưng trả lại thay đổi chưa commit (đã tự cất) bị xung đột — thay đổi vẫn còn trong stash.
    case autostashConflict
}

extension GitRepository {
    /// `ancestor` có nằm trong lịch sử của `descendant` không.
    public func isAncestor(_ ancestor: String, of descendant: String) async -> Bool {
        (try? await runner.run(["merge-base", "--is-ancestor", ancestor, descendant])) != nil
    }

    /// Các commit sẽ được viết lại khi interactive rebase từ sau `base` tới HEAD, cũ trước mới sau.
    public func rebaseCommits(after base: String) async throws -> [Commit] {
        guard await isAncestor(base, of: "HEAD") else {
            throw RebaseError.notOnCurrentBranch(base)
        }
        let output = try await runner.run(["log", "-z", "--format=\(GitParsers.logFormat)", "--reverse", "--topo-order",
                                           "\(base)..HEAD", "--"])
        return GitParsers.parseLog(output.stdout)
    }

    /// Interactive rebase nhánh hiện tại lên `base` theo kế hoạch `steps` (cũ trước mới sau): git đọc file todo do
    /// Thaigit soạn sẵn qua GIT_SEQUENCE_EDITOR, không mở trình soạn thảo nào. Thay đổi chưa commit được tự cất rồi
    /// trả lại (`--autostash`). Gặp xung đột thì git dừng giữa chừng như rebase thường (Tiếp tục / Bỏ qua / Huỷ).
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
        // File lời commit còn cần khi rebase dừng vì xung đột (bước exec chạy lúc "Tiếp tục"); xong thì dọn.
        if operationState() == nil { try? FileManager.default.removeItem(at: directory) }
        let text = output.stdoutString + output.stderrString
        return text.contains("autostash resulted in conflicts") ? .autostashConflict : .done
    }
}
