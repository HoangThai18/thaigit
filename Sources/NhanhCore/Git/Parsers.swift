import Foundation

/// Parsers for the machine-readable output of git's plumbing / porcelain commands.
public enum GitParsers {
    static let unitSeparator: Character = "\u{1f}"

    // MARK: - Log

    /// Used with `git log -z --format=...`: every commit ends with a NUL, fields separated by \x1f.
    public static let logFormat = "%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%cn%x1f%ce%x1f%ct%x1f%s"

    public static func parseLog(_ data: Data) -> [Commit] {
        let text = String(decoding: data, as: UTF8.self)
        var commits: [Commit] = []
        commits.reserveCapacity(text.count / 160)
        for rawRecord in text.split(separator: "\0", omittingEmptySubsequences: true) {
            let record = rawRecord.first == "\n" ? rawRecord.dropFirst() : rawRecord
            let fields = record.split(separator: unitSeparator, maxSplits: 8, omittingEmptySubsequences: false)
            guard fields.count == 9, fields[0].count >= 7 else { continue }
            let parents = fields[1].split(separator: " ").map(String.init)
            commits.append(Commit(
                id: String(fields[0]),
                parents: parents,
                authorName: String(fields[2]),
                authorEmail: String(fields[3]),
                authorDate: Date(timeIntervalSince1970: TimeInterval(fields[4]) ?? 0),
                committerName: String(fields[5]),
                committerEmail: String(fields[6]),
                commitDate: Date(timeIntervalSince1970: TimeInterval(fields[7]) ?? 0),
                subject: String(fields[8])
            ))
        }
        return commits
    }

    // MARK: - Refs

    /// Used with `git for-each-ref --format=...`: %1f is the character \x1f.
    public static let refFormat = "%(refname)%1f%(objectname)%1f%(*objectname)%1f%(upstream:short)%1f%(upstream:track,nobracket)%1f%(HEAD)%1f%(symref)%1f%(creatordate:unix)"

    public static func parseRefs(_ text: String) -> [GitRef] {
        var refs: [GitRef] = []
        for line in text.split(separator: "\n", omittingEmptySubsequences: true) {
            let f = line.split(separator: unitSeparator, omittingEmptySubsequences: false).map(String.init)
            guard f.count >= 7 else { continue }
            let fullName = f[0]
            // Skip symrefs like refs/remotes/origin/HEAD.
            if !f[6].isEmpty { continue }
            let kind: RefKind
            if fullName.hasPrefix("refs/heads/") {
                kind = .localBranch
            } else if fullName.hasPrefix("refs/remotes/") {
                kind = .remoteBranch
            } else if fullName.hasPrefix("refs/tags/") {
                kind = .tag
            } else {
                continue
            }
            let track = parseTrack(f[4])
            refs.append(GitRef(
                fullName: fullName,
                kind: kind,
                target: f[2].isEmpty ? f[1] : f[2],
                objectName: f[1],
                upstream: f[3].isEmpty ? nil : f[3],
                ahead: track.ahead,
                behind: track.behind,
                upstreamGone: track.gone,
                isHead: f[5] == "*",
                date: f.count > 7 ? TimeInterval(f[7]).map { Date(timeIntervalSince1970: $0) } : nil
            ))
        }
        return refs
    }

    /// "ahead 2, behind 1" | "gone" | ""
    static func parseTrack(_ text: String) -> (ahead: Int, behind: Int, gone: Bool) {
        if text == "gone" { return (0, 0, true) }
        var ahead = 0
        var behind = 0
        for part in text.split(separator: ",") {
            let token = part.trimmingCharacters(in: .whitespaces)
            if token.hasPrefix("ahead ") {
                ahead = Int(token.dropFirst(6)) ?? 0
            } else if token.hasPrefix("behind ") {
                behind = Int(token.dropFirst(7)) ?? 0
            }
        }
        return (ahead, behind, false)
    }

    // MARK: - Status (porcelain v2)

