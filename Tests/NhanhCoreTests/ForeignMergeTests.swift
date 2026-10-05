import Foundation
import Testing
@testable import NhanhCore

@Suite("Merge từ repository khác")
struct ForeignMergeTests {
    @Test func parsesLsRemote() {
        let text = """
        ref: refs/heads/phat-trien\tHEAD
        1111111111111111111111111111111111111111\tHEAD
        1111111111111111111111111111111111111111\trefs/heads/phat-trien
        2222222222222222222222222222222222222222\trefs/heads/main
        ref: refs/remotes/origin/main\trefs/remotes/origin/HEAD
        2222222222222222222222222222222222222222\trefs/remotes/origin/HEAD

        """
        let parsed = ForeignBranches.parse(text)
        #expect(parsed.names == ["phat-trien", "main"])
        #expect(parsed.defaultBranch == "phat-trien")
        #expect(ForeignBranches.parse("") == ForeignBranches(names: [], defaultBranch: nil))
    }

    @Test func resolvesSources() throws {
        let base = FileManager.default.temporaryDirectory.appendingPathComponent("nhanh-src-\(UUID().uuidString)")
        let sibling = base.appendingPathComponent("du an A")
        try FileManager.default.createDirectory(at: sibling, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: base) }
        let repo = base.appendingPathComponent("B")
        try FileManager.default.createDirectory(at: repo, withIntermediateDirectories: true)

        #expect(GitRepository.resolveRepositorySource("  ../du an A/ ", relativeTo: repo) == sibling.standardizedFileURL.path)
        #expect(GitRepository.resolveRepositorySource(sibling.path + "/", relativeTo: repo) == sibling.standardizedFileURL.path)
        #expect(GitRepository.resolveRepositorySource("~", relativeTo: repo) == URL(fileURLWithPath: NSHomeDirectory()).standardizedFileURL.path)
        #expect(GitRepository.resolveRepositorySource("git@github.com:ten/a.git", relativeTo: repo) == "git@github.com:ten/a.git")
        #expect(GitRepository.resolveRepositorySource("https://github.com/ten/a.git", relativeTo: repo) == "https://github.com/ten/a.git")
        #expect(GitRepository.resolveRepositorySource("../khong-co", relativeTo: repo) == "../khong-co")

