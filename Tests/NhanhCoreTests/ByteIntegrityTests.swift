import Foundation
import Testing
@testable import NhanhCore

/// Thao tác từng phần như app: stage = áp xuôi vào index, unstage = áp ngược vào index, huỷ = áp ngược vào worktree.
private enum PartialOp {
    case stage, unstage, discard
}

private func selection(_ diff: FileDiff, where predicate: (DiffLine) -> Bool) -> [Int: Set<Int>] {
    var result: [Int: Set<Int>] = [:]
    for hunk in diff.hunks {
        let indices = hunk.lines.indices.filter { hunk.lines[$0].isChange && predicate(hunk.lines[$0]) }
        if !indices.isEmpty { result[hunk.id] = Set(indices) }
    }
    return result
}

/// Dựng patch từ diff hiện tại rồi áp bằng git như app. Trả về patch đã áp.
@discardableResult
private func apply(_ op: PartialOp, _ t: TestRepo, _ change: FileChange,
                   where predicate: (DiffLine) -> Bool) async throws -> String {
    let diff = try #require(try await t.repo.workingDiff(change, kind: op == .unstage ? .staged : .unstaged))
    let patch = try #require(PatchBuilder.makePatch(file: diff, selection: selection(diff, where: predicate), reverse: op != .stage))
    try await t.repo.applyPatch(patch, cached: op != .discard, reverse: op != .stage)
    return patch
}

/// Repo có `path` đã commit với `base`, working tree là `worktree` (đã stage nếu `staged`).
private func makeRepo(_ path: String, base: Data, worktree: Data, staged: Bool = false) async throws -> TestRepo {
    let t = try await TestRepo.make()
    do {
        try t.write(path, bytes: base)
        try await t.commitAll("base")
        try t.write(path, bytes: worktree)
        if staged { try await t.repo.stage(paths: [path]) }
        return t
    } catch {
        t.cleanup()
        throw error
    }
}

/// Hai nhánh cùng sửa một chỗ → `git merge feature` dừng với xung đột ở f.txt.
private func makeConflict(base: Data, ours: Data, theirs: Data) async throws -> TestRepo {
    let t = try await TestRepo.make()
    do {
        try t.write("f.txt", bytes: base)
        try await t.commitAll("base")
        try await t.repo.createBranch("feature", at: nil, checkout: true)
        try t.write("f.txt", bytes: theirs)
        try await t.commitAll("theirs")
        try await t.repo.switchTo(branch: "main")
        try t.write("f.txt", bytes: ours)
        try await t.commitAll("ours")
        await #expect(throws: GitError.self) { try await t.repo.merge("feature") }
        return t
    } catch {
        t.cleanup()
        throw error
    }
}

private let bom = Data([0xEF, 0xBB, 0xBF])

private func bytes(_ text: String) -> Data { Data(text.utf8) }

@Suite("Toàn vẹn byte: parse CRLF, patch, conflict (không chạy git)")
struct ByteParsingTests {
    @Test func crlfDiffKeepsCarriageReturnPerLine() throws {
        let header = "diff --git a/c.txt b/c.txt\nindex 1111111..2222222 100644\n--- a/c.txt\n+++ b/c.txt\n"
        let body = "@@ -1,2 +1,2 @@\n-a\r\n+b\r\n c\r\n@@ -9,1 +9,1 @@\n-x\r\n+y\r\n"
        let file = try #require(DiffParser.parse(header + body).first)
        try #require(file.hunks.count == 2)
        #expect(file.hunks[0].lines.map(\.kind) == [.deletion, .addition, .context])
        #expect(file.hunks[0].lines.map(\.text) == ["a\r", "b\r", "c\r"])
        #expect(file.hunks[1].lines.map(\.text) == ["x\r", "y\r"])
        #expect(file.lineCount == 5 && file.additions == 2 && file.deletions == 2)
        #expect(file.isValidUTF8 && file.supportsPartialStaging)
        #expect(DiffParser.parse(bytes(header + body)) == [file])

        // Hiển thị (và tô đậm trong dòng) dùng chữ đã bỏ "\r"; dữ liệu gốc giữ "\r" để dựng patch.
        let presentation = DiffPresentation.build(file)
        #expect(presentation.hunks[0].lines.map(\.text) == ["a", "b", "c"])
        #expect(presentation.hunks[1].splitRows.map { [$0.left?.text, $0.right?.text] } == [["x", "y"]])
        #expect(presentation.maxLineLength == 1)
        let similar = try #require(DiffParser.parse(header + "@@ -1 +1 @@\n-let a = 1\r\n+let a = 2\r\n").first)
        let highlighted = DiffPresentation.build(similar).hunks[0].lines
        #expect(highlighted.map(\.text) == ["let a = 1", "let a = 2"])
        #expect(highlighted.map(\.highlight) == [8..<9, 8..<9])

        let patch = try #require(PatchBuilder.makePatch(file: file, selection: [0: [0, 1]], reverse: false))
        #expect(show(bytes(patch)) == show(bytes(header + "@@ -1,2 +1,2 @@\n-a\r\n+b\r\n c\r\n")))
    }

