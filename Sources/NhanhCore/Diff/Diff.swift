import Foundation

public struct DiffLine: Sendable, Hashable {
    public enum Kind: UInt8, Sendable {
        case context
        case addition
        case deletion
        /// "\ No newline at end of file" — applies to the line right before it.
        case noNewline
    }

    public let kind: Kind
    /// The line's content, without the leading marker character and the trailing "\n". A CRLF file's "\r" is
    /// KEPT (a patch rebuilt as `text + "\n"` has to match byte for byte); for display use `DiffPresentation`
    /// (which strips "\r").
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
    /// The text after "@@ ... @@" (usually the enclosing function name).
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

    /// Indices of the added / deleted lines within the hunk.
    public var changeLineIndices: [Int] {
        lines.indices.filter { lines[$0].isChange }
    }
}

public struct FileDiff: Sendable, Hashable {
    public var oldPath: String?
    public var newPath: String?
    /// The header lines from "diff --git" through "+++" (reused when building the patch).
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
    /// false when this file's git output contains non-UTF-8 bytes (a Latin-1 file, CP1258…): the loosely
    /// decoded text (bad bytes became U+FFFD) is display-only — building a patch from it would write
    /// EF BF BD into the index / working tree.
    public var isValidUTF8: Bool

    public init(oldPath: String? = nil, newPath: String? = nil, headerLines: [String] = [], hunks: [DiffHunk] = [],
                isBinary: Bool = false, isNewFile: Bool = false, isDeletedFile: Bool = false, oldMode: String? = nil,
                newMode: String? = nil, similarity: Int? = nil, additions: Int = 0, deletions: Int = 0,
                isValidUTF8: Bool = true) {
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
        self.isValidUTF8 = isValidUTF8
    }

    public var lineCount: Int { hunks.reduce(0) { $0 + $1.lines.count } }

    /// Whether hunks or individual lines can be staged / unstaged / discarded. A non-UTF-8 file cannot: only
    /// whole-file operations work there (`git add` / `restore` / `reset` keep the bytes as-is).
    public var supportsPartialStaging: Bool {
        isValidUTF8 && !isBinary && !isNewFile && !isDeletedFile && !hunks.isEmpty
            && headerLines.contains { $0.hasBytePrefix("--- ") } && headerLines.contains { $0.hasBytePrefix("+++ ") }
    }

    public var isModeChangeOnly: Bool { hunks.isEmpty && !isBinary && oldMode != nil && newMode != nil && oldMode != newMode }
}

public enum DiffParser {
    /// Parse unified-diff output (`git diff`, `git diff-tree -p`), possibly spanning several files.
    public static func parse(_ text: String) -> [FileDiff] {
        var text = text
        return text.withUTF8 { parse(bytes: $0) }
    }

    /// Parse git's raw bytes — use this for real output (the whole output isn't decoded before splitting lines).
    public static func parse(_ data: Data) -> [FileDiff] {
        data.withUnsafeBytes { raw in
            raw.withMemoryRebound(to: UInt8.self) { parse(bytes: $0) }
        }
    }

