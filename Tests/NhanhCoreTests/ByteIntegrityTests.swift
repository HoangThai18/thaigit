import Foundation
import Testing
@testable import NhanhCore

/// Partial operations as the app does them: stage = applied forward into the index, unstage = applied in reverse into the index, discard = applied in reverse into the working tree.
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

/// Builds a patch from the current diff and applies it with git, like the app does. Returns the applied patch.
@discardableResult
private func apply(_ op: PartialOp, _ t: TestRepo, _ change: FileChange,
                   where predicate: (DiffLine) -> Bool) async throws -> String {
    let diff = try #require(try await t.repo.workingDiff(change, kind: op == .unstage ? .staged : .unstaged))
    let patch = try #require(PatchBuilder.makePatch(file: diff, selection: selection(diff, where: predicate), reverse: op != .stage))
    try await t.repo.applyPatch(patch, cached: op != .discard, reverse: op != .stage)
    return patch
}

/// A repo with `path` committed with `base`; the working tree holds `worktree` (staged when `staged`).
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

/// Two branches editing the same spot → `git merge feature` stops with a conflict in f.txt.
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

        // Display (and bolding within a line) uses the text with "\r" removed; the raw data keeps "\r" so the patch can be built.
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
        // Still displays (bad bytes become U+FFFD) but a patch is never built from that text.
        #expect(!files[1].isValidUTF8 && !files[1].supportsPartialStaging)
        #expect(files[1].hunks[0].lines.map(\.text) == ["caf\u{FFFD}", "caf\u{FFFD}!"])
        #expect(PatchBuilder.makePatch(file: files[1], selection: PatchBuilder.selectionForWholeHunk(files[1].hunks[0]), reverse: false) == nil)
    }

    @Test func lineStartingWithCombiningMarkIsKept() throws {
        // A space or "-" plus a combining mark is ONE Character: examining the marker by Character loses the line.
        let text = "diff --git a/n.txt b/n.txt\n--- a/n.txt\n+++ b/n.txt\n@@ -1,2 +1,2 @@\n \u{301}a\n-\u{301}x\n+\u{301}y\n"
        let hunk = try #require(DiffParser.parse(text).first?.hunks.first)
        #expect(hunk.lines.map(\.kind) == [.context, .deletion, .addition])
        #expect(hunk.lines.map(\.text) == ["\u{301}a", "\u{301}x", "\u{301}y"])
    }

    @Test func noNewlineChangeMovesBelowKeptLines() throws {
        // "x1\nx2\n" → "y1" (no trailing newline). Picking "-x1" and "+y1": "+y1" must not end up before " x2".
        let text = "diff --git a/d.txt b/d.txt\n--- a/d.txt\n+++ b/d.txt\n@@ -1,2 +1 @@\n-x1\n-x2\n+y1\n\\ No newline at end of file\n"
        let file = try #require(DiffParser.parse(text).first)
        let patch = try #require(PatchBuilder.makePatch(file: file, selection: [0: [0, 2]], reverse: false))
        #expect(patch.hasSuffix("@@ -1,2 +1,2 @@\n-x1\n x2\n+y1\n\\ No newline at end of file\n"))
    }

    @Test func gainedNewlineUsesNeighbourLineEnding() throws {
        let header = "diff --git a/c.txt b/c.txt\n--- a/c.txt\n+++ b/c.txt\n"
        // Applying two deleted CRLF lines in reverse: "y1" (no newline) must get "\r\n", not a lone "\n".
        let crlf = try #require(DiffParser.parse(header + "@@ -1,2 +1 @@\n-x1\r\n-x2\r\n+y1\n\\ No newline at end of file\n").first)
        let reversed = try #require(PatchBuilder.makePatch(file: crlf, selection: [0: [0, 1]], reverse: true))
        #expect(show(bytes(reversed)) == show(bytes(header + "@@ -1,3 +1,1 @@\n-x1\r\n-y1\r\n+y1\n\\ No newline at end of file\n-x2\r\n")))
        // An LF file stays "\n".
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

        // A C-quoted name stays in its escaped form; a name with a space keeps the trailing TAB on ---/+++.
        let quoted = "diff --git \"a/t\\303\\240i.txt\" \"b/m\\341\\273\\233i.txt\"\nsimilarity index 90%\nrename from \"t\\303\\240i.txt\"\nrename to \"m\\341\\273\\233i.txt\"\nindex 1..2 100644\n--- \"a/t\\303\\240i.txt\"\n+++ \"b/m\\341\\273\\233i.txt\"\n"
        #expect(patch(quoted, reverse: true) == "diff --git \"a/m\\341\\273\\233i.txt\" \"b/m\\341\\273\\233i.txt\"\nindex 1..2 100644\n--- \"a/m\\341\\273\\233i.txt\"\n+++ \"b/m\\341\\273\\233i.txt\"\n" + body)
        let spaced = "diff --git a/old name.txt b/new name.txt\nsimilarity index 90%\nrename from old name.txt\nrename to new name.txt\nindex 1..2 100644\n--- a/old name.txt\t\n+++ b/new name.txt\t\n"
        #expect(patch(spaced, reverse: true) == "diff --git a/new name.txt b/new name.txt\nindex 1..2 100644\n--- a/new name.txt\t\n+++ b/new name.txt\t\n" + body)
        let copied = "diff --git a/a.txt b/c.txt\nsimilarity index 80%\ncopy from a.txt\ncopy to c.txt\nindex 1..2 100644\n--- a/a.txt\n+++ b/c.txt\n"
        #expect(patch(copied, reverse: true) == "diff --git a/c.txt b/c.txt\nindex 1..2 100644\n--- a/c.txt\n+++ b/c.txt\n" + body)
        // An unreadable name (an odd prefix) on a renamed file: refuse rather than guess.
        #expect(patch("diff --git x/a.txt y/b.txt\nsimilarity index 80%\nrename from a.txt\nrename to b.txt\n--- x/a.txt\n+++ y/b.txt\n", reverse: true) == nil)
    }

    @Test func conflictMarkersAfterBOMAndInMixedLineEndings() throws {
        // A BOM followed by a conflict marker on the very first line: the BOM must not hide the marker, and it must survive resolving.
        let bomFirst = ConflictFile.parse("\u{FEFF}<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> b\nz\n")
        #expect(bomFirst.hasBOM && bomFirst.conflictCount == 1)
        #expect(bomFirst.resolvedData(with: [0: .theirs]) == bytes("\u{FEFF}y\nz\n"))

        // A CRLF file whose marker line has only "\n": still recognised; each line keeps its own line ending.
        let mixed = ConflictFile.parse("a\r\n<<<<<<< HEAD\nx\r\n=======\ny\n>>>>>>> b\nz\r\n")
        try #require(mixed.conflictCount == 1)
        #expect(mixed.lineEnding == "\r\n")
        #expect(mixed.blocks[0].ours == ["x"] && mixed.blocks[0].theirs == ["y"])
        #expect(mixed.resolvedData(with: [0: .oursThenTheirs]) == bytes("a\r\nx\r\ny\nz\r\n"))

        // Not UTF-8: no decoded content is returned, only the block count is (the markers are ASCII).
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

        // Staging b → B on its own: the index changes exactly one line, every "\r\n" intact.
        let patch = try await apply(.stage, t, change) { $0.text == "b\r" || $0.text == "B\r" }
        #expect(patch.contains("-b\r\n+B\r\n"))
        #expect(show(try await t.indexBlob("c.txt")) == show(bytes("a\r\nB\r\nc\r\nd\r\ne\r\nf\r\ng\r\nh\r\n")))

        // Discarding g → G on its own in the working tree.
        try await apply(.discard, t, change) { $0.text == "g\r" || $0.text == "G\r" }
        #expect(show(try t.readBytes("c.txt")) == show(bytes("a\r\nB\r\nc\r\nd\r\ne\r\nf\r\ng\r\nh\r\n")))
        #expect(try await t.repo.workingDiff(change, kind: .unstaged) == nil)

        // Unstaging b → B again: the index returns to exactly the original content.
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

        // Stage "-x1" and "+y1" (no trailing newline), keep x2: the index used to become "y1x2\n".
        let pair = try await makeRepo("d.txt", base: bytes("x1\nx2\n"), worktree: bytes("y1"))
        defer { pair.cleanup() }
        try await apply(.stage, pair, change) { $0.text == "x1" || $0.text == "y1" }
        #expect(show(try await pair.indexBlob("d.txt")) == show(bytes("x2\ny1")))
        #expect(show(try pair.readBytes("d.txt")) == show(bytes("y1")))

        // Stage only "+y1", keep both old lines: it used to be "x1\ny1x2\n".
        let addition = try await makeRepo("d.txt", base: bytes("x1\nx2\n"), worktree: bytes("y1"))
        defer { addition.cleanup() }
        try await apply(.stage, addition, change) { $0.kind == .addition }
        #expect(show(try await addition.indexBlob("d.txt")) == show(bytes("x1\nx2\ny1")))

        // Unstage only "-x1" (no trailing newline), keep both added lines: it used to be "x1y1\ny2\n".
        let deletion = try await makeRepo("d.txt", base: bytes("x1"), worktree: bytes("y1\ny2\n"), staged: true)
        defer { deletion.cleanup() }
        try await apply(.unstage, deletion, change) { $0.kind == .deletion }
        #expect(show(try await deletion.indexBlob("d.txt")) == show(bytes("y1\ny2\nx1")))
    }

    @Test func gainedNewlineFollowsCRLFLineEnding() async throws {
        // Staging the new line "d" alone: "c" (no trailing newline) gets a newline added — and it must be "\r\n" like the rest of the file.
        let forward = try await makeRepo("c.txt", base: bytes("a\r\nb\r\nc"), worktree: bytes("a\r\nb\r\nc\r\nd"))
        defer { forward.cleanup() }
        let change = FileChange(path: "c.txt", kind: .modified)
        try await apply(.stage, forward, change) { $0.text == "d" }
        #expect(show(try await forward.indexBlob("c.txt")) == show(bytes("a\r\nb\r\nc\r\nd")))
        #expect(try await forward.repo.workingDiff(change, kind: .unstaged) == nil)

        // Applied in reverse: unstaging two deleted CRLF lines when the file's last added line has no newline → "y1" gets "\r\n".
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

        // Unstage l2 → L2 on its own. The patch used to keep "rename from/to", so applying it in reverse renamed the file back in the index.
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
        // The contrast: going through a leniently decoded string and re-encoding changes bytes — the reason non-UTF-8 must be blocked.
        #expect(Data(String(decoding: edited, as: UTF8.self).utf8) != edited)

        // Whole-file stage / unstage (git add / git reset) keeps every byte.
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
        // Nothing is written: the working tree and the 3 conflict stages in the index stay intact.
        #expect(show(try t.readBytes("f.txt")) == show(before))
        #expect(try await t.git("ls-files", "-u") == unmerged)
        #expect(try await t.repo.status().conflicts == [ConflictEntry(path: "f.txt", kind: .bothModified)])

        // An exit path that preserves bytes: take the whole file from one side (git checkout --ours).
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
        // Strict decoding as a string also keeps the BOM (U+FEFF), unlike String(data:encoding:).
        #expect(try t.repo.readWorkingFile("f.txt").unicodeScalars.first == "\u{FEFF}")
    }

    @Test func pendingMergeMessageWithCRLFDropsComments() async throws {
        let t = try await TestRepo.make()
        defer { t.cleanup() }
        // "\r\n" is ONE Character: splitting by Character makes the whole message one line and a "#" comment line leaks in.
        try Data("Merge branch 'x'\r\n\r\nChi tiết\r\n# Conflicts:\r\n#\tf.txt\r\n".utf8)
            .write(to: t.repo.gitDir.appendingPathComponent("MERGE_MSG"))
        #expect(t.repo.pendingCommitMessage() == "Merge branch 'x'\n\nChi tiết")
    }

    @Test func blankContextLinesSurviveSuppressBlankEmptyConfig() async throws {
        let t = try await makeRepo("b.txt", base: bytes("a\n\nb\nc\n"), worktree: bytes("a\n\nB\nc\n"))
        defer { t.cleanup() }
        // The repo's config is overridden with -c so an empty context line still has " " and isn't skipped by the parser.
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
        // An untrusted repo sets textconv to an arbitrary command: viewing a diff must not run it, and the patch has to be built
        // from real bytes (with textconv capitalising both sides git even reports "no changes").
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
        // The "0 context lines" setting: the hunk has no context, and git apply only accepts it with --unidiff-zero.
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

        // An outside edit after the app already read the file (while resolving a conflict): it must not be overwritten away.
        try t.write("r.txt", bytes: bytes("sửa tay trong editor\n"))
        #expect(throws: RepositoryError.self) {
            try t.repo.replaceWorkingFile("r.txt", data: bytes("ours\n"), expecting: loaded)
        }
        #expect(show(try t.readBytes("r.txt")) == show(bytes("sửa tay trong editor\n")))

        // With nobody editing, the write is a normal one.
        try t.repo.replaceWorkingFile("r.txt", data: bytes("ours\n"), expecting: try t.readBytes("r.txt"))
        #expect(show(try t.readBytes("r.txt")) == show(bytes("ours\n")))
    }
}