    @Test func onlyTheNonUTF8FileIsFlagged() throws {
        var data = bytes("diff --git a/u.txt b/u.txt\nindex 1..2 100644\n--- a/u.txt\n+++ b/u.txt\n@@ -1 +1 @@\n-caf\u{e9}\n+caf\u{e9}!\n")
        data += latin1("diff --git a/l.txt b/l.txt\nindex 3..4 100644\n--- a/l.txt\n+++ b/l.txt\n@@ -1 +1 @@\n-caf\u{e9}\n+caf\u{e9}!\n")
        let files = DiffParser.parse(data)
        try #require(files.count == 2)
        #expect(files[0].isValidUTF8 && files[0].supportsPartialStaging)
        #expect(files[0].hunks[0].lines.map(\.text) == ["caf\u{e9}", "caf\u{e9}!"])
        // Vẫn hiển thị được (byte lỗi thành U+FFFD) nhưng không bao giờ dựng patch từ chữ đó.
        #expect(!files[1].isValidUTF8 && !files[1].supportsPartialStaging)
        #expect(files[1].hunks[0].lines.map(\.text) == ["caf\u{FFFD}", "caf\u{FFFD}!"])
        #expect(PatchBuilder.makePatch(file: files[1], selection: PatchBuilder.selectionForWholeHunk(files[1].hunks[0]), reverse: false) == nil)
    }

    @Test func lineStartingWithCombiningMarkIsKept() throws {
        // " " / "-" + dấu kết hợp là MỘT Character: xét ký tự đánh dấu theo Character thì mất dòng.
        let text = "diff --git a/n.txt b/n.txt\n--- a/n.txt\n+++ b/n.txt\n@@ -1,2 +1,2 @@\n \u{301}a\n-\u{301}x\n+\u{301}y\n"
        let hunk = try #require(DiffParser.parse(text).first?.hunks.first)
        #expect(hunk.lines.map(\.kind) == [.context, .deletion, .addition])
        #expect(hunk.lines.map(\.text) == ["\u{301}a", "\u{301}x", "\u{301}y"])
    }

    @Test func noNewlineChangeMovesBelowKeptLines() throws {
        // "x1\nx2\n" → "y1" (không newline cuối). Chọn "-x1" và "+y1": "+y1" không được đứng trước " x2".
        let text = "diff --git a/d.txt b/d.txt\n--- a/d.txt\n+++ b/d.txt\n@@ -1,2 +1 @@\n-x1\n-x2\n+y1\n\\ No newline at end of file\n"
        let file = try #require(DiffParser.parse(text).first)
        let patch = try #require(PatchBuilder.makePatch(file: file, selection: [0: [0, 2]], reverse: false))
        #expect(patch.hasSuffix("@@ -1,2 +1,2 @@\n-x1\n x2\n+y1\n\\ No newline at end of file\n"))
    }

