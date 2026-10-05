import Foundation

/// A file with conflict markers (<<<<<<< ======= >>>>>>>), split into common regions and conflict regions.
///
/// Everything works on bytes: lines are split on "\n" (a "\r" immediately before that line's own line
/// terminator belongs to it, so a file mixing CRLF and LF still gets correct markers), and a UTF-8 BOM is
/// split off separately (so a marker on the first line is still recognised). Saving only replaces the byte
/// range of the conflict blocks; every other byte (BOM, each line's own line ending) is copied verbatim.
public struct ConflictFile: Sendable, Equatable {
    public struct Block: Sendable, Hashable, Identifiable {
        public let id: Int
        public let oursLabel: String
        public let theirsLabel: String
        public let baseLabel: String?
        /// The lines to display (without their line terminator).
        public let ours: [String]
        public let base: [String]?
        public let theirs: [String]
        /// From the leading <<<<<<< through the end of the >>>>>>> line (including the terminator): the only region replaced on save.
        let region: Range<Int>
        /// Each side's verbatim bytes (including each line's terminator).
        let oursBytes: Range<Int>
        let baseBytes: Range<Int>?
        let theirsBytes: Range<Int>
        /// Each side's lines as bytes (including terminators) — for picking individual lines like GitKraken.
        let oursLineBytes: [Range<Int>]
        let theirsLineBytes: [Range<Int>]
    }

    public enum Segment: Sendable, Hashable {
        case common([String])
        case conflict(Block)
    }

    public enum Resolution: String, Sendable, Hashable, CaseIterable {
        case ours
        case theirs
        case oursThenTheirs
        case theirsThenOurs
        case base
        case neither
    }

    /// The choice made for one region: a whole side (`Resolution`) or per line — first the selected Current
    /// lines, then the selected Incoming ones, keeping their file order. Picking lines without ticking any
    /// side = dropping the whole region.
    public enum Choice: Sendable, Hashable {
        case side(Resolution)
        case lines(ours: Set<Int>, theirs: Set<Int>)

        /// Tick / untick one line, starting from the current choice (choosing a whole side counts as ticking all of that side's lines).
        public static func toggling(_ current: Choice?, ours: Bool, line: Int, block: Block) -> Choice {
            var (o, t) = current.map { $0.lineSets(block) } ?? ([], [])
            if ours {
                if o.contains(line) { o.remove(line) } else { o.insert(line) }
            } else {
                if t.contains(line) { t.remove(line) } else { t.insert(line) }
            }
            return .lines(ours: o, theirs: t)
        }

        /// Which of each side's lines appear in the result (so chosen lines can be highlighted). `.base` /
        /// `.theirsThenOurs` aren't an ordered side-by-side pair — they still return the lines that are kept.
        public func lineSets(_ block: Block) -> (ours: Set<Int>, theirs: Set<Int>) {
            let allOurs = Set(block.ours.indices)
            let allTheirs = Set(block.theirs.indices)
            switch self {
            case .lines(let ours, let theirs): return (ours, theirs)
            case .side(.ours): return (allOurs, [])
            case .side(.theirs): return ([], allTheirs)
            case .side(.oursThenTheirs), .side(.theirsThenOurs): return (allOurs, allTheirs)
            case .side(.base), .side(.neither): return ([], [])
            }
        }
    }

    /// The result of reading a conflicted file from bytes on disk.
    public enum ParseResult: Sendable, Equatable {
        case parsed(ConflictFile)
        /// Not valid UTF-8 (Latin-1, CP1258, UTF-16…): the app doesn't decode it — re-encoding after
        /// decoding would corrupt every non-ASCII character. `conflictCount` counts markers by byte (markers
        /// are ASCII) so we still know whether conflicts remain.
        case notUTF8(conflictCount: Int)
    }

    /// The original content — the source used to reassemble the file on save.
    public let bytes: [UInt8]
    public let hasBOM: Bool
    public let segments: [Segment]
    /// "\r\n" when the file has CRLF lines, otherwise "\n" (reference only: on save each line keeps its own ending).
    public let lineEnding: String
    public let endsWithNewline: Bool

    public var blocks: [Block] {
        segments.compactMap { segment in
            if case .conflict(let block) = segment { return block }
            return nil
        }
    }

    public var conflictCount: Int { blocks.count }