        #expect(GitRepository.anonymizedSource("https://ten:mat-khau@git.vd.vn/a.git") == "https://git.vd.vn/a.git")
        #expect(GitRepository.anonymizedSource("https://git.vd.vn/@a/b.git") == "https://git.vd.vn/@a/b.git")
        #expect(GitRepository.anonymizedSource("git@github.com:ten/a.git") == "git@github.com:ten/a.git")
    }

    /// Project A is sold to company B (B is a copy with no shared history): the first merge needs
    /// --allow-unrelated-histories, later ones have shared commits so they merge normally. No attempt ever leaves a remote or a temporary ref behind.
    @Test func mergesBranchOfUnrelatedRepository() async throws {
        let a = try await TestRepo.make()
        let b = try await TestRepo.make()
        defer { a.cleanup(); b.cleanup() }
        try a.write("chung.txt", "dòng 1\n")
        try await a.commitAll("A: khởi tạo")
        try await a.git("switch", "-c", "A")
        try a.write("sua-loi.txt", "đã sửa\n")
        try await a.commitAll("A: sửa lỗi")
        try b.write("rieng-b.txt", "của B\n")
        try await b.commitAll("B: khởi tạo")
        try await b.git("switch", "-c", "A")

        let branches = try await b.repo.branches(ofRepository: a.url.path)
        #expect(Set(branches.names) == ["main", "A"])
        #expect(branches.defaultBranch == "A")

        await #expect(throws: GitError.self) {
            try await b.repo.mergeBranch("A", fromRepository: a.url.path)
        }
        try await b.repo.mergeBranch("A", fromRepository: a.url.path, allowUnrelatedHistories: true)
        #expect(try b.read("sua-loi.txt") == "đã sửa\n")
        #expect(try b.read("rieng-b.txt") == "của B\n")
        #expect(try await b.repo.commitMessage("HEAD").hasPrefix("Merge branch 'A' of \(a.url.path)"))
        #expect(try await b.repo.status().head.branchName == "A")

        // Next time: an ordinary merge is enough.
        try a.write("sua-loi.txt", "đã sửa lần 2\n")
        try await a.commitAll("A: sửa lỗi lần 2")
        try await b.repo.mergeBranch("A", fromRepository: a.url.path)
        #expect(try b.read("sua-loi.txt") == "đã sửa lần 2\n")

        #expect(try await b.repo.remotes().isEmpty)
        #expect(try await b.git("for-each-ref", "refs/thaigit").isEmpty)
    }

    @Test func conflictLeavesNormalMergeState() async throws {
        let a = try await TestRepo.make()
        let b = try await TestRepo.make()
        defer { a.cleanup(); b.cleanup() }
        try a.write("f.txt", "gốc\n")
        try await a.commitAll("gốc")
        // B has no commits yet: the merge just brings the branch to exactly A's commit.
        try await b.repo.mergeBranch("main", fromRepository: a.url.path)
        #expect(try await b.repo.resolveCommit("HEAD") == (try await a.repo.resolveCommit("HEAD")))

        try a.write("f.txt", "A sửa\n")
        try await a.commitAll("A sửa")
        try b.write("f.txt", "B sửa\n")
        try await b.commitAll("B sửa")
        await #expect(throws: GitError.self) {
            try await b.repo.mergeBranch("main", fromRepository: a.url.path)
        }
        #expect(b.repo.operationState() == .merging)
        #expect(try await b.repo.status().conflicts.map(\.path) == ["f.txt"])
        #expect(b.repo.pendingCommitMessage()?.hasPrefix("Merge branch 'main' of ") == true)
        #expect(try await b.git("for-each-ref", "refs/thaigit").isEmpty)

        try await b.repo.abort(.merging)
        #expect(b.repo.operationState() == nil)
        #expect(try b.read("f.txt") == "B sửa\n")
    }

    /// Merging into a branch that isn't the current one: fetch happens BEFORE the checkout — a failing source (deleted
    /// branch, missing folder) leaves HEAD unchanged. If git refuses the merge right after the checkout (no
    /// MERGE_HEAD) the old branch is restored; on a conflict it stays on the target branch to be resolved like a
    /// normal merge.
    @Test func mergeIntoOtherBranchFetchesFirstAndReturnsWhenRefused() async throws {
        let a = try await TestRepo.make()
        let b = try await TestRepo.make()
        defer { a.cleanup(); b.cleanup() }
        try a.write("f.txt", "a\n")
        try await a.commitAll("A")
        try b.write("g.txt", "b\n")
        try await b.commitAll("B")
        try await b.git("branch", "dich")

        // The source branch is gone: the failure is at the fetch step, nothing was checked out.
        await #expect(throws: GitError.self) { try await b.repo.fetchForeignBranch("da-xoa", fromRepository: a.url.path) }
        #expect(try await b.repo.status().head.branchName == "main")
        #expect(try await b.git("for-each-ref", "refs/thaigit").isEmpty)

        // Two repos with no shared history: git refuses right after "dich" was checked out → back to "main".
        try await b.repo.fetchForeignBranch("main", fromRepository: a.url.path)
        do {
            try await b.repo.mergeFetchedForeignBranch("main", fromRepository: a.url.path, into: "dich")
            Issue.record("Phải báo lỗi lịch sử không liên quan")
        } catch let failure as ForeignMergeFailure {
            #expect(failure.restoredHead == "main")
            #expect((failure.underlying as? GitError)?.contains("refusing to merge unrelated histories") == true)
        }
        #expect(try await b.repo.status().head.branchName == "main")
        #expect(b.repo.operationState() == nil)
        #expect(try await b.git("for-each-ref", "refs/thaigit").isEmpty)

        // Next time (unrelated histories allowed): merge into "dich", HEAD on "dich".
        try await b.repo.fetchForeignBranch("main", fromRepository: a.url.path)
        try await b.repo.mergeFetchedForeignBranch("main", fromRepository: a.url.path, into: "dich", allowUnrelatedHistories: true)
        #expect(try await b.repo.status().head.branchName == "dich")
        #expect(try b.read("f.txt") == "a\n")

        // Conflict: stays on the target branch with MERGE_HEAD.
        try await b.repo.switchTo(branch: "main")
        try a.write("f.txt", "A sửa\n")
        try await a.commitAll("A sửa")
        try await b.repo.switchTo(branch: "dich")
        try b.write("f.txt", "B sửa\n")
        try await b.commitAll("B sửa")
        try await b.repo.switchTo(branch: "main")
        try await b.repo.fetchForeignBranch("main", fromRepository: a.url.path)
        await #expect(throws: GitError.self) {
            try await b.repo.mergeFetchedForeignBranch("main", fromRepository: a.url.path, into: "dich")
        }
        #expect(try await b.repo.status().head.branchName == "dich")
        #expect(b.repo.operationState() == .merging)
        #expect(try await b.git("for-each-ref", "refs/thaigit").isEmpty)
    }

    /// Pressing "Cancel" while `git merge` runs (a slow hook / a big merge): the merge still runs to completion — no
    /// half-written index without a MERGE_HEAD — and the temporary ref is always deleted.
    @Test func cancellingDuringMergeFinishesMergeAndRemovesTempRef() async throws {
        let a = try await TestRepo.make()
        let b = try await TestRepo.make()
        defer { a.cleanup(); b.cleanup() }
        try a.write("f.txt", "a\n")
        try await a.commitAll("A")
        try b.write("g.txt", "b\n")
        try await b.commitAll("B")
        // `git merge`'s hook signals that it ran (the `started` file) then waits until the test lets it continue (the `release`
        // file): cancelling reliably lands while the merge is running, regardless of machine speed. The 60 second
        // cap only stops it hanging.
        let started = b.repo.gitDir.appendingPathComponent("hook-started")
        let release = b.repo.gitDir.appendingPathComponent("hook-release")
        let hook = b.repo.gitDir.appendingPathComponent("hooks/pre-merge-commit")
        try FileManager.default.createDirectory(at: hook.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("""
        #!/bin/sh
        touch '\(started.path)'
        i=0
        while [ ! -f '\(release.path)' ] && [ $i -lt 600 ]; do sleep 0.1; i=$((i + 1)); done

        """.utf8).write(to: hook)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: hook.path)

        let repo = b.repo
        let source = a.url.path
        let task = Task {
            try await repo.mergeBranch("main", fromRepository: source, allowUnrelatedHistories: true)
        }
        let deadline = Date().addingTimeInterval(30)
        while !FileManager.default.fileExists(atPath: started.path), Date() < deadline {
            try await Task.sleep(for: .milliseconds(20))
        }
        #expect(FileManager.default.fileExists(atPath: started.path), "git merge never reached the hook")
        task.cancel()
        try Data().write(to: release)
        _ = await task.result

        #expect(try await b.git("for-each-ref", "refs/thaigit").isEmpty)
        #expect(b.repo.operationState() == nil)
        #expect(try await b.repo.status().isClean)
        #expect(try b.read("f.txt") == "a\n")
        #expect(try await b.repo.resolveCommit("HEAD^2") == (try await a.repo.resolveCommit("HEAD")))
    }

    /// A merge source with "user:token@": the command log never keeps the userinfo.
    @Test func commandLogHidesUserInfoOfSources() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("nhanh-log-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let fakeGit = directory.appendingPathComponent("git")
        try Data("#!/bin/sh\nexit 0\n".utf8).write(to: fakeGit)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: fakeGit.path)
        let records = LockedBox([GitCommandRecord]())
        let runner = GitRunner(environmentStore: GitEnvironmentStore(GitEnvironment(executable: fakeGit, variables: [:])),
                               workingDirectory: directory) { record in records.withValue { $0.append(record) } }

        try await runner.run(["fetch", "--progress", "--no-tags", "--", "https://ten:mat-khau@git.vd.vn/a.git", "+refs/heads/main:refs/thaigit/x"])
        try await runner.run(["ls-remote", "--", "https://ghp_bimat@github.com/cty/a.git", "HEAD"])
        let logged = records.current.map(\.commandLine).joined(separator: "\n")
        #expect(!logged.contains("mat-khau") && !logged.contains("ghp_bimat") && !logged.contains("ten:"))
        #expect(logged.contains("git.vd.vn/a.git") && logged.contains("github.com/cty/a.git"))
    }
}
