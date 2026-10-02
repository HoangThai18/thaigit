import Foundation
import Testing
@testable import NhanhCore

@Suite("Interactive rebase")
struct InteractiveRebaseTests {
    /// Repo có commit gốc + 4 commit "c1"…"c4" (mỗi commit một file riêng nên đổi thứ tự không xung đột).
    private func makeRepo() async throws -> (TestRepo, base: String, commits: [Commit]) {
        let t = try await TestRepo.make()
        try t.write("goc.txt", "gốc\n")
        try await t.commitAll("gốc")
        let base = try await t.repo.resolveCommit("HEAD")
        for n in 1...4 {
            try t.write("f\(n).txt", "\(n)\n")
            try await t.commitAll("c\(n)")
        }
        let commits = try await t.repo.rebaseCommits(after: base)
        return (t, base, commits)
    }

    private func subjects(_ t: TestRepo) async throws -> [String] {
        try await t.git("log", "--format=%s").split(separator: "\n").map(String.init)
    }

    @Test func listsCommitsOldestFirst() async throws {
        let (t, base, commits) = try await makeRepo()
        defer { t.cleanup() }
        #expect(commits.map(\.subject) == ["c1", "c2", "c3", "c4"])
        let head = try await t.repo.resolveCommit("HEAD")
        await #expect(throws: RebaseError.self) { try await t.repo.rebaseCommits(after: head + "^{tree}") }
        #expect(await t.repo.isAncestor(base, of: "HEAD"))
    }

    @Test func reordersSquashesRewordsAndDrops() async throws {
        let (t, base, commits) = try await makeRepo()
        defer { t.cleanup() }
        // Kế hoạch (cũ → mới): c2 lên trước c1, c3 gộp vào c1 (nối lời), c4 bỏ; c2 sửa lời có dòng bắt đầu bằng #.
        let steps = [
            RebaseStep(commit: commits[1], action: .reword, message: "c2 mới\n\n#123 vẫn giữ dòng này"),
            RebaseStep(commit: commits[0]),
            RebaseStep(commit: commits[2], action: .squash),
            RebaseStep(commit: commits[3], action: .drop),
        ]
        #expect(RebasePlan.problem(steps, original: commits) == nil)
        let result = try await t.repo.interactiveRebase(onto: base, steps: steps)
        #expect(result == .done)
        #expect(try await subjects(t) == ["c1", "c2 mới", "gốc"])
        #expect(try await t.repo.commitMessage("HEAD~1").contains("#123 vẫn giữ dòng này"))
        // Squash nối lời của c1 và c3.
        let squashed = try await t.repo.commitMessage("HEAD")
        #expect(squashed.contains("c1") && squashed.contains("c3"))
        #expect(!FileManager.default.fileExists(atPath: t.url.appendingPathComponent("f4.txt").path))
        #expect(t.repo.operationState() == nil)
        #expect(!FileManager.default.fileExists(atPath: t.repo.gitDir.appendingPathComponent("thaigit-rebase").path))
    }

    @Test func fixupKeepsOnlyFirstMessageAndAutostashes() async throws {
        let (t, base, commits) = try await makeRepo()
        defer { t.cleanup() }
        try t.write("goc.txt", "gốc\nđang sửa dở\n")
        let steps = [
            RebaseStep(commit: commits[0]),
            RebaseStep(commit: commits[1], action: .fixup),
            RebaseStep(commit: commits[2]),
            RebaseStep(commit: commits[3]),
        ]
        #expect(try await t.repo.interactiveRebase(onto: base, steps: steps) == .done)
        #expect(try await subjects(t) == ["c4", "c3", "c1", "gốc"])
        #expect(try await t.repo.commitMessage("HEAD~2").trimmingCharacters(in: .whitespacesAndNewlines) == "c1")
        #expect(try t.read("goc.txt") == "gốc\nđang sửa dở\n")
    }

    @Test func conflictStopsLikeNormalRebase() async throws {
        let t = try await TestRepo.make()
        defer { t.cleanup() }
        try t.write("a.txt", "a\n")
        try await t.commitAll("gốc")
        let base = try await t.repo.resolveCommit("HEAD")
        try t.write("f.txt", "1\n")
        try await t.commitAll("thêm f")
        try t.write("f.txt", "2\n")
        try await t.commitAll("sửa f")
        let commits = try await t.repo.rebaseCommits(after: base)
        // Đưa "sửa f" lên trước "thêm f" → xung đột.
        await #expect(throws: GitError.self) {
            try await t.repo.interactiveRebase(onto: base, steps: [RebaseStep(commit: commits[1]), RebaseStep(commit: commits[0])])
        }
        guard case .rebasing = t.repo.operationState() else {
            Issue.record("phải đang ở trạng thái rebase")
            return
        }
        try await t.repo.abort(.rebasing(step: nil, total: nil, headName: nil))
        #expect(try await subjects(t) == ["sửa f", "thêm f", "gốc"])
    }

    @Test func validatesPlans() async throws {
        let (t, _, commits) = try await makeRepo()
        defer { t.cleanup() }
        let unchanged = commits.map { RebaseStep(commit: $0) }
        #expect(RebasePlan.problem(unchanged, original: commits) == "Chưa có thay đổi nào.")
        var squashFirst = unchanged
        squashFirst[0].action = .squash
        #expect(RebasePlan.problem(squashFirst, original: commits)?.contains("không gộp được") == true)
        var dropThenFixup = unchanged
        dropThenFixup[0].action = .drop
        dropThenFixup[1].action = .fixup
        #expect(RebasePlan.problem(dropThenFixup, original: commits)?.contains("không gộp được") == true)
        var emptyReword = unchanged
        emptyReword[2].action = .reword
        emptyReword[2].message = "  \n"
        #expect(RebasePlan.problem(emptyReword, original: commits) == "Lời commit mới không được để trống.")
        #expect(RebasePlan.shellQuote("/a b/it's") == "'/a b/it'\\''s'")
    }
}
