import Foundation

public struct DiffLine: Sendable, Hashable {
    public enum Kind: UInt8, Sendable {
        case context
        case addition
        case deletion
        /// "\ No newline at end of file" — áp dụng cho dòng ngay trước nó.
        case noNewline
    }

    public let kind: Kind
    public let text: String
    public let oldNumber: Int?
    public let newNumber: Int?

    public init(kind: Kind, text: String, oldNumber: Int?, newNumber: Int?) {
        self.kind = kind
        self.text = text
        self.oldNumber = oldNumber
        self.newNumber = newNumber
    }

    public var isChange: Bool { kind == .addition || kind == .deletion }
}

public struct DiffHunk: Sendable, Hashable, Identifiable {
    public let id: Int
    public let header: String
    public let oldStart: Int
    public let oldCount: Int
    public let newStart: Int
    public let newCount: Int
    /// Phần chữ sau "@@ ... @@" (thường là tên hàm).
    public let section: String
    public let lines: [DiffLine]

    public init(id: Int, header: String, oldStart: Int, oldCount: Int, newStart: Int, newCount: Int, section: String, lines: [DiffLine]) {
        self.id = id
        self.header = header
        self.oldStart = oldStart
        self.oldCount = oldCount
        self.newStart = newStart
        self.newCount = newCount
        self.section = section
        self.lines = lines
    }

    /// Chỉ số các dòng thêm/xoá trong hunk.
    public var changeLineIndices: [Int] {
        lines.indices.filter { lines[$0].isChange }
    }
}

public struct FileDiff: Sendable, Hashable {
    public var oldPath: String?
    public var newPath: String?
    /// Các dòng header từ "diff --git" đến "+++" (dùng lại khi dựng patch).
    public var headerLines: [String]
    public var hunks: [DiffHunk]
    public var isBinary: Bool
    public var isNewFile: Bool
    public var isDeletedFile: Bool
    public var oldMode: String?
    public var newMode: String?
    public var similarity: Int?
    public var additions: Int
    public var deletions: Int

    public init(oldPath: String? = nil, newPath: String? = nil, headerLines: [String] = [], hunks: [DiffHunk] = [],
                isBinary: Bool = false, isNewFile: Bool = false, isDeletedFile: Bool = false, oldMode: String? = nil,
                newMode: String? = nil, similarity: Int? = nil, additions: Int = 0, deletions: Int = 0) {
        self.oldPath = oldPath
        self.newPath = newPath
        self.headerLines = headerLines
        self.hunks = hunks
        self.isBinary = isBinary
        self.isNewFile = isNewFile
        self.isDeletedFile = isDeletedFile
        self.oldMode = oldMode
        self.newMode = newMode
        self.similarity = similarity
        self.additions = additions
        self.deletions = deletions
    }

    public var lineCount: Int { hunks.reduce(0) { $0 + $1.lines.count } }

    /// Có thể stage/unstage/discard từng hunk hoặc từng dòng không.
    public var supportsPartialStaging: Bool {
        !isBinary && !isNewFile && !isDeletedFile && !hunks.isEmpty
            && headerLines.contains { $0.hasPrefix("--- ") } && headerLines.contains { $0.hasPrefix("+++ ") }
    }

    public var isModeChangeOnly: Bool { hunks.isEmpty && !isBinary && oldMode != nil && newMode != nil && oldMode != newMode }
}

