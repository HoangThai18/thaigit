import Foundation
import Testing
@testable import NhanhCore

@Suite("Diff parsing, inline highlight, conflicts")
struct DiffTests {
    let sample = """
    diff --git a/src/app.swift b/src/app.swift
    index 1111111..2222222 100644
    --- a/src/app.swift
    +++ b/src/app.swift
    @@ -1,4 +1,5 @@ struct App
     import Foundation
    -let a = 1
    +let a = 2
    +let b = 3
     let c = 4
     let d = 5
    @@ -10,2 +11,2 @@
     x
    -y
    \\ No newline at end of file
    +z
    \\ No newline at end of file
    diff --git a/img.png b/img.png
    index 3333333..4444444 100644
    Binary files a/img.png and b/img.png differ

    """

    @Test func parsesHunksAndLineNumbers() throws {
        let files = DiffParser.parse(sample)
        #expect(files.count == 2)
        let file = files[0]
        #expect(file.oldPath == "src/app.swift")
        #expect(file.newPath == "src/app.swift")
        #expect(file.hunks.count == 2)
        #expect(file.additions == 3)
        #expect(file.deletions == 2)
        let hunk = file.hunks[0]
        #expect(hunk.oldStart == 1 && hunk.oldCount == 4 && hunk.newStart == 1 && hunk.newCount == 5)
        #expect(hunk.section == "struct App")
        #expect(hunk.lines.map(\.kind) == [.context, .deletion, .addition, .addition, .context, .context])
        #expect(hunk.lines[1].oldNumber == 2 && hunk.lines[1].newNumber == nil)
        #expect(hunk.lines[3].newNumber == 3)
        #expect(hunk.lines[4].oldNumber == 3 && hunk.lines[4].newNumber == 4)
        #expect(file.hunks[1].lines.map(\.kind) == [.context, .deletion, .noNewline, .addition, .noNewline])
        #expect(file.supportsPartialStaging)
        #expect(files[1].isBinary)
        #expect(!files[1].supportsPartialStaging)
    }

    @Test func parsesNewDeletedAndRenamedHeaders() {
        let text = """
        diff --git a/new.txt b/new.txt
        new file mode 100644
        index 0000000..1111111
        --- /dev/null
        +++ b/new.txt
        @@ -0,0 +1,2 @@
        +a
        +b
        diff --git a/old name.txt b/new name.txt
        similarity index 90%
        rename from old name.txt
        rename to new name.txt
        index 1..2 100644
        --- a/old name.txt
        +++ b/new name.txt
        @@ -1 +1 @@
        -x
        +y
        diff --git a/run.sh b/run.sh
        old mode 100644
        new mode 100755

        """
        let files = DiffParser.parse(text)
        #expect(files.count == 3)
        #expect(files[0].isNewFile && files[0].oldPath == nil && files[0].newPath == "new.txt")
        #expect(!files[0].supportsPartialStaging)
        #expect(files[1].oldPath == "old name.txt" && files[1].newPath == "new name.txt" && files[1].similarity == 90)
        #expect(files[1].hunks[0].oldCount == 1 && files[1].hunks[0].newCount == 1)
        #expect(files[2].isModeChangeOnly)
    }

    @Test func inlineHighlightFindsChangedMiddle() throws {
        let ranges = try #require(InlineDiff.changedRanges(old: "let value = computeTotal(a, b)", new: "let value = computeSum(a, b)"))
        #expect(ranges.old == 19..<24)
        #expect(ranges.new == 19..<22)
        #expect(InlineDiff.changedRanges(old: "abc", new: "xyz") == nil)
        let hunk = DiffParser.parse(sample)[0].hunks[0]
        let highlights = InlineDiff.highlights(for: hunk)
        #expect(highlights[1] == 8..<9)
        #expect(highlights[2] == 8..<9)
    }

    @Test func parsesAndResolvesConflictBlocks() throws {
        let text = """
        header
        <<<<<<< HEAD
        ours 1
        ours 2
        ||||||| base
        base
        =======
        theirs
        >>>>>>> feature/x
        middle
        <<<<<<< HEAD
        =======
        added by them
        >>>>>>> feature/x
        footer

        """
        let file = ConflictFile.parse(text)
        #expect(file.conflictCount == 2)
        let first = file.blocks[0]
        #expect(first.oursLabel == "HEAD" && first.theirsLabel == "feature/x")
        #expect(first.ours == ["ours 1", "ours 2"])
        #expect(first.base == ["base"])
        #expect(first.theirs == ["theirs"])
        #expect(file.blocks[1].ours.isEmpty)
        #expect(file.resolved(with: [0: .ours]) == nil)
        let resolved = try #require(file.resolved(with: [0: .theirsThenOurs, 1: .theirs]))
        #expect(resolved == "header\ntheirs\nours 1\nours 2\nmiddle\nadded by them\nfooter\n")
    }

