import Foundation

/// Một submodule (`git submodule status`).
public struct Submodule: Sendable, Equatable, Identifiable {
    public enum State: Sendable, Equatable {
        /// Chưa init / chưa clone về.
        case uninitialized
        case upToDate
        /// Đang ở commit khác với commit repo cha ghi nhận.
        case modified
        case conflicted
    }

    public let path: String
    public let sha: String
    public let state: State
    public var id: String { path }
}

/// Một worktree (`git worktree list --porcelain`).
public struct Worktree: Sendable, Equatable, Identifiable {
    public let path: String
    public let head: String?
    /// Tên nhánh (không có refs/heads/), nil khi HEAD tách rời.
    public let branch: String?
    public let isMain: Bool
    public let isBare: Bool
    public let isLocked: Bool
    public let isPrunable: Bool
    public var id: String { path }
}

extension GitRepository {
    // MARK: - Submodule

    public func submodules() async throws -> [Submodule] {
        // Không có .gitmodules thì không có submodule: khỏi chạy lệnh.
        guard FileManager.default.fileExists(atPath: root.appendingPathComponent(".gitmodules").path) else { return [] }
        return Self.parseSubmoduleStatus(try await runner.output(["submodule", "status"]))
    }

    static func parseSubmoduleStatus(_ text: String) -> [Submodule] {
        text.split(separator: "\n").compactMap { line in
            guard let first = line.first else { return nil }
            let state: Submodule.State
            switch first {
            case "-": state = .uninitialized
            case "+": state = .modified
            case "U": state = .conflicted
            default: state = .upToDate
            }
            let rest = line.dropFirst().split(separator: " ", maxSplits: 1, omittingEmptySubsequences: true)
            guard rest.count == 2 else { return nil }
            var path = String(rest[1])
            // Đuôi " (mô tả)" của git describe.
            if path.hasSuffix(")"), let open = path.range(of: " (", options: .backwards) { path = String(path[..<open.lowerBound]) }
            return Submodule(path: path, sha: String(rest[0]), state: state)
        }
    }

    /// Init (nếu cần) và đưa submodule về đúng commit repo cha ghi nhận. `paths` rỗng: mọi submodule.
    /// Chặn giao thức `ext::` (chạy lệnh tuỳ ý từ URL trong .gitmodules).
    public func updateSubmodules(_ paths: [String] = [], onProgress: (@Sendable (String) -> Void)? = nil) async throws {
        let urls = await submoduleURLs()
        try await runner.run(["-c", "protocol.ext.allow=never", "submodule", "update", "--init", "--progress", "--"] + paths,
                             credentialURLs: urls, onProgress: onProgress)
    }

    private func submoduleURLs() async -> [String] {
        guard let output = try? await runner.output(["config", "-f", ".gitmodules", "--get-regexp", #"^submodule\..*\.url$"#]) else { return [] }
        return output.split(separator: "\n").compactMap { line in line.split(separator: " ", maxSplits: 1).last.map(String.init) }
    }

    // MARK: - Worktree

    public func worktrees() async throws -> [Worktree] {
        Self.parseWorktrees(try await runner.output(["worktree", "list", "--porcelain"]))
    }

    static func parseWorktrees(_ text: String) -> [Worktree] {
        var result: [Worktree] = []
        for block in text.components(separatedBy: "\n\n") {
            var path: String?, head: String?, branch: String?
            var bare = false, locked = false, prunable = false
            for line in block.split(separator: "\n") {
                if line.hasPrefix("worktree ") { path = String(line.dropFirst(9)) }
                else if line.hasPrefix("HEAD ") { head = String(line.dropFirst(5)) }
                else if line.hasPrefix("branch ") {
                    let ref = line.dropFirst(7)
                    branch = ref.hasPrefix("refs/heads/") ? String(ref.dropFirst(11)) : String(ref)
                }
                else if line == "bare" { bare = true }
                else if line.hasPrefix("locked") { locked = true }
                else if line.hasPrefix("prunable") { prunable = true }
            }
            guard let path else { continue }
            result.append(Worktree(path: path, head: head, branch: branch, isMain: result.isEmpty, isBare: bare,
                                   isLocked: locked, isPrunable: prunable))
        }
        return result
    }

    /// Tạo worktree ở `path`: checkout nhánh có sẵn `branch`, hoặc tạo nhánh mới `branch` từ `startPoint`.
    public func addWorktree(path: String, branch: String, createBranch: Bool, startPoint: String? = nil) async throws {
        var args = ["worktree", "add"]
        if createBranch { args += ["-b", branch, "--", path] + (startPoint.map { [$0] } ?? []) } else { args += ["--", path, branch] }
        try await runner.run(args)
    }

    public func removeWorktree(path: String, force: Bool) async throws {
        try await runner.run(["worktree", "remove"] + (force ? ["--force"] : []) + ["--", path])
    }

    public func pruneWorktrees() async throws {
        try await runner.run(["worktree", "prune"])
    }
}