    @Test func gainedNewlineUsesNeighbourLineEnding() throws {
        let header = "diff --git a/c.txt b/c.txt\n--- a/c.txt\n+++ b/c.txt\n"
        // Áp ngược hai dòng xoá CRLF: "y1" (không newline) phải nhận "\r\n" chứ không phải "\n" lẻ.
        let crlf = try #require(DiffParser.parse(header + "@@ -1,2 +1 @@\n-x1\r\n-x2\r\n+y1\n\\ No newline at end of file\n").first)
        let reversed = try #require(PatchBuilder.makePatch(file: crlf, selection: [0: [0, 1]], reverse: true))
        #expect(show(bytes(reversed)) == show(bytes(header + "@@ -1,3 +1,1 @@\n-x1\r\n-y1\r\n+y1\n\\ No newline at end of file\n-x2\r\n")))
        // File LF vẫn là "\n".
        let lf = try #require(DiffParser.parse(header + "@@ -1,2 +1 @@\n-x1\n-x2\n+y1\n\\ No newline at end of file\n").first)
        let lfPatch = try #require(PatchBuilder.makePatch(file: lf, selection: [0: [0, 1]], reverse: true))
        #expect(show(bytes(lfPatch)) == show(bytes(header + "@@ -1,3 +1,1 @@\n-x1\n-y1\n+y1\n\\ No newline at end of file\n-x2\n")))
    }

    @Test func renamedFilePatchTargetsOnePath() throws {
        let body = "@@ -1,3 +1,3 @@\n l1\n-l2\n+L2\n l3\n"
        func patch(_ header: String, reverse: Bool) -> String? {
            DiffParser.parse(header + body).first.flatMap { PatchBuilder.makePatch(file: $0, selection: [0: [1, 2]], reverse: reverse) }
        }
        let plain = "diff --git a/a.txt b/b.txt\nsimilarity index 80%\nrename from a.txt\nrename to b.txt\nindex 01f84f8..e864914 100644\n--- a/a.txt\n+++ b/b.txt\n"
        #expect(patch(plain, reverse: true) == "diff --git a/b.txt b/b.txt\nindex 01f84f8..e864914 100644\n--- a/b.txt\n+++ b/b.txt\n" + body)
        #expect(patch(plain, reverse: false) == "diff --git a/a.txt b/a.txt\nindex 01f84f8..e864914 100644\n--- a/a.txt\n+++ b/a.txt\n" + body)

        // Tên trong ngoặc kép kiểu C giữ nguyên dạng đã escape; tên có dấu cách giữ TAB cuối dòng ---/+++.
        let quoted = "diff --git \"a/t\\303\\240i.txt\" \"b/m\\341\\273\\233i.txt\"\nsimilarity index 90%\nrename from \"t\\303\\240i.txt\"\nrename to \"m\\341\\273\\233i.txt\"\nindex 1..2 100644\n--- \"a/t\\303\\240i.txt\"\n+++ \"b/m\\341\\273\\233i.txt\"\n"
        #expect(patch(quoted, reverse: true) == "diff --git \"a/m\\341\\273\\233i.txt\" \"b/m\\341\\273\\233i.txt\"\nindex 1..2 100644\n--- \"a/m\\341\\273\\233i.txt\"\n+++ \"b/m\\341\\273\\233i.txt\"\n" + body)
        let spaced = "diff --git a/old name.txt b/new name.txt\nsimilarity index 90%\nrename from old name.txt\nrename to new name.txt\nindex 1..2 100644\n--- a/old name.txt\t\n+++ b/new name.txt\t\n"
        #expect(patch(spaced, reverse: true) == "diff --git a/new name.txt b/new name.txt\nindex 1..2 100644\n--- a/new name.txt\t\n+++ b/new name.txt\t\n" + body)
        let copied = "diff --git a/a.txt b/c.txt\nsimilarity index 80%\ncopy from a.txt\ncopy to c.txt\nindex 1..2 100644\n--- a/a.txt\n+++ b/c.txt\n"
        #expect(patch(copied, reverse: true) == "diff --git a/c.txt b/c.txt\nindex 1..2 100644\n--- a/c.txt\n+++ b/c.txt\n" + body)
        // Không đọc được tên (tiền tố lạ) trên file đổi tên: từ chối thay vì đoán.
        #expect(patch("diff --git x/a.txt y/b.txt\nsimilarity index 80%\nrename from a.txt\nrename to b.txt\n--- x/a.txt\n+++ y/b.txt\n", reverse: true) == nil)
    }

