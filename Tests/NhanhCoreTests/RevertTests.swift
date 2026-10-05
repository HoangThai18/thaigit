import Foundation
import Testing
@testable import NhanhCore

@Suite("Revert: commit ngay hoặc để stage (git thật)")
struct RevertTests {
    /// A repo with the two commits "init" and "Đổi dòng 2" (editing a.txt); returns the second commit's SHA.
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

        // Git leaves the "reverting" state + a suggested message behind: the app shows the banner and prefills the commit box.
        #expect(t.repo.operationState() == .reverting)
        let revertHead = try String(contentsOf: t.repo.gitDir.appendingPathComponent("REVERT_HEAD"), encoding: .utf8)
        #expect(revertHead.trimmingCharacters(in: .whitespacesAndNewlines) == sha)
        let mergeMessage = try String(contentsOf: t.repo.gitDir.appendingPathComponent("MERGE_MSG"), encoding: .utf8)
        #expect(mergeMessage == "Revert \"Đổi dòng 2\"\n\nThis reverts commit \(sha).\n")
        #expect(t.repo.pendingCommitMessage() == "Revert \"Đổi dòng 2\"\n\nThis reverts commit \(sha).")

        // The reverse changes are staged, with no new commit yet.
        let status = try await t.repo.status()
        #expect(status.staged == [FileChange(path: "a.txt", kind: .modified)])
        #expect(status.unstaged.isEmpty)
        #expect(try await t.indexBlob("a.txt") == Data("1\n2\n3\n".utf8))
        #expect(try t.read("a.txt") == "1\n2\n3\n")
        #expect(try await t.repo.resolveCommit("HEAD") == sha)

        // "Continue" (revert --continue) commits with the suggested message and ends the operation.
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

        // Pressing "Finish revert" in the commit box: an ordinary commit with the edited message.
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

        // The user edits the suggested message in the commit box, then presses "Continue" on the banner.
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

        // "Undo" on the notification = revert --abort.
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

        // A merge commit without a mainline: git refuses and leaves no unfinished state.
        await #expect(throws: GitError.self) { try await t.repo.revert(merge, commit: false) }
        #expect(t.repo.operationState() == nil)

        try await t.repo.revert(merge, mainline: 1, commit: false)
        #expect(t.repo.operationState() == .reverting)
        // Against the first parent (main): drop what feature brought in, keep main's part.
        #expect(try await t.repo.status().staged == [FileChange(path: "b.txt", kind: .deleted)])
        #expect(try t.read("c.txt") == "từ main\n")
        let message = try #require(t.repo.pendingCommitMessage())
        #expect(message.hasPrefix("Revert \"Merge branch 'feature'"))
        #expect(message.contains("This reverts commit \(merge), reversing\nchanges made to \(firstParent)."))
        try await t.repo.abort(.reverting)
        #expect(FileManager.default.fileExists(atPath: t.url.appendingPathComponent("b.txt").path))

        // The default (commit: true) still creates the revert commit immediately, as before.
        try await t.repo.revert(merge, mainline: 1)
        #expect(t.repo.operationState() == nil)
        let log = try await t.repo.log(limit: 1, order: .topo, includeHEAD: true)
        #expect(log.first?.subject.hasPrefix("Revert \"Merge branch 'feature'") == true)
        #expect(!FileManager.default.fileExists(atPath: t.url.appendingPathComponent("b.txt").path))
        #expect(try t.read("c.txt") == "từ main\n")
        #expect(try await t.repo.status().isClean)
    }

    /// "Revert, don't commit" for a commit that was already reverted beforehand: git stages nothing yet still leaves
    /// REVERT_HEAD — the "Stage all & commit" button would commit the in-progress change with the revert message. It
    /// has to stop and leave no state behind.
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

    /// Finishing a revert with an edited message: `revert --continue` always uses `--cleanup=strip`, so a line starting
    /// with "#" (#123, #hotfix) would be lost; an ordinary commit (`--cleanup=whitespace`, like the app's "Continue"
    /// button when the commit box holds a message) keeps it and ends the revert.
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
