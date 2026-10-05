import Foundation

/// The result of `git blame`: which commit each line of the file belongs to.
public struct Blame: Sendable, Equatable {
    public struct CommitInfo: Sendable, Equatable {
        public var sha: String
        public var author: String
        public var email: String
        public var date: Date
        public var summary: String

        /// An uncommitted line (blame over the working tree).
        public var isUncommitted: Bool { sha.allSatisfy { $0 == "0" } }
        public var shortSHA: String { String(sha.prefix(7)) }
    }

    public struct Line: Sendable, Equatable, Identifiable {
        /// Line number within the file (1-based).
        public var number: Int
        public var text: String
        public var sha: String
        /// The first line of a run of adjacent lines from the same commit (only this line shows the author / message).
        public var startsGroup: Bool

        public var id: Int { number }
    }

    public var lines: [Line]
    public var commits: [String: CommitInfo]

    /// Parse `git blame --porcelain`: each record starts with "<sha> <original line> <new line> [lines in group]",
    /// the commit info (author, author-mail, author-time, summary…) only appears the first time a commit shows up,
    /// and the line content starts with a tab. Non-UTF-8 content is decoded leniently (display only).
    public static func parse(_ data: Data) -> Blame {
        var lines: [Line] = []
        var commits: [String: CommitInfo] = [:]
        var current: String?
        var previousSHA: String?
        for raw in data.split(separator: UInt8(ascii: "\n"), omittingEmptySubsequences: false) {
            if raw.first == UInt8(ascii: "\t") {
                guard let sha = current else { continue }
                var text = String(decoding: raw.dropFirst(), as: UTF8.self)
                if text.hasSuffix("\r") { text.removeLast() }
                lines.append(Line(number: lines.count + 1, text: text, sha: sha, startsGroup: sha != previousSHA))
                previousSHA = sha
                continue
            }
            let line = String(decoding: raw, as: UTF8.self)
            let parts = line.split(separator: " ", maxSplits: 1, omittingEmptySubsequences: false)
            guard let key = parts.first.map(String.init), !key.isEmpty else { continue }
            let value = parts.count > 1 ? String(parts[1]) : ""
            if key.count == 40 || key.count == 64, key.allSatisfy(\.isHexDigit) {
                current = key
                if commits[key] == nil {
                    commits[key] = CommitInfo(sha: key, author: "", email: "", date: Date(timeIntervalSince1970: 0), summary: "")
                }
                continue
            }
            guard let sha = current else { continue }
            switch key {
            case "author": commits[sha]?.author = value
            case "author-mail": commits[sha]?.email = value.trimmingCharacters(in: CharacterSet(charactersIn: "<>"))
            case "author-time": commits[sha]?.date = Date(timeIntervalSince1970: TimeInterval(value) ?? 0)
            case "summary": commits[sha]?.summary = value
            default: break
            }
        }
        return Blame(lines: lines, commits: commits)
    }
}

extension GitRepository {
    /// Blame `path` at `rev` (nil: the working tree version, including uncommitted lines). `-M -C`: a line that moved or
    /// was copied from another file still counts for the original commit. `--no-textconv`: never run a `diff.*.textconv` command the repo defines.
    public func blame(path: String, at rev: String? = nil) async throws -> Blame {
        var args = ["blame", "--porcelain", "--no-textconv", "-M", "-C"]
        if let rev { args.append(rev) }
        args += ["--", path]
        let output = try await runner.run(args, environment: ["GIT_LITERAL_PATHSPECS": "1"])
        return Blame.parse(output.stdout)
    }
}