    @Test func conflictMarkersAfterBOMAndInMixedLineEndings() throws {
        // BOM rồi dấu xung đột ngay dòng đầu: BOM không được che mất dấu, và vẫn còn sau khi giải.
        let bomFirst = ConflictFile.parse("\u{FEFF}<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> b\nz\n")
        #expect(bomFirst.hasBOM && bomFirst.conflictCount == 1)
        #expect(bomFirst.resolvedData(with: [0: .theirs]) == bytes("\u{FEFF}y\nz\n"))

        // File CRLF nhưng dòng dấu chỉ có "\n": vẫn nhận ra; mỗi dòng giữ kiểu xuống dòng của riêng nó.
        let mixed = ConflictFile.parse("a\r\n<<<<<<< HEAD\nx\r\n=======\ny\n>>>>>>> b\nz\r\n")
        try #require(mixed.conflictCount == 1)
        #expect(mixed.lineEnding == "\r\n")
        #expect(mixed.blocks[0].ours == ["x"] && mixed.blocks[0].theirs == ["y"])
        #expect(mixed.resolvedData(with: [0: .oursThenTheirs]) == bytes("a\r\nx\r\ny\nz\r\n"))

        // Không phải UTF-8: không trả nội dung đã giải mã, chỉ đếm số khối (dấu là ASCII).
        #expect(ConflictFile.parse(latin1("caf\u{e9}\n<<<<<<< HEAD\nA\u{e9}\n=======\nB\u{e9}\n>>>>>>> b\n")) == .notUTF8(conflictCount: 1))
        #expect(ConflictFile.parse(bytes("x\n")) == .parsed(ConflictFile.parse("x\n")))
    }
}

@Suite("Toàn vẹn byte với git thật: CRLF, không phải UTF-8, BOM, đổi tên")
struct ByteIntegrityGitTests {
    @Test func parsesCRLFDiffFromGit() async throws {
        let t = try await makeRepo("c.txt", base: bytes("a\r\nb\r\nc\r\n"), worktree: bytes("a\r\nB\r\nc\r\n"))
        defer { t.cleanup() }
        let diff = try #require(try await t.repo.workingDiff(FileChange(path: "c.txt", kind: .modified), kind: .unstaged))
        try #require(diff.hunks.count == 1)
        #expect(diff.hunks[0].lines.map(\.kind) == [.context, .deletion, .addition, .context])
        #expect(diff.hunks[0].lines.map(\.text) == ["a\r", "b\r", "B\r", "c\r"])
        #expect(diff.additions == 1 && diff.deletions == 1 && diff.supportsPartialStaging)
        #expect(DiffPresentation.build(diff).hunks[0].lines.map(\.text) == ["a", "b", "B", "c"])
    }

    @Test func stagesAndDiscardsSingleLinesInCRLFFile() async throws {
        let t = try await makeRepo("c.txt", base: bytes("a\r\nb\r\nc\r\nd\r\ne\r\nf\r\ng\r\nh\r\n"),
                                   worktree: bytes("a\r\nB\r\nc\r\nd\r\ne\r\nf\r\nG\r\nh\r\n"))
        defer { t.cleanup() }
        let change = FileChange(path: "c.txt", kind: .modified)

        // Stage riêng b → B: index đổi đúng một dòng, mọi "\r\n" còn nguyên.
        let patch = try await apply(.stage, t, change) { $0.text == "b\r" || $0.text == "B\r" }
        #expect(patch.contains("-b\r\n+B\r\n"))
        #expect(show(try await t.indexBlob("c.txt")) == show(bytes("a\r\nB\r\nc\r\nd\r\ne\r\nf\r\ng\r\nh\r\n")))

        // Huỷ riêng g → G trong working tree.
        try await apply(.discard, t, change) { $0.text == "g\r" || $0.text == "G\r" }
        #expect(show(try t.readBytes("c.txt")) == show(bytes("a\r\nB\r\nc\r\nd\r\ne\r\nf\r\ng\r\nh\r\n")))
        #expect(try await t.repo.workingDiff(change, kind: .unstaged) == nil)

        // Bỏ stage lại b → B: index về đúng bản gốc.
        try await apply(.unstage, t, change) { $0.text == "b\r" || $0.text == "B\r" }
        #expect(show(try await t.indexBlob("c.txt")) == show(bytes("a\r\nb\r\nc\r\nd\r\ne\r\nf\r\ng\r\nh\r\n")))
    }

