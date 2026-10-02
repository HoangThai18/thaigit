import Foundation

/// Dữ liệu đã chuẩn bị sẵn để vẽ diff (tính ở luồng nền): chữ hiển thị (tab → khoảng trắng),
/// vùng tô đậm trong dòng, cặp dòng cho chế độ hai cột.
public struct DiffPresentation: Sendable {
    public struct Line: Sendable, Hashable {
        public let index: Int
        public let kind: DiffLine.Kind
        public let text: String
        public let oldNumber: Int?
        public let newNumber: Int?
        public let highlight: Range<Int>?
    }

    public struct SplitRow: Sendable, Hashable {
        public let left: Line?
        public let right: Line?
    }

    public struct Hunk: Sendable, Identifiable {
        public let id: Int
        public let header: String
        public let lines: [Line]
        public let splitRows: [SplitRow]
    }

    public let diff: FileDiff
    public let hunks: [Hunk]
    public let maxLineLength: Int
    public let maxLineNumber: Int

    public static let maxDisplayLength = 1_200

    @concurrent
    public static func make(_ diff: FileDiff) async -> DiffPresentation {
        build(diff)
    }

    public static func build(_ diff: FileDiff) -> DiffPresentation {
        var hunks: [Hunk] = []
        var maxLength = 0
        var maxNumber = 0
        for hunk in diff.hunks {
            let displayTexts = hunk.lines.map { displayText($0.text) }
            // Tô đậm tính trên chữ đã đổi tab để khớp vị trí hiển thị.
            let displayHunk = DiffHunk(
                id: hunk.id, header: hunk.header, oldStart: hunk.oldStart, oldCount: hunk.oldCount,
                newStart: hunk.newStart, newCount: hunk.newCount, section: hunk.section,
                lines: zip(hunk.lines, displayTexts).map { DiffLine(kind: $0.kind, text: $1, oldNumber: $0.oldNumber, newNumber: $0.newNumber) }
            )
            let highlights = InlineDiff.highlights(for: displayHunk)
            var lines: [Line] = []
            lines.reserveCapacity(hunk.lines.count)
            for (index, line) in hunk.lines.enumerated() {
                let text = displayTexts[index]
                maxLength = max(maxLength, text.count)
                maxNumber = max(maxNumber, line.oldNumber ?? 0, line.newNumber ?? 0)
                lines.append(Line(index: index, kind: line.kind, text: text, oldNumber: line.oldNumber,
                                  newNumber: line.newNumber, highlight: highlights[index]))
            }
            hunks.append(Hunk(id: hunk.id, header: hunk.header, lines: lines, splitRows: splitRows(lines)))
        }
        return DiffPresentation(diff: diff, hunks: hunks, maxLineLength: maxLength, maxLineNumber: maxNumber)
    }

    static func displayText(_ text: String) -> String {
        var value = text.replacingOccurrences(of: "\t", with: "    ")
        if value.hasSuffix("\r") { value.removeLast() }
        if value.count > maxDisplayLength {
            value = String(value.prefix(maxDisplayLength)) + " …"
        }
        return value
    }

    /// Ghép dòng xoá thứ k với dòng thêm thứ k trong mỗi khối thay đổi.
    static func splitRows(_ lines: [Line]) -> [SplitRow] {
        var rows: [SplitRow] = []
        var index = 0
        while index < lines.count {
            let line = lines[index]
            switch line.kind {
            case .context:
                rows.append(SplitRow(left: line, right: line))
                index += 1
            case .noNewline:
                index += 1
            case .deletion, .addition:
                var deletions: [Line] = []
                var additions: [Line] = []
                while index < lines.count, lines[index].kind != .context {
                    switch lines[index].kind {
                    case .deletion: deletions.append(lines[index])
                    case .addition: additions.append(lines[index])
                    default: break
                    }
                    index += 1
                }
                for k in 0..<max(deletions.count, additions.count) {
                    rows.append(SplitRow(left: k < deletions.count ? deletions[k] : nil,
                                         right: k < additions.count ? additions[k] : nil))
                }
            }
        }
        return rows
    }
}