    /// Parse `git status --porcelain=v2 --branch --show-stash -z`.
    public static func parseStatus(_ data: Data) -> WorkingTreeStatus {
        let text = String(decoding: data, as: UTF8.self)
        let records = text.split(separator: "\0", omittingEmptySubsequences: true)
        var branchOID: String?
        var branchHead: String?
        var upstream: String?
        var ahead = 0
        var behind = 0
        var stashCount = 0
        var staged: [FileChange] = []
        var unstaged: [FileChange] = []
        var conflicts: [ConflictEntry] = []

        var index = 0
        while index < records.count {
            let record = records[index]
            index += 1

            if record.hasPrefix("# ") {
                let parts = record.dropFirst(2).split(separator: " ", maxSplits: 1, omittingEmptySubsequences: false)
                guard parts.count == 2 else { continue }
                let value = String(parts[1])
                switch parts[0] {
                case "branch.oid": branchOID = value == "(initial)" ? nil : value
                case "branch.head": branchHead = value
                case "branch.upstream": upstream = value
                case "branch.ab":
                    let ab = value.split(separator: " ")
                    if ab.count == 2 {
                        ahead = Int(ab[0].dropFirst()) ?? 0
                        behind = Int(ab[1].dropFirst()) ?? 0
                    }
                case "stash": stashCount = Int(value) ?? 0
                default: break
                }
                continue
            }

            guard let type = record.first else { continue }
            switch type {
            case "1":
                // 1 XY sub mH mI mW hH hI path
                let f = record.split(separator: " ", maxSplits: 8, omittingEmptySubsequences: false)
                guard f.count == 9 else { continue }
                let xy = Array(f[1])
                guard xy.count == 2 else { continue }
                append(x: xy[0], y: xy[1], path: String(f[8]), origPath: nil, staged: &staged, unstaged: &unstaged)
            case "2":
                // 2 XY sub mH mI mW hH hI Xscore path \0 origPath
                let f = record.split(separator: " ", maxSplits: 9, omittingEmptySubsequences: false)
                let origPath = index < records.count ? String(records[index]) : nil
                index += 1
                guard f.count == 10 else { continue }
                let xy = Array(f[1])
                guard xy.count == 2 else { continue }
                append(x: xy[0], y: xy[1], path: String(f[9]), origPath: origPath, staged: &staged, unstaged: &unstaged)
            case "u":
                // u XY sub m1 m2 m3 mW h1 h2 h3 path
                let f = record.split(separator: " ", maxSplits: 10, omittingEmptySubsequences: false)
                guard f.count == 11 else { continue }
                conflicts.append(ConflictEntry(path: String(f[10]), kind: ConflictKind(rawValue: String(f[1])) ?? .unknown))
            case "?":
                unstaged.append(FileChange(path: String(record.dropFirst(2)), kind: .untracked))
            default:
                break
            }
        }

        let head: HeadState
        if let branchHead, branchHead != "(detached)" {
            head = .branch(name: branchHead, oid: branchOID)
        } else if let branchOID {
            head = .detached(oid: branchOID)
        } else {
            head = .unknown
        }
        return WorkingTreeStatus(head: head, upstream: upstream, ahead: ahead, behind: behind,
                                 staged: staged, unstaged: unstaged, conflicts: conflicts, stashCount: stashCount)
    }

    private static func append(x: Character, y: Character, path: String, origPath: String?,
                               staged: inout [FileChange], unstaged: inout [FileChange]) {
        if x != "." {
            let kind = ChangeKind(code: x)
            staged.append(FileChange(path: path, oldPath: (kind == .renamed || kind == .copied) ? origPath : nil, kind: kind))
        }
        if y != "." {
            let kind = ChangeKind(code: y)
            unstaged.append(FileChange(path: path, oldPath: (kind == .renamed || kind == .copied) ? origPath : nil, kind: kind))
        }
    }

    // MARK: - Name-status

    /// Parse `git diff-tree -r -z --name-status -M ...`.
    public static func parseNameStatus(_ data: Data) -> [FileChange] {
        let tokens = String(decoding: data, as: UTF8.self).split(separator: "\0", omittingEmptySubsequences: false)
        var result: [FileChange] = []
        var index = 0
        while index < tokens.count {
            let status = tokens[index]
            index += 1
            guard let code = status.first else { continue }
            if code == "R" || code == "C" {
                guard index + 1 < tokens.count else { break }
                let old = String(tokens[index])
                let new = String(tokens[index + 1])
                index += 2
                result.append(FileChange(path: new, oldPath: old, kind: code == "R" ? .renamed : .copied))
            } else {
                guard index < tokens.count else { break }
                let path = String(tokens[index])
                index += 1
                guard !path.isEmpty else { continue }
                result.append(FileChange(path: path, kind: ChangeKind(code: code)))
            }
        }
        return result
    }

    // MARK: - Stash

    public static let stashFormat = "%gd%x1f%H%x1f%P%x1f%ct%x1f%gs"