    @Test func preservesCRLFWhenResolving() throws {
        let text = "a\r\n<<<<<<< HEAD\r\nx\r\n=======\r\ny\r\n>>>>>>> b\r\nz"
        let file = ConflictFile.parse(text)
        #expect(file.lineEnding == "\r\n")
        #expect(!file.endsWithNewline)
        #expect(file.resolved(with: [0: .oursThenTheirs]) == "a\r\nx\r\ny\r\nz")
    }

    @Test func ignoresIncompleteMarkers() {
        let file = ConflictFile.parse("<<<<<<< not a conflict\njust text\n")
        #expect(file.conflictCount == 0)
        #expect(file.resolved(with: [:]) == "<<<<<<< not a conflict\njust text\n")
    }
}

@Suite("Diff bỏ qua khoảng trắng (-w)")
struct IgnoreWhitespaceDiffTests {
    @Test func hidesWhitespaceOnlyChanges() async throws {
        let t = try await TestRepo.make()
        defer { t.cleanup() }
        try t.write("a.js", "if (x) {\n  run();\n}\n")
        try await t.commitAll("init")
        try t.write("a.js", "if (x) {\n    run();\n}\nnew();\n")
        let change = FileChange(path: "a.js", kind: .modified)

        let full = try #require(try await t.repo.workingDiff(change, kind: .unstaged))
        #expect(full.additions == 2 && full.deletions == 1)
        let ignored = try #require(try await t.repo.workingDiff(change, kind: .unstaged, ignoreWhitespace: true))
        #expect(ignored.additions == 1 && ignored.deletions == 0)

        try await t.commitAll("sửa")
        let head = try await t.repo.resolveCommit("HEAD")
        let parent = try await t.repo.resolveCommit("HEAD~1")
        let commitDiff = try #require(try await t.repo.diff(commit: head, parent: parent, file: change, ignoreWhitespace: true))
        #expect(commitDiff.additions == 1 && commitDiff.deletions == 0)
    }
}

@Suite("Tô màu cú pháp trong diff")
struct SyntaxHighlighterTests {
    private func kinds(_ line: String, _ path: String) -> [(String, SyntaxTokenKind)] {
        let chars = Array(line)
        let language = SyntaxLanguage.forPath(path)!
        return SyntaxHighlighter.tokens(line, language: language).map { (String(chars[$0.range]), $0.kind) }
    }

    @Test func javascriptTokens() {
        let tokens = kinds("const name = 'Thái'; // chào 42", "src/app.ts")
        #expect(tokens.map(\.0) == ["const", "'Thái'", "// chào 42"])
        #expect(tokens.map(\.1) == [.keyword, .string, .comment])
    }

    @Test func phpAndNumbersAndEscapes() {
        let tokens = kinds(#"return $this->x + 10 . "a\"b"; /* ok */ $y"#, "a.php")
        #expect(tokens.map(\.0) == ["return", "$this", "10", #""a\"b""#, "/* ok */"])
        #expect(tokens.map(\.1) == [.keyword, .keyword, .number, .string, .comment])
    }

    @Test func unknownLanguagesAndHugeLinesAreLeftPlain() {
        #expect(SyntaxLanguage.forPath("README") == nil)
        #expect(SyntaxLanguage.forPath("Dockerfile") != nil)
        let long = String(repeating: "a", count: SyntaxHighlighter.maxLineLength + 1)
        #expect(SyntaxHighlighter.tokens(long, language: SyntaxLanguage.forPath("a.js")!).isEmpty)
        #expect(kinds("x.return y", "a.js").isEmpty)
    }
}

@Suite("Danh sách file dạng cây")
struct FileTreeTests {
    private func describe(_ rows: [FileTreeRow]) -> [String] {
        rows.map { row in
            switch row {
            case .folder(_, let name, let depth, let count): return String(repeating: "  ", count: depth) + name + "/ (\(count))"
            case .file(let change, let depth): return String(repeating: "  ", count: depth) + change.fileName
            }
        }
    }

    @Test func buildsNestedFoldersAndCompactsSingleChains() {
        let files = ["src/app/views/a.js", "src/app/views/b.js", "src/lib/c.js", "README.md", "docs/guide/x.md"]
            .map { FileChange(path: $0, kind: .modified) }
        #expect(describe(FileTree.rows(files)) == [
            "docs/guide/ (1)", "  x.md",
            "src/ (3)", "  app/views/ (2)", "    a.js", "    b.js", "  lib/ (1)", "    c.js",
            "README.md",
        ])
        #expect(describe(FileTree.rows(files, collapsed: ["src"])) == ["docs/guide/ (1)", "  x.md", "src/ (3)", "README.md"])
    }
}
