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
    /// - Returns: nội dung patch, hoặc nil nếu không có thay đổi nào được chọn.
    public static func makePatch(file: FileDiff, selection: [Int: Set<Int>], reverse: Bool) -> String? {
        guard file.supportsPartialStaging else { return nil }

        // Bỏ dòng đổi mode: stage một phần nội dung không nên kéo theo đổi quyền file.
        var patch: [String] = file.headerLines.filter { !$0.hasPrefix("old mode ") && !$0.hasPrefix("new mode ") }
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
            for k in 0..<max(deletions.count, additions.count) {
                if k < deletions.count {
                    let line = deletions[k]
                    if selected.contains(line.index) {
                        output.append(Output(marker: "-", text: line.text, noNewline: line.noNewline))
                        hasChange = true
                    } else if !reverse {
                        output.append(Output(marker: " ", text: line.text, noNewline: line.noNewline))
                    }
                }
                if k < additions.count {
                    let line = additions[k]
                    if selected.contains(line.index) {
                        output.append(Output(marker: "+", text: line.text, noNewline: line.noNewline))
                        hasChange = true
                    } else if reverse {
                        output.append(Output(marker: " ", text: line.text, noNewline: line.noNewline))
                    }
                }
            }
        }
        guard hasChange else { return nil }
        return fixNoNewlineContext(output)
    }

    /// Dòng ngữ cảnh "không có newline cuối file" chỉ hợp lệ khi là dòng cuối của cả hai phía.
    /// Nếu không, tách thành cặp -/+ để mỗi phía có đúng ký tự xuống dòng.
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
                fixed.append(Output(marker: "+", text: line.text, noNewline: false))
            case (false, true):
                fixed.append(Output(marker: "-", text: line.text, noNewline: false))
                fixed.append(Output(marker: "+", text: line.text, noNewline: true))
            case (false, false):
                fixed.append(Output(marker: " ", text: line.text, noNewline: false))
            }
        }
        return fixed
    }
}