public enum DiffParser {
    /// Parse output dạng unified diff (`git diff`, `git diff-tree -p`), có thể gồm nhiều file.
    public static func parse(_ text: String) -> [FileDiff] {
        var files: [FileDiff] = []
        var current: FileDiff?
        var inHeader = false

        var hunkInfo: (header: String, oldStart: Int, oldCount: Int, newStart: Int, newCount: Int, section: String)?
        var hunkLines: [DiffLine] = []
        var oldLine = 0
        var newLine = 0

        func flushHunk() {
            if let info = hunkInfo, current != nil {
                let hunk = DiffHunk(id: current!.hunks.count, header: info.header, oldStart: info.oldStart,
                                    oldCount: info.oldCount, newStart: info.newStart, newCount: info.newCount,
                                    section: info.section, lines: hunkLines)
                current!.hunks.append(hunk)
            }
            hunkInfo = nil
            hunkLines = []
        }

        func flushFile() {
            flushHunk()
            if let file = current { files.append(file) }
            current = nil
        }

        for rawLine in text.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = String(rawLine)

            if line.hasPrefix("diff --git ") {
                flushFile()
                current = FileDiff(headerLines: [line])
                inHeader = true
                continue
            }
            guard current != nil else { continue }

            if inHeader {
                if line.hasPrefix("@@ ") {
                    inHeader = false
                } else {
                    parseHeaderLine(line, into: &current!)
                    continue
                }
            }

            if line.hasPrefix("@@ ") {
                flushHunk()
                if let parsed = parseHunkHeader(line) {
                    hunkInfo = (line, parsed.oldStart, parsed.oldCount, parsed.newStart, parsed.newCount, parsed.section)
                    oldLine = parsed.oldStart
                    newLine = parsed.newStart
                }
                continue
            }

            guard hunkInfo != nil, let marker = line.first else { continue }
            switch marker {
            case " ":
                hunkLines.append(DiffLine(kind: .context, text: String(line.dropFirst()), oldNumber: oldLine, newNumber: newLine))
                oldLine += 1
                newLine += 1
            case "+":
                hunkLines.append(DiffLine(kind: .addition, text: String(line.dropFirst()), oldNumber: nil, newNumber: newLine))
                newLine += 1
                current!.additions += 1
            case "-":
                hunkLines.append(DiffLine(kind: .deletion, text: String(line.dropFirst()), oldNumber: oldLine, newNumber: nil))
                oldLine += 1
                current!.deletions += 1
            case "\\":
                hunkLines.append(DiffLine(kind: .noNewline, text: String(line.dropFirst(2)), oldNumber: nil, newNumber: nil))
            default:
                break
            }
        }
        flushFile()
        return files
    }

    private static func parseHeaderLine(_ line: String, into file: inout FileDiff) {
        file.headerLines.append(line)
        if line.hasPrefix("--- ") {
            file.oldPath = parsePath(String(line.dropFirst(4)))
        } else if line.hasPrefix("+++ ") {
            file.newPath = parsePath(String(line.dropFirst(4)))
        } else if line.hasPrefix("new file mode ") {
            file.isNewFile = true
            file.newMode = String(line.dropFirst("new file mode ".count))
        } else if line.hasPrefix("deleted file mode ") {
            file.isDeletedFile = true
            file.oldMode = String(line.dropFirst("deleted file mode ".count))
        } else if line.hasPrefix("old mode ") {
            file.oldMode = String(line.dropFirst("old mode ".count))
        } else if line.hasPrefix("new mode ") {
            file.newMode = String(line.dropFirst("new mode ".count))
        } else if line.hasPrefix("rename from ") {
            file.oldPath = String(line.dropFirst("rename from ".count)).unquotedGitPath
        } else if line.hasPrefix("rename to ") {
            file.newPath = String(line.dropFirst("rename to ".count)).unquotedGitPath
        } else if line.hasPrefix("similarity index ") {
            file.similarity = Int(line.dropFirst("similarity index ".count).dropLast())
        } else if line.hasPrefix("Binary files ") || line.hasPrefix("GIT binary patch") {
            file.isBinary = true
        }
    }

    /// "a/path" → "path", "/dev/null" → nil.
    static func parsePath(_ raw: String) -> String? {
        var value = raw
        if value.hasSuffix("\t") { value.removeLast() }
        value = value.unquotedGitPath
        if value == "/dev/null" { return nil }
        if value.hasPrefix("a/") || value.hasPrefix("b/") { value.removeFirst(2) }
        return value
    }

    /// "@@ -1,5 +1,6 @@ func foo()"
    static func parseHunkHeader(_ line: String) -> (oldStart: Int, oldCount: Int, newStart: Int, newCount: Int, section: String)? {
        let body = line.dropFirst(3)
        guard let end = body.range(of: " @@") else { return nil }
        let ranges = body[body.startIndex..<end.lowerBound].split(separator: " ")
        guard ranges.count == 2, ranges[0].hasPrefix("-"), ranges[1].hasPrefix("+") else { return nil }
        func parseRange(_ text: Substring) -> (Int, Int)? {
            let parts = text.dropFirst().split(separator: ",", omittingEmptySubsequences: false)
            guard let start = Int(parts[0]) else { return nil }
            let count = parts.count > 1 ? (Int(parts[1]) ?? 1) : 1
            return (start, count)
        }
        guard let old = parseRange(ranges[0]), let new = parseRange(ranges[1]) else { return nil }
        let section = body[end.upperBound...].trimmingCharacters(in: .whitespaces)
        return (old.0, old.1, new.0, new.1, section)
    }
}

/// Tô sáng phần thay đổi bên trong một dòng (so cặp dòng xoá/thêm liền kề).
public enum InlineDiff {
    /// Khoảng ký tự (theo Character) khác nhau giữa hai dòng; nil nếu hai dòng khác nhau quá nhiều.
    public static func changedRanges(old: String, new: String) -> (old: Range<Int>, new: Range<Int>)? {
        let a = Array(old)
        let b = Array(new)
        guard !a.isEmpty || !b.isEmpty, a.count < 2000, b.count < 2000 else { return nil }
        var prefix = 0
        while prefix < a.count, prefix < b.count, a[prefix] == b[prefix] { prefix += 1 }
        var suffix = 0
        while suffix < a.count - prefix, suffix < b.count - prefix, a[a.count - 1 - suffix] == b[b.count - 1 - suffix] {
            suffix += 1
        }
        let common = prefix + suffix
        let longest = max(a.count, b.count)
        // Nếu phần giống nhau quá ít thì tô cả dòng là đủ, không tô từng phần.
        guard longest > 0, Double(common) / Double(longest) >= 0.3 else { return nil }
        let oldRange = prefix..<(a.count - suffix)
        let newRange = prefix..<(b.count - suffix)
        if oldRange.isEmpty && newRange.isEmpty { return nil }
        return (oldRange, newRange)
    }

    /// Trả về: chỉ số dòng trong hunk → khoảng ký tự cần tô đậm.
    public static func highlights(for hunk: DiffHunk) -> [Int: Range<Int>] {
        var result: [Int: Range<Int>] = [:]
        let lines = hunk.lines
        var i = 0
        while i < lines.count {
            guard lines[i].kind == .deletion else { i += 1; continue }
            var deletions: [Int] = []
            while i < lines.count, lines[i].kind == .deletion || lines[i].kind == .noNewline {
                if lines[i].kind == .deletion { deletions.append(i) }
                i += 1
            }
            var additions: [Int] = []
            while i < lines.count, lines[i].kind == .addition || lines[i].kind == .noNewline {
                if lines[i].kind == .addition { additions.append(i) }
                i += 1
            }
            for (d, a) in zip(deletions, additions) {
                if let ranges = changedRanges(old: lines[d].text, new: lines[a].text) {
                    result[d] = ranges.old
                    result[a] = ranges.new
                }
            }
        }
        return result
    }
}
