import Foundation

/// Dựng patch chỉ chứa các hunk/dòng được chọn, để stage/unstage/discard từng phần.
///
/// - Stage (diff index→worktree, áp dụng xuôi vào index): `reverse = false`.
/// - Unstage (diff HEAD→index, áp dụng ngược vào index) và Discard
///   (diff index→worktree, áp dụng ngược vào worktree): `reverse = true`.
///
/// Dòng không được chọn: khi áp xuôi, dòng xoá thành ngữ cảnh còn dòng thêm bị bỏ;
/// khi áp ngược thì ngược lại. Trong mỗi khối thay đổi, dòng xoá thứ k và dòng thêm thứ k
/// được xen kẽ theo vị trí, để "sửa dòng 2 nhưng giữ dòng 3" cho kết quả đúng thứ tự.
///
/// Nội dung từng dòng chép nguyên văn từ diff (kể cả "\r" của file CRLF), nên `git apply` tái tạo đúng từng byte —
/// với điều kiện diff là UTF-8 hợp lệ (`FileDiff.supportsPartialStaging` đã chặn file không phải UTF-8).
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
    ///   - selection: id hunk → tập chỉ số dòng (trong `hunk.lines`) được chọn.
    /// - Returns: nội dung patch, hoặc nil nếu không có thay đổi nào được chọn / file không stage từng phần được.
    public static func makePatch(file: FileDiff, selection: [Int: Set<Int>], reverse: Bool) -> String? {
        guard file.supportsPartialStaging, var patch = patchHeader(file, reverse: reverse) else { return nil }
        var delta = 0
        var emittedAny = false

        for hunk in file.hunks {
            guard let selected = selection[hunk.id], !selected.isEmpty else { continue }
            guard let lines = buildLines(hunk: hunk, selected: selected, reverse: reverse) else { continue }

            let oldCount = lines.filter { $0.marker != "+" }.count
            let newCount = lines.filter { $0.marker != "-" }.count

            // "anchor" = số dòng đứng trước khoảng. Quy ước unified diff: khoảng rỗng thì
            // start = anchor, khoảng có dòng thì start = anchor + 1.
            // Phía được giữ nguyên (old khi stage, new khi áp ngược) có đúng các dòng như hunk gốc,
            // nên anchor của phía đó không đổi; phía còn lại lệch theo delta của các hunk trước.
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

    /// Chọn toàn bộ dòng thay đổi của một hunk.
    public static func selectionForWholeHunk(_ hunk: DiffHunk) -> [Int: Set<Int>] {
        [hunk.id: Set(hunk.changeLineIndices)]
    }

    /// Dòng header chỉ có ở đổi tên/sao chép: không được đưa vào patch nội dung.
    private static let renameCopyPrefixes = [
        "similarity index ", "dissimilarity index ", "rename from ", "rename to ", "copy from ", "copy to ",
    ]

    /// Header của patch. Bỏ dòng đổi mode: stage một phần nội dung không nên kéo theo đổi quyền file.
    /// File đổi tên/sao chép (diff --cached -M): patch còn "rename from/to" khi áp ngược sẽ ĐỔI TÊN NGƯỢC lại trong
    /// index (b.txt mất khỏi index, a.txt sống lại) chứ không chỉ bỏ vài dòng — nên viết lại header thành sửa nội dung
    /// một đường dẫn: đường dẫn mới khi áp ngược (unstage), đường dẫn cũ khi áp xuôi. Không đọc được tên → nil
    /// (từ chối) thay vì đoán.
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

    /// Tách phần tên của dòng "--- a/x" / "+++ b/x" (đã bỏ 4 byte đầu). Git đặt tên trong ngoặc kép kiểu C khi có
    /// ký tự đặc biệt ("a/t\303\240i.txt" — giữ nguyên dạng đã escape) và thêm TAB cuối dòng khi tên có dấu cách.
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
        // Gộp dấu "\ No newline" vào dòng đứng trước.
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

    /// Dòng thêm/xoá đã chọn mà "không có newline cuối file" phải là dòng cuối của phía của nó. Ghép cặp xen kẽ có
    /// thể đặt nó TRƯỚC dòng ngữ cảnh (từ dòng chưa chọn) cùng khối; git vẫn áp patch nhưng nối hai dòng làm một
    /// ("y1" + "x2" → "y1x2") — hỏng dữ liệu âm thầm. Dời dòng đó xuống cuối khối (chỉ đổi những khối vốn đã sai).
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

    /// Dòng ngữ cảnh "không có newline cuối file" chỉ hợp lệ khi là dòng cuối của cả hai phía.
    /// Nếu không, tách thành cặp -/+ để mỗi phía có đúng ký tự xuống dòng. Phía vừa được thêm xuống dòng dùng kiểu
    /// xuống dòng của dòng lân cận (file CRLF thì "\r\n", không để lọt một "\n" lẻ).
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

    /// Thêm "\r" cuối `text` nếu dòng gần nhất có xuống dòng (không phải dòng "không newline") kết thúc bằng "\r".
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