    @Test func partialStagingOfFirstLineKeepsBOM() async throws {
        let base = bom + bytes("first\r\nsecond\r\nthird\r\n")
        let edited = bom + bytes("FIRST\r\nsecond\r\nTHIRD\r\n")
        let isFirst: (DiffLine) -> Bool = { $0.text == "\u{FEFF}first\r" || $0.text == "\u{FEFF}FIRST\r" }

        let staged = try await makeRepo("b.txt", base: base, worktree: edited)
        defer { staged.cleanup() }
        try await apply(.stage, staged, FileChange(path: "b.txt", kind: .modified), where: isFirst)
        #expect(show(try await staged.indexBlob("b.txt")) == show(bom + bytes("FIRST\r\nsecond\r\nthird\r\n")))

        let discarded = try await makeRepo("b.txt", base: base, worktree: edited)
        defer { discarded.cleanup() }
        try await apply(.discard, discarded, FileChange(path: "b.txt", kind: .modified), where: isFirst)
        #expect(show(try discarded.readBytes("b.txt")) == show(bom + bytes("first\r\nsecond\r\nTHIRD\r\n")))
    }

    @Test func noNewlineAdditionIsNeverFusedWithKeptLine() async throws {
        let change = FileChange(path: "d.txt", kind: .modified)

        // Stage "-x1" và "+y1" (không newline cuối), giữ x2: trước đây index thành "y1x2\n".
        let pair = try await makeRepo("d.txt", base: bytes("x1\nx2\n"), worktree: bytes("y1"))
        defer { pair.cleanup() }
        try await apply(.stage, pair, change) { $0.text == "x1" || $0.text == "y1" }
        #expect(show(try await pair.indexBlob("d.txt")) == show(bytes("x2\ny1")))
        #expect(show(try pair.readBytes("d.txt")) == show(bytes("y1")))

        // Stage riêng "+y1", giữ cả hai dòng cũ: trước đây "x1\ny1x2\n".
        let addition = try await makeRepo("d.txt", base: bytes("x1\nx2\n"), worktree: bytes("y1"))
        defer { addition.cleanup() }
        try await apply(.stage, addition, change) { $0.kind == .addition }
        #expect(show(try await addition.indexBlob("d.txt")) == show(bytes("x1\nx2\ny1")))

        // Bỏ stage riêng "-x1" (không newline cuối), giữ hai dòng thêm: trước đây "x1y1\ny2\n".
        let deletion = try await makeRepo("d.txt", base: bytes("x1"), worktree: bytes("y1\ny2\n"), staged: true)
        defer { deletion.cleanup() }
        try await apply(.unstage, deletion, change) { $0.kind == .deletion }
        #expect(show(try await deletion.indexBlob("d.txt")) == show(bytes("y1\ny2\nx1")))
    }

    @Test func gainedNewlineFollowsCRLFLineEnding() async throws {
        // Stage riêng dòng mới "d": "c" (không newline cuối) được thêm xuống dòng — phải là "\r\n" như cả file.
        let forward = try await makeRepo("c.txt", base: bytes("a\r\nb\r\nc"), worktree: bytes("a\r\nb\r\nc\r\nd"))
        defer { forward.cleanup() }
        let change = FileChange(path: "c.txt", kind: .modified)
        try await apply(.stage, forward, change) { $0.text == "d" }
        #expect(show(try await forward.indexBlob("c.txt")) == show(bytes("a\r\nb\r\nc\r\nd")))
        #expect(try await forward.repo.workingDiff(change, kind: .unstaged) == nil)

        // Áp ngược: bỏ stage hai dòng xoá CRLF khi dòng thêm cuối file không có newline → "y1" nhận "\r\n".
        let reverse = try await makeRepo("d.txt", base: bytes("x1\r\nx2\r\n"), worktree: bytes("y1"), staged: true)
        defer { reverse.cleanup() }
        try await apply(.unstage, reverse, FileChange(path: "d.txt", kind: .modified)) { $0.kind == .deletion }
        #expect(show(try await reverse.indexBlob("d.txt")) == show(bytes("x1\r\ny1\r\nx2\r\n")))
    }

