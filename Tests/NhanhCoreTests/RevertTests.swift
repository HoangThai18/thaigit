import Foundation
import Testing
@testable import NhanhCore

@Suite("Revert như GitKraken: commit ngay hoặc để stage (git thật)")
struct RevertTests {
    /// Repo có hai commit "init" và "Đổi dòng 2" (sửa a.txt); trả về SHA của commit thứ hai.
    private func makeRepo() async throws -> (TestRepo, String) {
        let t = try await TestRepo.make()
        try t.write("a.txt", "1\n2\n3\n")
        try await t.commitAll("init")
        try t.write("a.txt", "1\nhai\n3\n")
        try await t.commitAll("Đổi dòng 2")
        return (t, try await t.repo.resolveCommit("HEAD"))
    }

    private func exists(_ t: TestRepo, gitFile name: String) -> Bool {
        FileManager.default.fileExists(atPath: t.repo.gitDir.appendingPathComponent(name).path)
    }

    @Test func revertWithoutCommitStagesChangesAndContinueCommits() async throws {
        let (t, sha) = try await makeRepo()
        defer { t.cleanup() }
        try await t.repo.revert(sha, commit: false)

        // Git để lại trạng thái "đang revert" + message gợi ý: app hiện banner và điền sẵn ô commit.
        #expect(t.repo.operationState() == .reverting)
        let revertHead = try String(contentsOf: t.repo.gitDir.appendingPathComponent("REVERT_HEAD"), encoding: .utf8)
        #expect(revertHead.trimmingCharacters(in: .whitespacesAndNewlines) == sha)
        let mergeMessage = try String(contentsOf: t.repo.gitDir.appendingPathComponent("MERGE_MSG"), encoding: .utf8)
        #expect(mergeMessage == "Revert \"Đổi dòng 2\"\n\nThis reverts commit \(sha).\n")
        #expect(t.repo.pendingCommitMessage() == "Revert \"Đổi dòng 2\"\n\nThis reverts commit \(sha).")

        // Thay đổi đảo ngược đã stage, chưa có commit mới.
        let status = try await t.repo.status()
        #expect(status.staged == [FileChange(path: "a.txt", kind: .modified)])
        #expect(status.unstaged.isEmpty)
        #expect(try await t.indexBlob("a.txt") == Data("1\n2\n3\n".utf8))
        #expect(try t.read("a.txt") == "1\n2\n3\n")
        #expect(try await t.repo.resolveCommit("HEAD") == sha)

        // "Tiếp tục" (revert --continue) tạo commit bằng message gợi ý và kết thúc thao tác.
        try await t.repo.continueOperation(.reverting)
        #expect(t.repo.operationState() == nil)
        #expect(!exists(t, gitFile: "REVERT_HEAD"))
        #expect(!exists(t, gitFile: "MERGE_MSG"))
        let log = try await t.repo.log(limit: 5, order: .topo, includeHEAD: true)
        #expect(log.map(\.subject) == ["Revert \"Đổi dòng 2\"", "Đổi dòng 2", "init"])
        #expect(try await t.repo.commitMessage(log[0].id).contains("This reverts commit \(sha)."))
        #expect(try await t.repo.status().isClean)
    }

    @Test func committingNormallyFinishesRevert() async throws {
        let (t, sha) = try await makeRepo()
        defer { t.cleanup() }
        try await t.repo.revert(sha, commit: false)
        let suggested = try #require(t.repo.pendingCommitMessage())

        // Bấm "Hoàn tất revert" trong ô commit: commit thường với message đã sửa.
        try await t.repo.commit(message: suggested + "\n\nLý do: gây lỗi trên production", amend: false)
        #expect(t.repo.operationState() == nil)
        #expect(!exists(t, gitFile: "REVERT_HEAD"))
        #expect(!exists(t, gitFile: "MERGE_MSG"))
        let log = try await t.repo.log(limit: 5, order: .topo, includeHEAD: true)
        #expect(log.first?.subject == "Revert \"Đổi dòng 2\"")
        #expect(try await t.repo.commitMessage(log[0].id).contains("Lý do: gây lỗi trên production"))
        #expect(try t.read("a.txt") == "1\n2\n3\n")
        #expect(try await t.repo.status().isClean)
    }

    @Test func continueUsesEditedSuggestedMessage() async throws {
        let (t, sha) = try await makeRepo()
        defer { t.cleanup() }
        try await t.repo.revert(sha, commit: false)

        // Người dùng sửa message gợi ý trong ô commit rồi bấm "Tiếp tục" trên banner.
        try t.repo.setPendingCommitMessage("Revert dòng 2 vì lỗi hiển thị\n\nThis reverts commit \(sha).")
        #expect(t.repo.pendingCommitMessage() == "Revert dòng 2 vì lỗi hiển thị\n\nThis reverts commit \(sha).")
        try await t.repo.continueOperation(.reverting)
        #expect(t.repo.operationState() == nil)
        let log = try await t.repo.log(limit: 1, order: .topo, includeHEAD: true)
        #expect(log.first?.subject == "Revert dòng 2 vì lỗi hiển thị")
        #expect(try t.read("a.txt") == "1\n2\n3\n")
    }

