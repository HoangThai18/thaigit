import Foundation

/// Builds a patch containing only the selected hunks/lines, for staging / unstaging / discarding part of a
/// change.
///
/// - Stage (index→worktree diff, applied forward into the index): `reverse = false`.
/// - Unstage (HEAD→index diff, applied in reverse into the index) and Discard
///   (index→worktree diff, applied in reverse into the working tree): `reverse = true`.
///
/// Unselected lines: applying forward, a deleted line becomes context while an added one is dropped;
/// applying in reverse it's the other way round. Inside each change block the k-th deleted line and the
/// k-th added line are interleaved by position, so "fix line 2 but keep line 3" comes out in the right
/// order.
///
/// Each line's content is copied verbatim from the diff (including a CRLF file's "\r"), so `git apply`
/// reproduces every byte exactly — provided the diff is valid UTF-8 (`FileDiff.supportsPartialStaging`
/// already blocks non-UTF-8 files).
public enum PatchBuilder {
    private struct Item {
        var kind: DiffLine.Kind
        var text: String
        var noNewline: Bool
        var index: Int
    }

    private struct Output {
        var marker: Character
        var text: String
        var noNewline: Bool
    }

    /// - Parameters:
    ///   - selection: hunk id → the set of selected line indices (within `hunk.lines`).
    /// - Returns: the patch content, or nil when nothing is selected / the file doesn't support partial staging.
    public static func makePatch(file: FileDiff, selection: [Int: Set<Int>], reverse: Bool) -> String? {
        guard file.supportsPartialStaging, var patch = patchHeader(file, reverse: reverse) else { return nil }
        var delta = 0
        var emittedAny = false

        for hunk in file.hunks {
            guard let selected = selection[hunk.id], !selected.isEmpty else { continue }
            guard let lines = buildLines(hunk: hunk, selected: selected, reverse: reverse) else { continue }

            let oldCount = lines.filter { $0.marker != "+" }.count
            let newCount = lines.filter { $0.marker != "-" }.count

            // "anchor" = the number of lines preceding the range. Unified diff convention: for an empty
            // range start = anchor, for a non-empty range start = anchor + 1.
            // The unchanged side (old when staging, new when applying in reverse) has exactly the original
            // hunk's lines, so its anchor doesn't move; the other side shifts by the delta of the earlier hunks.
            let originalOldAnchor = hunk.oldCount == 0 ? hunk.oldStart : hunk.oldStart - 1
            let originalNewAnchor = hunk.newCount == 0 ? hunk.newStart : hunk.newStart - 1
            let oldAnchor: Int
            let newAnchor: Int
            if reverse {
                newAnchor = originalNewAnchor
                oldAnchor = originalNewAnchor - delta
            } else {
                oldAnchor = originalOldAnchor
                newAnchor = originalOldAnchor + delta
            }
            let oldStart = oldCount == 0 ? max(0, oldAnchor) : oldAnchor + 1
            let newStart = newCount == 0 ? max(0, newAnchor) : newAnchor + 1

            patch.append("@@ -\(oldStart),\(oldCount) +\(newStart),\(newCount) @@")
            for line in lines {
                patch.append(String(line.marker) + line.text)
                if line.noNewline { patch.append("\\ No newline at end of file") }
            }
            delta += newCount - oldCount
            emittedAny = true
        }

        guard emittedAny else { return nil }
        return patch.joined(separator: "\n") + "\n"
    }

    /// Select every changed line of a hunk.
    public static func selectionForWholeHunk(_ hunk: DiffHunk) -> [Int: Set<Int>] {
        [hunk.id: Set(hunk.changeLineIndices)]
    }

    /// The header line only exists for a rename / copy: it must not go into the content patch.
    private static let renameCopyPrefixes = [
        "similarity index ", "dissimilarity index ", "rename from ", "rename to ", "copy from ", "copy to ",
    ]

    /// The patch header. The mode-change line is dropped: staging part of the content shouldn't drag along a
    /// file permission change.
    /// A renamed / copied file (`diff --cached -M`): keeping "rename from/to" would RENAME THE FILE BACK in
    /// the index when applied in reverse (b.txt leaves the index, a.txt comes back) instead of just dropping
    /// a few lines — so the header is rewritten as a content edit of a single path: the new path when
    /// applying in reverse (unstage), the old path when applying forward. An unreadable name → nil (refuse)
    /// rather than guess.
    private static func patchHeader(_ file: FileDiff, reverse: Bool) -> [String]? {
        let withoutMode = file.headerLines.filter { !$0.hasBytePrefix("old mode ") && !$0.hasBytePrefix("new mode ") }
        func isRenameOrCopy(_ line: String) -> Bool { renameCopyPrefixes.contains { line.hasBytePrefix($0) } }
        guard file.headerLines.contains(where: isRenameOrCopy) else { return withoutMode }

        guard let source = file.headerLines.first(where: { $0.hasBytePrefix(reverse ? "+++ " : "--- ") }),
              let name = parseNameToken(Array(source.utf8.dropFirst(4)), side: reverse ? "b" : "a") else { return nil }
        func token(_ side: String) -> String {
            let quote = name.quoted ? "\"" : ""
            return quote + side + "/" + name.path + quote
        }
        let tab = name.tab ? "\t" : ""

        var header: [String] = []
        for line in withoutMode where !isRenameOrCopy(line) {
            if line.hasBytePrefix("diff --git ") {
                header.append("diff --git " + token("a") + " " + token("b"))
            } else if line.hasBytePrefix("--- ") {
                header.append("--- " + token("a") + tab)
            } else if line.hasBytePrefix("+++ ") {
                header.append("+++ " + token("b") + tab)
            } else {
                header.append(line)
            }
        }
        return header
    }