    /// Read the file's bytes from disk. A file that isn't valid UTF-8 → `.notUTF8`; loosely decoded content is never returned.
    public static func parse(_ data: Data) -> ParseResult {
        let file = parse(bytes: [UInt8](data))
        return UTF8Text.isValid(file.bytes) ? .parsed(file) : .notUTF8(conflictCount: file.conflictCount)
    }

    public static func parse(_ text: String) -> ConflictFile {
        parse(bytes: Array(text.utf8))
    }

    private static let bom: [UInt8] = [0xEF, 0xBB, 0xBF]

    /// One line: [start, contentEnd) is the content (without "\n" / "\r\n"), [start, end) includes the terminator.
    private struct LineSpan {
        let start: Int
        let contentEnd: Int
        let end: Int
    }

    private static func parse(bytes: [UInt8]) -> ConflictFile {
        let hasBOM = bytes.starts(with: bom)
        var spans: [LineSpan] = []
        var position = hasBOM ? bom.count : 0
        while position < bytes.count {
            guard let lineFeed = bytes[position...].firstIndex(of: UInt8(ascii: "\n")) else {
                spans.append(LineSpan(start: position, contentEnd: bytes.count, end: bytes.count))
                break
            }
            let contentEnd = lineFeed > position && bytes[lineFeed - 1] == UInt8(ascii: "\r") ? lineFeed - 1 : lineFeed
            spans.append(LineSpan(start: position, contentEnd: contentEnd, end: lineFeed + 1))
            position = lineFeed + 1
        }

        /// Exactly 7 `char`s, then either end of line or one space plus a label. Returns the label, or nil when it isn't a marker.
        func marker(_ span: LineSpan, _ char: Character) -> String? {
            let code = char.asciiValue!
            guard span.contentEnd - span.start >= 7, bytes[span.start..<span.start + 7].allSatisfy({ $0 == code }) else { return nil }
            if span.contentEnd == span.start + 7 { return "" }
            guard bytes[span.start + 7] == UInt8(ascii: " ") else { return nil }
            return String(decoding: bytes[(span.start + 8)..<span.contentEnd], as: UTF8.self)
        }
        func texts(_ lines: Range<Int>) -> [String] {
            lines.map { String(decoding: bytes[spans[$0].start..<spans[$0].contentEnd], as: UTF8.self) }
        }
        /// The byte offset of the start of line `index`; `index` equal to the line count means end of file.
        func offset(_ index: Int) -> Int {
            index < spans.count ? spans[index].start : bytes.count
        }
        func lineBytes(_ lines: Range<Int>) -> [Range<Int>] {
            lines.map { spans[$0].start..<spans[$0].end }
        }

        var segments: [Segment] = []
        var commonFrom = 0
        var index = 0
        var blockID = 0
        while index < spans.count {
            guard let oursLabel = marker(spans[index], "<") else {
                index += 1
                continue
            }
            // Look for a complete block structure; if it doesn't add up, treat it as ordinary text.
            var stage = 0 // 0: ours, 1: base, 2: theirs
            var baseMarker: Int?
            var baseLabel: String?
            var separator: Int?
            var theirsLabel: String?
            var closing: Int?
            var cursor = index + 1
            while cursor < spans.count {
                let current = spans[cursor]
                if stage == 0, let label = marker(current, "|") {
                    stage = 1
                    baseMarker = cursor
                    baseLabel = label
                } else if stage < 2, marker(current, "=") == "" {
                    stage = 2
                    separator = cursor
                } else if stage == 2, let label = marker(current, ">") {
                    theirsLabel = label
                    closing = cursor
                    break
                } else if marker(current, "<") != nil {
                    break
                }
                cursor += 1
            }
            guard let closing, let separator, let theirsLabel else {
                index += 1
                continue
            }
            if commonFrom < index { segments.append(.common(texts(commonFrom..<index))) }
            let oursEnd = baseMarker ?? separator
            let block = Block(
                id: blockID,
                oursLabel: oursLabel, theirsLabel: theirsLabel, baseLabel: baseLabel,
                ours: texts((index + 1)..<oursEnd),
                base: baseMarker.map { texts(($0 + 1)..<separator) },
                theirs: texts((separator + 1)..<closing),
                region: spans[index].start..<spans[closing].end,
                oursBytes: offset(index + 1)..<offset(oursEnd),
                baseBytes: baseMarker.map { offset($0 + 1)..<offset(separator) },
                theirsBytes: offset(separator + 1)..<offset(closing),
                oursLineBytes: lineBytes((index + 1)..<oursEnd),
                theirsLineBytes: lineBytes((separator + 1)..<closing)
            )
            segments.append(.conflict(block))
            blockID += 1
            index = closing + 1
            commonFrom = index
        }
        if commonFrom < spans.count { segments.append(.common(texts(commonFrom..<spans.count))) }

        let hasCRLF = zip(bytes, bytes.dropFirst()).contains { $0 == UInt8(ascii: "\r") && $1 == UInt8(ascii: "\n") }
        return ConflictFile(bytes: bytes, hasBOM: hasBOM, segments: segments, lineEnding: hasCRLF ? "\r\n" : "\n",
                            endsWithNewline: bytes.last == UInt8(ascii: "\n"))
    }