    public static func parseStashList(_ data: Data) -> [Stash] {
        let text = String(decoding: data, as: UTF8.self)
        var stashes: [Stash] = []
        for rawRecord in text.split(separator: "\0", omittingEmptySubsequences: true) {
            let record = rawRecord.first == "\n" ? rawRecord.dropFirst() : rawRecord
            let f = record.split(separator: unitSeparator, maxSplits: 4, omittingEmptySubsequences: false)
            guard f.count == 5 else { continue }
            let selector = String(f[0])
            var stashIndex = stashes.count
            if let open = selector.firstIndex(of: "{"), let close = selector.firstIndex(of: "}"),
               let value = Int(selector[selector.index(after: open)..<close]) {
                stashIndex = value
            }
            stashes.append(Stash(
                index: stashIndex,
                selector: selector,
                sha: String(f[1]),
                parents: f[2].split(separator: " ").map(String.init),
                date: Date(timeIntervalSince1970: TimeInterval(f[3]) ?? 0),
                message: String(f[4])
            ))
        }
        return stashes
    }

    // MARK: - Remotes

    /// Parse `git remote -v`.
    public static func parseRemotes(_ text: String) -> [Remote] {
        var fetch: [String: String] = [:]
        var push: [String: String] = [:]
        var order: [String] = []
        for line in text.split(separator: "\n") {
            let parts = line.split(separator: "\t", maxSplits: 1)
            guard parts.count == 2 else { continue }
            let name = String(parts[0])
            var rest = String(parts[1])
            var isPush = false
            if rest.hasSuffix(" (push)") {
                isPush = true
                rest.removeLast(" (push)".count)
            } else if rest.hasSuffix(" (fetch)") {
                rest.removeLast(" (fetch)".count)
            }
            if !order.contains(name) { order.append(name) }
            if isPush { push[name] = rest } else { fetch[name] = rest }
        }
        return order.map { name in
            Remote(name: name, fetchURL: fetch[name] ?? push[name] ?? "", pushURL: push[name] ?? fetch[name] ?? "")
        }
    }

    // MARK: - Progress

    /// Extract the percentage from a git progress line ("Receiving objects:  45% (450/1000)").
    public static func progressFraction(_ line: String) -> Double? {
        guard let percent = line.firstIndex(of: "%") else { return nil }
        var start = percent
        while start > line.startIndex {
            let previous = line.index(before: start)
            if line[previous].isNumber { start = previous } else { break }
        }
        guard start < percent, let value = Double(line[start..<percent]) else { return nil }
        return min(max(value / 100, 0), 1)
    }
}

extension String {
    /// Decode a path git C-quoted ("a\tb\"c", "\303\251").
    var unquotedGitPath: String {
        guard hasPrefix("\""), hasSuffix("\""), count >= 2 else { return self }
        let inner = Array(dropFirst().dropLast().utf8)
        var bytes: [UInt8] = []
        var i = 0
        while i < inner.count {
            let c = inner[i]
            if c == UInt8(ascii: "\\"), i + 1 < inner.count {
                let n = inner[i + 1]
                switch n {
                case UInt8(ascii: "n"): bytes.append(0x0A); i += 2
                case UInt8(ascii: "t"): bytes.append(0x09); i += 2
                case UInt8(ascii: "r"): bytes.append(0x0D); i += 2
                case UInt8(ascii: "\""): bytes.append(0x22); i += 2
                case UInt8(ascii: "\\"): bytes.append(0x5C); i += 2
                case UInt8(ascii: "a"): bytes.append(0x07); i += 2
                case UInt8(ascii: "b"): bytes.append(0x08); i += 2
                case UInt8(ascii: "f"): bytes.append(0x0C); i += 2
                case UInt8(ascii: "v"): bytes.append(0x0B); i += 2
                case UInt8(ascii: "0")...UInt8(ascii: "7"):
                    var value: UInt8 = 0
                    var j = i + 1
                    var digits = 0
                    while j < inner.count, digits < 3, inner[j] >= UInt8(ascii: "0"), inner[j] <= UInt8(ascii: "7") {
                        value = value &* 8 &+ (inner[j] - UInt8(ascii: "0"))
                        j += 1
                        digits += 1
                    }
                    bytes.append(value)
                    i = j
                default:
                    bytes.append(n); i += 2
                }
            } else {
                bytes.append(c)
                i += 1
            }
        }
        return String(decoding: bytes, as: UTF8.self)
    }
}