    /// Split the name part of a "--- a/x" / "+++ b/x" line (the first 4 bytes already stripped). Git C-quotes
    /// names containing special characters ("a/t\303\240i.txt" — kept in escaped form) and appends a TAB
    /// when the name contains a space.
    private static func parseNameToken(_ rest: [UInt8], side: String) -> (quoted: Bool, path: String, tab: Bool)? {
        var text = rest[...]
        let tab = text.last == UInt8(ascii: "\t")
        if tab { text = text.dropLast() }
        let quoted = text.count >= 2 && text.first == UInt8(ascii: "\"") && text.last == UInt8(ascii: "\"")
        if quoted { text = text.dropFirst().dropLast() }
        guard text.count > 2, text.starts(with: (side + "/").utf8) else { return nil }
        return (quoted, String(decoding: text.dropFirst(2), as: UTF8.self), tab)
    }

    private static func buildLines(hunk: DiffHunk, selected: Set<Int>, reverse: Bool) -> [Output]? {
        // Fold a "\ No newline" marker into the preceding line.
        var items: [Item] = []
        for (index, line) in hunk.lines.enumerated() {
            if line.kind == .noNewline {
                if !items.isEmpty { items[items.count - 1].noNewline = true }
                continue
            }
            items.append(Item(kind: line.kind, text: line.text, noNewline: false, index: index))
        }

        var output: [Output] = []
        var hasChange = false
        var cursor = 0
        while cursor < items.count {
            let item = items[cursor]
            if item.kind == .context {
                output.append(Output(marker: " ", text: item.text, noNewline: item.noNewline))
                cursor += 1
                continue
            }
            var deletions: [Item] = []
            var additions: [Item] = []
            while cursor < items.count, items[cursor].kind != .context {
                if items[cursor].kind == .deletion { deletions.append(items[cursor]) } else { additions.append(items[cursor]) }
                cursor += 1
            }
            var block: [Output] = []
            for k in 0..<max(deletions.count, additions.count) {
                if k < deletions.count {
                    let line = deletions[k]
                    if selected.contains(line.index) {
                        block.append(Output(marker: "-", text: line.text, noNewline: line.noNewline))
                        hasChange = true
                    } else if !reverse {
                        block.append(Output(marker: " ", text: line.text, noNewline: line.noNewline))
                    }
                }
                if k < additions.count {
                    let line = additions[k]
                    if selected.contains(line.index) {
                        block.append(Output(marker: "+", text: line.text, noNewline: line.noNewline))
                        hasChange = true
                    } else if reverse {
                        block.append(Output(marker: " ", text: line.text, noNewline: line.noNewline))
                    }
                }
            }
            output.append(contentsOf: keepNoNewlineChangesLast(block))
        }
        guard hasChange else { return nil }
        return fixNoNewlineContext(output)
    }

    /// A selected added/deleted line marked "no newline at end of file" must end its own side. Interleaving
    /// pairs can place it BEFORE a context line (from an unselected line) of the same block; git still applies
    /// the patch but concatenates the two lines into one ("y1" + "x2" → "y1x2") — silent data corruption.
    /// Move that line to the end of the block (touching only blocks that were already wrong).
    private static func keepNoNewlineChangesLast(_ block: [Output]) -> [Output] {
        let lastOld = block.lastIndex { $0.marker != "+" } ?? -1
        let lastNew = block.lastIndex { $0.marker != "-" } ?? -1
        var stay: [Output] = []
        var moved: [Output] = []
        for (index, line) in block.enumerated() {
            let misplaced = line.noNewline
                && ((line.marker == "+" && index < lastNew) || (line.marker == "-" && index < lastOld))
            if misplaced { moved.append(line) } else { stay.append(line) }
        }
        return stay + moved
    }

    /// A "no newline at end of file" context line is only valid as the last line of BOTH sides.
    /// Otherwise split it into a -/+ pair so each side gets exactly one line terminator. The side that just
    /// gained a terminator uses its neighbouring line's ending (a CRLF file gets "\r\n", never a lone "\n").
    private static func fixNoNewlineContext(_ lines: [Output]) -> [Output] {
        let lastOld = lines.lastIndex { $0.marker != "+" }
        let lastNew = lines.lastIndex { $0.marker != "-" }
        var fixed: [Output] = []
        fixed.reserveCapacity(lines.count + 2)
        for (index, line) in lines.enumerated() {
            guard line.marker == " ", line.noNewline else {
                fixed.append(line)
                continue
            }
            switch (index == lastOld, index == lastNew) {
            case (true, true):
                fixed.append(line)
            case (true, false):
                fixed.append(Output(marker: "-", text: line.text, noNewline: true))
                fixed.append(Output(marker: "+", text: withNeighbourLineEnding(line.text, lines: lines, index: index), noNewline: false))
            case (false, true):
                fixed.append(Output(marker: "-", text: withNeighbourLineEnding(line.text, lines: lines, index: index), noNewline: false))
                fixed.append(Output(marker: "+", text: line.text, noNewline: true))
            case (false, false):
                fixed.append(Output(marker: " ", text: line.text, noNewline: false))
            }
        }
        return fixed
    }

    /// Appends "\r" to `text` when the closest preceding line ends with a terminator (not a "no newline" line) that ends in "\r".
    private static func withNeighbourLineEnding(_ text: String, lines: [Output], index: Int) -> String {
        for distance in stride(from: 1, to: lines.count, by: 1) {
            let candidates = [index - distance, index + distance].filter { lines.indices.contains($0) }
            if let neighbour = candidates.map({ lines[$0] }).first(where: { !$0.noNewline }) {
                return neighbour.text.utf8.last == UInt8(ascii: "\r") ? text + "\r" : text
            }
        }
        return text
    }
}