    /// Reassemble the file's bytes from the per-block choices. Returns nil while any block is still unchosen.
    /// If the >>>>>>> line is the last line of the file and has no terminator, the result has no final terminator either.
    public func resolvedData(with choices: [Int: Resolution]) -> Data? {
        resolvedData(choices: choices.mapValues { Choice.side($0) })
    }

    /// The same, using per-line choices.
    public func resolvedData(choices: [Int: Choice]) -> Data? {
        guard blocks.allSatisfy({ choices[$0.id] != nil }) else { return nil }
        return previewData(choices: choices)
    }

    /// The file content given the choices made so far; unchosen regions keep their conflict markers — so
    /// the result can be previewed while choosing.
    public func previewData(choices: [Int: Choice]) -> Data {
        var output = Data()
        var cursor = 0
        for block in blocks {
            output.append(contentsOf: bytes[cursor..<block.region.lowerBound])
            cursor = block.region.upperBound
            guard let choice = choices[block.id] else {
                output.append(contentsOf: bytes[block.region])
                continue
            }
            let ranges: [Range<Int>]
            switch choice {
            case .side(.ours): ranges = [block.oursBytes]
            case .side(.theirs): ranges = [block.theirsBytes]
            case .side(.oursThenTheirs): ranges = [block.oursBytes, block.theirsBytes]
            case .side(.theirsThenOurs): ranges = [block.theirsBytes, block.oursBytes]
            case .side(.base): ranges = block.baseBytes.map { [$0] } ?? []
            case .side(.neither): ranges = []
            case .lines(let ours, let theirs):
                ranges = ours.sorted().compactMap { block.oursLineBytes.indices.contains($0) ? block.oursLineBytes[$0] : nil }
                    + theirs.sorted().compactMap { block.theirsLineBytes.indices.contains($0) ? block.theirsLineBytes[$0] : nil }
            }
            let parts = ranges.filter { !$0.isEmpty }
            let unterminatedTail = block.region.upperBound == bytes.count && !endsWithNewline
            for (position, range) in parts.enumerated() {
                // A side's last line can lack a terminator when it isn't the end of file — add one so the next line doesn't run into it.
                var piece = Data(bytes[range])
                if position < parts.count - 1 || !unterminatedTail, piece.last != UInt8(ascii: "\n") {
                    piece.append(contentsOf: Array(lineEnding.utf8))
                }
                if unterminatedTail && position == parts.count - 1 {
                    piece.removeLast(terminatorLength(range) > 0 ? terminatorLength(range) : 0)
                }
                output.append(piece)
            }
        }
        output.append(contentsOf: bytes[cursor...])
        return output
    }

    /// Like `resolvedData(with:)` but as a string (the file is already valid UTF-8, so no bytes are lost).
    public func resolved(with choices: [Int: Resolution]) -> String? {
        resolvedData(with: choices).map { String(decoding: $0, as: UTF8.self) }
    }

    /// Length in characters of the line terminator at the end of `range` ("\n" = 1, "\r\n" = 2, none = 0).
    private func terminatorLength(_ range: Range<Int>) -> Int {
        guard !range.isEmpty, bytes[range.upperBound - 1] == UInt8(ascii: "\n") else { return 0 }
        return range.count >= 2 && bytes[range.upperBound - 2] == UInt8(ascii: "\r") ? 2 : 1
    }
}