    @Test(arguments: [
        ("a.txt", "b.txt"),
        ("Tài liệu/ghi chú.txt", "Tài liệu/ghi chú mới.txt"),
        ("q\"a.txt", "q\"b.txt"),
    ])
    func unstagingLinesOfRenamedFileKeepsTheRename(from: String, to: String) async throws {
        let t = try await TestRepo.make()
        defer { t.cleanup() }
        try t.write(from, "l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\n")
        try await t.commitAll("base")
        try await t.git("mv", from, to)
        try t.write(to, "l1\nL2\nl3\nl4\nl5\nl6\nl7\nl8\nL9\nl10\n")
        try await t.repo.stage(paths: [to])
        let change = try #require(try await t.repo.status().staged.first)
        #expect(change == FileChange(path: to, oldPath: from, kind: .renamed))

        // Unstage riêng l2 → L2. Trước đây patch giữ "rename from/to" nên áp ngược đổi tên ngược trong index.
        let patch = try await apply(.unstage, t, change) { $0.text == "l2" || $0.text == "L2" }
        #expect(!patch.contains("rename"))
        #expect(try await t.repo.status().staged == [FileChange(path: to, oldPath: from, kind: .renamed)])
        #expect(show(try await t.indexBlob(to)) == show(bytes("l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nL9\nl10\n")))
        #expect(show(try t.readBytes(to)) == show(bytes("l1\nL2\nl3\nl4\nl5\nl6\nl7\nl8\nL9\nl10\n")))
    }

    @Test func nonUTF8FileOnlyStagesWholeFile() async throws {
        let base = latin1("caf\u{e9} un\nna\u{ef}ve deux\ntr\u{e8}s trois\n")
        let edited = latin1("caf\u{e9} un\nna\u{ef}ve DEUX\u{a4}\ntr\u{e8}s trois\n")
        let t = try await makeRepo("l.txt", base: base, worktree: edited)
        defer { t.cleanup() }
        let change = FileChange(path: "l.txt", kind: .modified)

        let diff = try #require(try await t.repo.workingDiff(change, kind: .unstaged))
        #expect(!diff.isValidUTF8 && !diff.supportsPartialStaging)
        try #require(diff.hunks.count == 1)
        #expect(diff.additions == 1 && diff.deletions == 1)
        #expect(PatchBuilder.makePatch(file: diff, selection: PatchBuilder.selectionForWholeHunk(diff.hunks[0]), reverse: false) == nil)
        // Đối chứng: đi qua chuỗi giải mã lỏng rồi mã hoá lại sẽ đổi byte — lý do phải chặn.
        #expect(Data(String(decoding: edited, as: UTF8.self).utf8) != edited)

        // Stage / bỏ stage cả file (git add / git reset) giữ nguyên từng byte.
        try await t.repo.stage(paths: ["l.txt"])
        #expect(show(try await t.indexBlob("l.txt")) == show(edited))
        let staged = try #require(try await t.repo.workingDiff(change, kind: .staged))
        #expect(!staged.supportsPartialStaging)
        try await t.repo.unstage(paths: ["l.txt"], headExists: true)
        #expect(show(try await t.indexBlob("l.txt")) == show(base))
        #expect(show(try t.readBytes("l.txt")) == show(edited))
    }

