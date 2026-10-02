import Foundation

/// Kết quả `git blame`: từng dòng của file thuộc commit nào.
public struct Blame: Sendable, Equatable {
    public struct CommitInfo: Sendable, Equatable {
        public var sha: String
        public var author: String
        public var email: String
        public var date: Date
        public var summary: String

        /// Dòng chưa commit (blame trên working tree).
        public var isUncommitted: Bool { sha.allSatisfy { $0 == "0" } }
        public var shortSHA: String { String(sha.prefix(7)) }
    }

    public struct Line: Sendable, Equatable, Identifiable {
        /// Số dòng trong file (bắt đầu từ 1).
        public var number: Int
        public var text: String
        public var sha: String
        /// Dòng đầu của một nhóm dòng liền nhau cùng commit (chỉ dòng này hiện tác giả / lời commit).
        public var startsGroup: Bool

        public var id: Int { number }
    }

    public var lines: [Line]
    public var commits: [String: CommitInfo]

    /// Parse `git blame --porcelain`: mỗi dòng mở đầu bằng "<sha> <dòng gốc> <dòng mới> [số dòng trong nhóm]",
    /// thông tin commit (author, author-mail, author-time, summary…) chỉ có ở lần đầu commit xuất hiện, nội dung dòng
    /// bắt đầu bằng tab. Nội dung không phải UTF-8 được giải mã lỏng (chỉ để xem).
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
    /// Blame `path` tại `rev` (nil: bản trong working tree, kể cả dòng chưa commit). `-M -C`: dòng chuyển chỗ / chép
    /// từ file khác vẫn tính về commit gốc. `--no-textconv`: không chạy lệnh `diff.*.textconv` do repo tự đặt.
    public func blame(path: String, at rev: String? = nil) async throws -> Blame {
        var args = ["blame", "--porcelain", "--no-textconv", "-M", "-C"]
        if let rev { args.append(rev) }
        args += ["--", path]
        let output = try await runner.run(args, environment: ["GIT_LITERAL_PATHSPECS": "1"])
        return Blame.parse(output.stdout)
    }
}
