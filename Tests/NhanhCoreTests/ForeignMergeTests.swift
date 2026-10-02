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

    /// Dự án A bán cho công ty B (B là bản copy, không chung lịch sử): lần đầu cần --allow-unrelated-histories,
    /// các lần sau đã có commit chung nên merge bình thường. Không lần nào để lại remote hay ref tạm.
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

        // Lần sau: chỉ cần merge thường.
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
        // B chưa có commit nào: merge chỉ đưa nhánh về đúng commit của A.
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
}