    @Test func conflictInNonUTF8FileIsNeverRewritten() async throws {
        let ours = latin1("Xin ch\u{e0}o\nVi\u{ea}\u{f2}t Nam c\u{f4}ng\nH\u{e0} N\u{f2}i\n")
        let t = try await makeConflict(base: latin1("Xin ch\u{e0}o\nVi\u{ea}\u{f2}t Nam\nH\u{e0} N\u{f2}i\n"), ours: ours,
                                       theirs: latin1("Xin ch\u{e0}o\nVi\u{ea}\u{f2}t Nam t\u{e2}y\nH\u{e0} N\u{f2}i\n"))
        defer { t.cleanup() }
        let before = try t.readBytes("f.txt")
        let unmerged = try await t.git("ls-files", "-u")
        #expect(String(decoding: before, as: UTF8.self).contains("<<<<<<< HEAD"))

        #expect(ConflictFile.parse(before) == .notUTF8(conflictCount: 1))
        do {
            _ = try t.repo.readWorkingFile("f.txt")
            Issue.record("đọc file không phải UTF-8 phải báo lỗi")
        } catch RepositoryError.notUTF8(let path) {
            #expect(path == "f.txt")
        }
        // Không có gì bị ghi: working tree và 3 mức xung đột trong index nguyên vẹn.
        #expect(show(try t.readBytes("f.txt")) == show(before))
        #expect(try await t.git("ls-files", "-u") == unmerged)
        #expect(try await t.repo.status().conflicts == [ConflictEntry(path: "f.txt", kind: .bothModified)])

        // Lối thoát giữ nguyên byte: chọn cả file của một bên (git checkout --ours).
        try await t.repo.resolveConflict(path: "f.txt", kind: .bothModified, useOurs: true)
        #expect(show(try t.readBytes("f.txt")) == show(ours))
        #expect(show(try await t.indexBlob("f.txt")) == show(ours))
    }

    @Test func conflictResolutionKeepsBOMAndCRLF() async throws {
        func crlf(_ lines: String...) -> Data { bom + bytes(lines.map { $0 + "\r\n" }.joined()) }
        let t = try await makeConflict(base: crlf("one", "two", "three"), ours: crlf("one", "OURS", "three"),
                                       theirs: crlf("one", "THEIRS", "three"))
        defer { t.cleanup() }

        guard case .parsed(let file) = ConflictFile.parse(try t.readBytes("f.txt")) else {
            Issue.record("file UTF-8 có BOM phải giải được trong app")
            return
        }
        #expect(file.hasBOM)
        try #require(file.conflictCount == 1)
        #expect(file.blocks[0].oursLabel == "HEAD" && file.blocks[0].theirsLabel == "feature")
        #expect(file.blocks[0].ours == ["OURS"] && file.blocks[0].theirs == ["THEIRS"])

        let resolved = try #require(file.resolvedData(with: [0: .oursThenTheirs]))
        #expect(show(resolved) == show(crlf("one", "OURS", "THEIRS", "three")))
        try t.repo.writeWorkingFile("f.txt", data: resolved)
        try await t.repo.markResolved(paths: ["f.txt"])
        try await t.repo.continueOperation(.merging)
        #expect(t.repo.operationState() == nil)
        let committed = try await t.repo.blob("HEAD:f.txt")
        #expect(show(committed) == show(crlf("one", "OURS", "THEIRS", "three")))
        // Đọc chặt dạng chuỗi cũng giữ BOM (U+FEFF), không như String(data:encoding:).
        #expect(try t.repo.readWorkingFile("f.txt").unicodeScalars.first == "\u{FEFF}")
    }

    @Test func pendingMergeMessageWithCRLFDropsComments() async throws {
        let t = try await TestRepo.make()
        defer { t.cleanup() }
        // "\r\n" là MỘT Character: tách theo Character thì cả message là một dòng, dòng chú thích "#" lọt vào.
        try Data("Merge branch 'x'\r\n\r\nChi tiết\r\n# Conflicts:\r\n#\tf.txt\r\n".utf8)
            .write(to: t.repo.gitDir.appendingPathComponent("MERGE_MSG"))
        #expect(t.repo.pendingCommitMessage() == "Merge branch 'x'\n\nChi tiết")
    }

