import Foundation
import Testing
@testable import NhanhCore

@Suite("Parsers")
struct ParserTests {
    @Test func parsesPorcelainV2Status() {
        let records = [
            "# branch.oid 1234567890abcdef1234567890abcdef12345678",
            "# branch.head feature/xin-chào",
            "# branch.upstream origin/feature/xin-chào",
            "# branch.ab +2 -3",
            "# stash 4",
            "1 M. N... 100644 100644 100644 aaa bbb src/staged only.swift",
            "1 .M N... 100644 100644 100644 aaa bbb README.md",
            "1 MM N... 100644 100644 100644 aaa bbb both.txt",
            "2 R. N... 100644 100644 100644 aaa bbb R100 new name.txt",
            "old name.txt",
            "u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.txt",
            "? thư mục/mới.txt",
            "! ignored.log",
        ]
        let data = Data((records.joined(separator: "\0") + "\0").utf8)
        let status = GitParsers.parseStatus(data)

        #expect(status.head == .branch(name: "feature/xin-chào", oid: "1234567890abcdef1234567890abcdef12345678"))
        #expect(status.upstream == "origin/feature/xin-chào")
        #expect(status.ahead == 2)
        #expect(status.behind == 3)
        #expect(status.stashCount == 4)
        #expect(status.staged.map(\.path) == ["src/staged only.swift", "both.txt", "new name.txt"])
        #expect(status.staged[2].kind == .renamed)
        #expect(status.staged[2].oldPath == "old name.txt")
        #expect(status.unstaged.map(\.path) == ["README.md", "both.txt", "thư mục/mới.txt"])
        #expect(status.unstaged[2].kind == .untracked)
        #expect(status.conflicts == [ConflictEntry(path: "conflict.txt", kind: .bothModified)])
        #expect(status.changedFileCount == 6)
    }

    @Test func parsesDetachedAndUnbornHead() {
        let detached = GitParsers.parseStatus(Data("# branch.oid abcdef1234567\0# branch.head (detached)\0".utf8))
        #expect(detached.head == .detached(oid: "abcdef1234567"))
        let unborn = GitParsers.parseStatus(Data("# branch.oid (initial)\0# branch.head main\0".utf8))
        #expect(unborn.head == .branch(name: "main", oid: nil))
        #expect(unborn.head.isUnborn)
    }

    @Test func parsesNameStatusWithRenames() {
        let data = Data("M\0a.txt\0R087\0old/x.txt\0new/x.txt\0A\0b c.txt\0D\0gone.txt\0".utf8)
        let files = GitParsers.parseNameStatus(data)
        #expect(files == [
            FileChange(path: "a.txt", kind: .modified),
            FileChange(path: "new/x.txt", oldPath: "old/x.txt", kind: .renamed),
            FileChange(path: "b c.txt", kind: .added),
            FileChange(path: "gone.txt", kind: .deleted),
        ])
    }

    @Test func parsesRefs() {
        let sep = "\u{1f}"
        let lines = [
            ["refs/heads/main", "aaa", "", "origin/main", "ahead 1, behind 2", "*", "", "1700000000"],
            ["refs/heads/old", "bbb", "", "origin/old", "gone", " ", ""],
            ["refs/remotes/origin/HEAD", "aaa", "", "", "", " ", "refs/remotes/origin/main"],
            ["refs/remotes/origin/feature/x", "ccc", "", "", "", " ", ""],
            ["refs/tags/v1.0", "ddd", "eee", "", "", " ", ""],
        ].map { $0.joined(separator: sep) }
        let refs = GitParsers.parseRefs(lines.joined(separator: "\n"))
        #expect(refs.count == 4)
        #expect(refs[0].name == "main" && refs[0].isHead && refs[0].ahead == 1 && refs[0].behind == 2)
        #expect(refs[0].date == Date(timeIntervalSince1970: 1_700_000_000))
        #expect(refs[1].date == nil)
        #expect(refs[1].upstreamGone)
        #expect(refs[2].kind == .remoteBranch && refs[2].remoteName == "origin" && refs[2].shortBranchName == "feature/x")
        #expect(refs[3].kind == .tag && refs[3].target == "eee" && refs[3].isAnnotatedTag)
    }

    @Test func parsesLogRecords() {
        let sep = "\u{1f}"
        let record1 = ["1111111111", "2222222222 3333333333", "An", "an@x.vn", "1700000000", "Cn", "cn@x.vn", "1700000100", "Merge: xin chào"].joined(separator: sep)
        let record2 = ["2222222222", "", "B", "b@x", "1600000000", "B", "b@x", "1600000000", "Initial"].joined(separator: sep)
        let commits = GitParsers.parseLog(Data((record1 + "\0" + record2 + "\0").utf8))
        #expect(commits.count == 2)
        #expect(commits[0].parents == ["2222222222", "3333333333"])
        #expect(commits[0].isMerge)
        #expect(commits[0].subject == "Merge: xin chào")
        #expect(commits[1].parents.isEmpty)
        #expect(commits[1].authorDate == Date(timeIntervalSince1970: 1_600_000_000))
    }

    @Test func parsesRemotesAndProgress() {
        let remotes = GitParsers.parseRemotes("origin\tgit@github.com:a/b.git (fetch)\norigin\tgit@github.com:a/b.git (push)\nup\thttps://x/y (fetch)\nup\thttps://x/z (push)\n")
        #expect(remotes.map(\.name) == ["origin", "up"])
        #expect(remotes[1].pushURL == "https://x/z")
        #expect(GitParsers.progressFraction("Receiving objects:  45% (450/1000), 1.2 MiB") == 0.45)
        #expect(GitParsers.progressFraction("Counting objects: done.") == nil)
    }

    @Test func unquotesGitPaths() {
        #expect("\"a\\tb\\\"c\"".unquotedGitPath == "a\tb\"c")
        #expect("\"\\303\\251t\\303\\251\"".unquotedGitPath == "été")
        #expect("plain.txt".unquotedGitPath == "plain.txt")
    }

    @Test func parsesStashMessages() {
        let stash = Stash(index: 0, selector: "stash@{0}", sha: "x", parents: [], date: Date(), message: "WIP on main: abc1234 Sửa lỗi đăng nhập")
        #expect(stash.displayMessage == "WIP trên main: Sửa lỗi đăng nhập")
        #expect(stash.branchName == "main")
        let custom = Stash(index: 1, selector: "stash@{1}", sha: "y", parents: [], date: Date(), message: "On dev: tạm cất")
        #expect(custom.displayMessage == "tạm cất")
        #expect(custom.branchName == "dev")
    }

    @Test func defaultCloneDirectoryNames() {
        #expect(GitRepository.defaultDirectoryName(forCloneURL: "https://github.com/apple/swift.git") == "swift")
        #expect(GitRepository.defaultDirectoryName(forCloneURL: "git@github.com:me/du-an.git") == "du-an")
        #expect(GitRepository.defaultDirectoryName(forCloneURL: "https://gitlab.com/a/b/") == "b")
    }

    @Test func classifiesGitDirectoryChanges() {
        #expect(RepoWatcher.classifyGitPath("objects/ab/cdef") == [])
        #expect(RepoWatcher.classifyGitPath("index.lock") == [])
        #expect(RepoWatcher.classifyGitPath("index") == .workingTree)
        #expect(RepoWatcher.classifyGitPath("refs/heads/main") == [.refs, .workingTree])
        #expect(RepoWatcher.classifyGitPath("HEAD") == [.refs, .workingTree])
        #expect(RepoWatcher.classifyGitPath("MERGE_HEAD") == [.refs, .workingTree])
    }
}