    @Test func abortRestoresStateBeforeRevert() async throws {
        let (t, sha) = try await makeRepo()
        defer { t.cleanup() }
        try t.write("ghi-chu.txt", "chưa track\n")
        try await t.repo.revert(sha, commit: false)

        // "Hoàn tác" trên thông báo = revert --abort.
        try await t.repo.abort(.reverting)
        #expect(t.repo.operationState() == nil)
        #expect(!exists(t, gitFile: "REVERT_HEAD"))
        #expect(!exists(t, gitFile: "MERGE_MSG"))
        #expect(try t.read("a.txt") == "1\nhai\n3\n")
        let status = try await t.repo.status()
        #expect(status.staged.isEmpty)
        #expect(status.unstaged == [FileChange(path: "ghi-chu.txt", kind: .untracked)])
        #expect(try t.read("ghi-chu.txt") == "chưa track\n")
        #expect(try await t.repo.resolveCommit("HEAD") == sha)
    }

    @Test func revertsMergeCommitAgainstFirstParent() async throws {
        let t = try await TestRepo.make()
        defer { t.cleanup() }
        try t.write("a.txt", "gốc\n")
        try await t.commitAll("init")
        try await t.repo.createBranch("feature", at: nil, checkout: true)
        try t.write("b.txt", "từ feature\n")
        try await t.commitAll("feature work")
        try await t.repo.switchTo(branch: "main")
        try t.write("c.txt", "từ main\n")
        try await t.commitAll("main work")
        try await t.repo.merge("feature", style: .noFastForward)
        let merge = try await t.repo.resolveCommit("HEAD")
        let firstParent = try await t.repo.resolveCommit("HEAD^1")

        // Commit merge mà không chỉ cha: git từ chối, không để lại trạng thái dở.
        await #expect(throws: GitError.self) { try await t.repo.revert(merge, commit: false) }
        #expect(t.repo.operationState() == nil)

        try await t.repo.revert(merge, mainline: 1, commit: false)
        #expect(t.repo.operationState() == .reverting)
        // So với cha thứ nhất (main): bỏ phần feature mang vào, giữ phần của main.
        #expect(try await t.repo.status().staged == [FileChange(path: "b.txt", kind: .deleted)])
        #expect(try t.read("c.txt") == "từ main\n")
        let message = try #require(t.repo.pendingCommitMessage())
        #expect(message.hasPrefix("Revert \"Merge branch 'feature'"))
        #expect(message.contains("This reverts commit \(merge), reversing\nchanges made to \(firstParent)."))
        try await t.repo.abort(.reverting)
        #expect(FileManager.default.fileExists(atPath: t.url.appendingPathComponent("b.txt").path))

        // Mặc định (commit: true) vẫn tạo commit revert ngay như trước.
        try await t.repo.revert(merge, mainline: 1)
        #expect(t.repo.operationState() == nil)
        let log = try await t.repo.log(limit: 1, order: .topo, includeHEAD: true)
        #expect(log.first?.subject.hasPrefix("Revert \"Merge branch 'feature'") == true)
        #expect(!FileManager.default.fileExists(atPath: t.url.appendingPathComponent("b.txt").path))
        #expect(try t.read("c.txt") == "từ main\n")
        #expect(try await t.repo.status().isClean)
    }

    /// "Revert, chưa commit" với commit đã được đảo ngược từ trước: git không stage gì mà vẫn để REVERT_HEAD — nút
    /// "Stage tất cả & commit" sẽ commit luôn thay đổi đang làm dở với message revert. Phải dừng và không để lại trạng thái.
    @Test func revertingAlreadyRevertedCommitLeavesNoRevertState() async throws {
        let (t, sha) = try await makeRepo()
        defer { t.cleanup() }
        try await t.repo.revert(sha)
        let head = try await t.repo.resolveCommit("HEAD")
        try t.write("dang-lam.txt", "chưa xong\n")

        await #expect(throws: RepositoryError.self) { try await t.repo.revert(sha, commit: false) }
        #expect(t.repo.operationState() == nil)
        #expect(!exists(t, gitFile: "REVERT_HEAD"))
        let status = try await t.repo.status()
        #expect(status.staged.isEmpty)
        #expect(status.unstaged == [FileChange(path: "dang-lam.txt", kind: .untracked)])
        #expect(try t.read("dang-lam.txt") == "chưa xong\n")
        #expect(try await t.repo.resolveCommit("HEAD") == head)
    }

    /// Hoàn tất revert có message đã sửa: `revert --continue` luôn dùng `--cleanup=strip` nên dòng bắt đầu bằng "#"
    /// (#123, #hotfix) bị mất; commit thường (`--cleanup=whitespace`, như nút "Tiếp tục" của app khi ô commit có message)
    /// giữ nguyên và kết thúc revert.
    @Test func finishingRevertByCommitKeepsHashLines() async throws {
        let (t, sha) = try await makeRepo()
        defer { t.cleanup() }
        let message = "Revert dòng 2\n\n#123 gây lỗi hiển thị\n\nThis reverts commit \(sha)."

        try await t.repo.revert(sha, commit: false)
        try t.repo.setPendingCommitMessage(message)
        try await t.repo.continueOperation(.reverting)
        #expect(!(try await t.repo.commitMessage("HEAD")).contains("#123"))

        try await t.repo.reset(to: sha, mode: .hard)
        try await t.repo.revert(sha, commit: false)
        try await t.repo.commit(message: message, amend: false)
        #expect(t.repo.operationState() == nil)
        #expect(try await t.repo.commitMessage("HEAD").contains("#123 gây lỗi hiển thị"))
        #expect(try t.read("a.txt") == "1\n2\n3\n")
    }
}