    /// Split lines ONLY on the byte "\n": in Swift "\r\n" is ONE Character, so splitting on Character
    /// glues CRLF lines together; here the "\r" stays at the end of `DiffLine.text`. The leading marker
    /// character (" ", "+", "-", "\\") is also examined by byte (a line starting with a combining mark
    /// is still handled correctly). A file region with non-UTF-8 bytes is still decoded leniently for
    /// display but flagged `isValidUTF8 = false`.
    private static func parse(bytes: UnsafeBufferPointer<UInt8>) -> [FileDiff] {
        // Almost always valid: check the whole buffer once and only look per-file region when it fails.
        let allValid = UTF8Text.isValid(bytes)
        var files: [FileDiff] = []
        var current: FileDiff?
        var currentStart = 0
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

        func flushFile(end: Int) {
            flushHunk()
            if var file = current {
                if !allValid {
                    file.isValidUTF8 = UTF8Text.isValid(UnsafeBufferPointer(rebasing: bytes[currentStart..<end]))
                }
                files.append(file)
            }
            current = nil
        }

        var position = 0
        while position < bytes.count {
            let lineStart = position
            let lineEnd = bytes[lineStart...].firstIndex(of: UInt8(ascii: "\n")) ?? bytes.count
            let line = UnsafeBufferPointer(rebasing: bytes[lineStart..<lineEnd])
            position = lineEnd + 1

            if line.starts(with: "diff --git ".utf8) {
                flushFile(end: lineStart)
                current = FileDiff(headerLines: [decode(line)])
                currentStart = lineStart
                inHeader = true
                continue
            }
            guard current != nil else { continue }

            if inHeader {
                if line.starts(with: "@@ ".utf8) {
                    inHeader = false
                } else {
                    parseHeaderLine(decode(line), into: &current!)
                    continue
                }
            }

            if line.starts(with: "@@ ".utf8) {
                flushHunk()
                let header = decode(line)
                if let parsed = parseHunkHeader(header) {
                    hunkInfo = (header, parsed.oldStart, parsed.oldCount, parsed.newStart, parsed.newCount, parsed.section)
                    oldLine = parsed.oldStart
                    newLine = parsed.newStart
                }
                continue
            }

            guard hunkInfo != nil, let marker = line.first else { continue }
            switch marker {
            case UInt8(ascii: " "):
                hunkLines.append(DiffLine(kind: .context, text: decode(line, from: 1), oldNumber: oldLine, newNumber: newLine))
                oldLine += 1
                newLine += 1
            case UInt8(ascii: "+"):
                hunkLines.append(DiffLine(kind: .addition, text: decode(line, from: 1), oldNumber: nil, newNumber: newLine))
                newLine += 1
                current!.additions += 1
            case UInt8(ascii: "-"):
                hunkLines.append(DiffLine(kind: .deletion, text: decode(line, from: 1), oldNumber: oldLine, newNumber: nil))
                oldLine += 1
                current!.deletions += 1
            case UInt8(ascii: "\\"):
                hunkLines.append(DiffLine(kind: .noNewline, text: decode(line, from: 2), oldNumber: nil, newNumber: nil))
            default:
                break
            }
        }
        flushFile(end: bytes.count)
        return files
    }

    /// Decode (leniently) the region `line[offset...]`.
    private static func decode(_ line: UnsafeBufferPointer<UInt8>, from offset: Int = 0) -> String {
        String(decoding: UnsafeBufferPointer(rebasing: line[min(offset, line.count)...]), as: UTF8.self)
    }

    private static func parseHeaderLine(_ line: String, into file: inout FileDiff) {
        file.headerLines.append(line)
        func value(after prefix: String) -> String? {
            line.hasBytePrefix(prefix) ? line.droppingBytes(prefix.utf8.count) : nil
        }
        if let path = value(after: "--- ") {
            file.oldPath = parsePath(path)
        } else if let path = value(after: "+++ ") {
            file.newPath = parsePath(path)
        } else if let mode = value(after: "new file mode ") {
            file.isNewFile = true
            file.newMode = mode
        } else if let mode = value(after: "deleted file mode ") {
            file.isDeletedFile = true
            file.oldMode = mode
        } else if let mode = value(after: "old mode ") {
            file.oldMode = mode
        } else if let mode = value(after: "new mode ") {
            file.newMode = mode
        } else if let path = value(after: "rename from ") {
            file.oldPath = path.unquotedGitPath
        } else if let path = value(after: "rename to ") {
            file.newPath = path.unquotedGitPath
        } else if let percent = value(after: "similarity index ") {
            file.similarity = Int(percent.dropLast())
        } else if line.hasBytePrefix("Binary files ") || line.hasBytePrefix("GIT binary patch") {
            file.isBinary = true
        }
    }

    /// "a/path" → "path", "/dev/null" → nil.
    static func parsePath(_ raw: String) -> String? {
        var value = raw
        if value.hasSuffix("\t") { value.removeLast() }
        value = value.unquotedGitPath
        if value == "/dev/null" { return nil }
        if value.hasBytePrefix("a/") || value.hasBytePrefix("b/") { value = value.droppingBytes(2) }
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
        let section = body[end.upperBound...].trimmingCharacters(in: .whitespacesAndNewlines)
        return (old.0, old.1, new.0, new.1, section)
    }
}

/// Highlights the changed parts inside a line (comparing adjacent deleted/added line pairs).
public enum InlineDiff {
    /// The differing Character ranges of the two lines; nil when they differ too much.
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
        // Too little in common: highlighting the whole line is enough, no need to go per range.
        guard longest > 0, Double(common) / Double(longest) >= 0.3 else { return nil }
        let oldRange = prefix..<(a.count - suffix)
        let newRange = prefix..<(b.count - suffix)
        if oldRange.isEmpty && newRange.isEmpty { return nil }
        return (oldRange, newRange)
    }

    /// Returns: line index within the hunk → the Character ranges to embolden.
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