    @Test func blankContextLinesSurviveSuppressBlankEmptyConfig() async throws {
        let t = try await makeRepo("b.txt", base: bytes("a\n\nb\nc\n"), worktree: bytes("a\n\nB\nc\n"))
        defer { t.cleanup() }
        // Cấu hình của repo bị ghi đè bằng -c: dòng ngữ cảnh rỗng vẫn có " " nên không bị parser bỏ qua.
        try await t.git("config", "diff.suppressBlankEmpty", "true")
        let change = FileChange(path: "b.txt", kind: .modified)
        let diff = try #require(try await t.repo.workingDiff(change, kind: .unstaged))
        #expect(diff.hunks.first?.lines.map(\.text) == ["a", "", "b", "B", "c"])
        try await apply(.stage, t, change) { _ in true }
        #expect(show(try await t.indexBlob("b.txt")) == show(bytes("a\n\nB\nc\n")))
    }

    @Test func workingDiffNeverRunsTextconvDriver() async throws {
        let t = try await makeRepo("t.txt", base: bytes("x1\nx2\nx3\n"), worktree: bytes("x1\nX2\nx3\n"))
        defer { t.cleanup() }
        // Repo lạ đặt textconv thành lệnh tuỳ ý: xem diff không được chạy nó, và patch phải dựng từ byte thật
        // (textconv in hoa cả hai phía thì git còn báo "không có thay đổi").
        let marker = t.url.appendingPathComponent("textconv-ran")
        try t.write(".gitattributes", "*.txt diff=upper\n")
        try await t.git("config", "diff.upper.textconv", "touch '\(marker.path)'; tr a-z A-Z <")
        let change = FileChange(path: "t.txt", kind: .modified)

        let diff = try #require(try await t.repo.workingDiff(change, kind: .unstaged))
        #expect(diff.hunks.first?.lines.map(\.text) == ["x1", "x2", "X2", "x3"])
        #expect(!FileManager.default.fileExists(atPath: marker.path))
        try await apply(.stage, t, change) { _ in true }
        #expect(show(try await t.indexBlob("t.txt")) == show(bytes("x1\nX2\nx3\n")))
    }

    @Test func stagesOneLineFromZeroContextDiff() async throws {
        let t = try await makeRepo("z.txt", base: bytes("a\nb\nc\nd\ne\nf\n"), worktree: bytes("a\nB\nc\nd\nE\nf\n"))
        defer { t.cleanup() }
        let change = FileChange(path: "z.txt", kind: .modified)
        // Cài đặt "0 dòng ngữ cảnh": hunk không có dòng ngữ cảnh, git apply chỉ nhận khi có --unidiff-zero.
        let diff = try #require(try await t.repo.workingDiff(change, kind: .unstaged, context: 0))
        #expect(diff.hunks.count == 2 && diff.hunks.allSatisfy { !$0.lines.contains { $0.kind == .context } })
        let patch = try #require(PatchBuilder.makePatch(file: diff, selection: selection(diff) { $0.text == "e" || $0.text == "E" },
                                                        reverse: false))
        await #expect(throws: GitError.self) { try await t.repo.applyPatch(patch, cached: true, reverse: false) }
        try await t.repo.applyPatch(patch, cached: true, reverse: false, unidiffZero: true)
        #expect(show(try await t.indexBlob("z.txt")) == show(bytes("a\nb\nc\nd\nE\nf\n")))
    }

    @Test func replacingFileRefusesWhenChangedOnDisk() async throws {
        let t = try await TestRepo.make()
        defer { t.cleanup() }
        try t.write("r.txt", bytes: bytes("<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> b\n"))
        let loaded = try t.readBytes("r.txt")

        // Sửa bên ngoài sau khi app đã đọc file (đang giải xung đột): không được ghi đè mất phần sửa đó.
        try t.write("r.txt", bytes: bytes("sửa tay trong editor\n"))
        #expect(throws: RepositoryError.self) {
            try t.repo.replaceWorkingFile("r.txt", data: bytes("ours\n"), expecting: loaded)
        }
        #expect(show(try t.readBytes("r.txt")) == show(bytes("sửa tay trong editor\n")))

        // Không ai sửa thì ghi bình thường.
        try t.repo.replaceWorkingFile("r.txt", data: bytes("ours\n"), expecting: try t.readBytes("r.txt"))
        #expect(show(try t.readBytes("r.txt")) == show(bytes("ours\n")))
    }
}
