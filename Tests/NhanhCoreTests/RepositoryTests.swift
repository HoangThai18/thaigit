import Foundation
import Testing
@testable import NhanhCore

@Suite("Repository (git thật trong thư mục tạm)")
struct RepositoryTests {
    @Test func unbornRepositoryHasEmptyHistory() async throws {
        let t = try await TestRepo.make()
        defer { t.cleanup() }
        let status = try await t.repo.status()
        #expect(status.head == .branch(name: "main", oid: nil))
        let log = try await t.repo.log(limit: 100, order: .date, includeHEAD: false)
        #expect(log.isEmpty)
        let history = try await t.repo.history(limit: 100, order: .date, head: status.head, showWorkingTree: true)
        #expect(history.commits.count == 1 && history.commits[0].isWorkingTree)
        #expect(try await t.repo.stashes().isEmpty)
        #expect(try await t.repo.refs().isEmpty)
    }

    @Test func stageCommitAndReadHistory() async throws {
        let t = try await TestRepo.make()
        defer { t.cleanup() }
        try t.write("a.txt", "xin chào\n")
        try t.write("thư mục/b c.txt", "b\n")

        var status = try await t.repo.status()
        #expect(status.unstaged.map(\.path).sorted() == ["a.txt", "thư mục/b c.txt"])
        #expect(status.unstaged.allSatisfy { $0.kind == .untracked })

        try await t.repo.stage(paths: ["a.txt"])
        status = try await t.repo.status()
        #expect(status.staged == [FileChange(path: "a.txt", kind: .added)])

        try await t.repo.unstage(paths: ["a.txt"], headExists: false)
        status = try await t.repo.status()
        #expect(status.staged.isEmpty)

        try await t.repo.stageAll()
        try await t.repo.commit(message: "Commit đầu tiên\n\nMô tả chi tiết", amend: false)
        status = try await t.repo.status()
        #expect(status.isClean)
        let head = try #require(status.head.oid)

        let refs = try await t.repo.refs()
        #expect(refs.count == 1 && refs[0].name == "main" && refs[0].isHead && refs[0].target == head)

        let log = try await t.repo.log(limit: 10, order: .topo, includeHEAD: true)
        #expect(log.count == 1)
        #expect(log[0].subject == "Commit đầu tiên")
        #expect(log[0].authorName == "Nhánh Test")
        let message = try await t.repo.commitMessage(head)
        #expect(message.contains("Mô tả chi tiết"))
        let files = try await t.repo.changedFiles(commit: head, parent: nil)
        #expect(files.map(\.path).sorted() == ["a.txt", "thư mục/b c.txt"])
        let diff = try #require(try await t.repo.diff(commit: head, parent: nil, file: FileChange(path: "a.txt", kind: .added)))
        #expect(diff.isNewFile)
        #expect(diff.hunks.first?.lines.first?.text == "xin chào")

        // Amend đổi message.
        try await t.repo.commit(message: "Commit đã sửa", amend: true)
        let amended = try await t.repo.log(limit: 10, order: .date, includeHEAD: true)
        #expect(amended.count == 1 && amended[0].subject == "Commit đã sửa")
    }

    @Test func untrackedAndStagedDiffs() async throws {
        let t = try await TestRepo.make()
        defer { t.cleanup() }
        try t.write("a.txt", "1\n2\n3\n")
        try await t.commitAll("init")
        try t.write("new.txt", "hello\nworld\n")
        let untracked = try #require(try await t.repo.workingDiff(FileChange(path: "new.txt", kind: .untracked), kind: .untracked))
        #expect(untracked.isNewFile)
        #expect(untracked.additions == 2)

        try t.write("a.txt", "1\nhai\n3\n")
        try await t.repo.stage(paths: ["a.txt"])
        let staged = try #require(try await t.repo.workingDiff(FileChange(path: "a.txt", kind: .modified), kind: .staged))
        #expect(staged.additions == 1 && staged.deletions == 1)
        let unstaged = try await t.repo.workingDiff(FileChange(path: "a.txt", kind: .modified), kind: .unstaged)
        #expect(unstaged == nil)
    }

    @Test func partialStagingOfHunksAndLines() async throws {
        let t = try await TestRepo.make()
        defer { t.cleanup() }
        var lines = numberedLines(30)
        try t.write("f.txt", lines.joined(separator: "\n") + "\n")
        try await t.commitAll("init")

        // Hai vùng thay đổi cách xa nhau → hai hunk.
        lines[1] = "LINE TWO"
        lines[19] = "LINE TWENTY"
        lines.insert("inserted after 20", at: 20)
        try t.write("f.txt", lines.joined(separator: "\n") + "\n")
        let change = FileChange(path: "f.txt", kind: .modified)

        var diff = try #require(try await t.repo.workingDiff(change, kind: .unstaged))
        #expect(diff.hunks.count == 2)

        // Stage nguyên hunk thứ hai.
        let patch = try #require(PatchBuilder.makePatch(file: diff, selection: PatchBuilder.selectionForWholeHunk(diff.hunks[1]), reverse: false))
        try await t.repo.applyPatch(patch, cached: true, reverse: false)
        var staged = try #require(try await t.repo.workingDiff(change, kind: .staged))
        #expect(staged.hunks.count == 1)
        #expect(staged.hunks[0].lines.contains { $0.kind == .addition && $0.text == "LINE TWENTY" })
        #expect(!staged.hunks[0].lines.contains { $0.text == "LINE TWO" })
        diff = try #require(try await t.repo.workingDiff(change, kind: .unstaged))
        #expect(diff.hunks.count == 1)
        #expect(diff.hunks[0].lines.contains { $0.text == "LINE TWO" })

        // Unstage riêng dòng "inserted after 20" (áp ngược vào index).
        let insertedIndex = try #require(staged.hunks[0].lines.firstIndex { $0.text == "inserted after 20" })
        let unstagePatch = try #require(PatchBuilder.makePatch(file: staged, selection: [staged.hunks[0].id: [insertedIndex]], reverse: true))
        try await t.repo.applyPatch(unstagePatch, cached: true, reverse: true)
        staged = try #require(try await t.repo.workingDiff(change, kind: .staged))
        #expect(staged.hunks[0].lines.contains { $0.kind == .addition && $0.text == "LINE TWENTY" })
        #expect(!staged.hunks[0].lines.contains { $0.kind == .addition && $0.text == "inserted after 20" })

        // Stage riêng dòng thêm "LINE TWO" nhưng không stage dòng xoá "line 2".
        diff = try #require(try await t.repo.workingDiff(change, kind: .unstaged))
        let hunk = try #require(diff.hunks.first { $0.lines.contains { $0.text == "LINE TWO" } })
        let addIndex = try #require(hunk.lines.firstIndex { $0.kind == .addition && $0.text == "LINE TWO" })
        let linePatch = try #require(PatchBuilder.makePatch(file: diff, selection: [hunk.id: [addIndex]], reverse: false))
        try await t.repo.applyPatch(linePatch, cached: true, reverse: false)
        let index = try await t.git("show", ":f.txt")
        #expect(index.contains("line 2\nLINE TWO\nline 3"))

        // Huỷ (discard) dòng "inserted after 20" khỏi working tree.
        diff = try #require(try await t.repo.workingDiff(change, kind: .unstaged))
        let discardHunk = try #require(diff.hunks.first { $0.lines.contains { $0.text == "inserted after 20" } })
        let discardIndex = try #require(discardHunk.lines.firstIndex { $0.kind == .addition && $0.text == "inserted after 20" })
        let discardPatch = try #require(PatchBuilder.makePatch(file: diff, selection: [discardHunk.id: [discardIndex]], reverse: true))
        try await t.repo.applyPatch(discardPatch, cached: false, reverse: true)
        let working = try t.read("f.txt")
        #expect(!working.contains("inserted after 20"))
        #expect(working.contains("LINE TWENTY"))
        #expect(working.contains("LINE TWO"))
    }

    @Test func partialStagingNearEndOfFileWithoutNewline() async throws {
        let t = try await TestRepo.make()
        defer { t.cleanup() }
        try t.write("g.txt", "a\nb\nc")
        try await t.commitAll("init")
        try t.write("g.txt", "a\nB\nc\nd")
        let change = FileChange(path: "g.txt", kind: .modified)
        let diff = try #require(try await t.repo.workingDiff(change, kind: .unstaged))
        let hunk = diff.hunks[0]
        // Chỉ stage việc đổi b → B.
        let selected = Set(hunk.lines.indices.filter { hunk.lines[$0].text == "b" || hunk.lines[$0].text == "B" })
        let patch = try #require(PatchBuilder.makePatch(file: diff, selection: [hunk.id: selected], reverse: false))
        try await t.repo.applyPatch(patch, cached: true, reverse: false)
        let index = try await t.git("show", ":g.txt")
        #expect(index == "a\nB\nc")
    }

    @Test func partialStagingAddsLineAfterMissingNewline() async throws {
        let t = try await TestRepo.make()
        defer { t.cleanup() }
        try t.write("g.txt", "a\nb\nc")
        try await t.commitAll("init")
        try t.write("g.txt", "a\nB\nc\nd")
        let change = FileChange(path: "g.txt", kind: .modified)
        let diff = try #require(try await t.repo.workingDiff(change, kind: .unstaged))
        let hunk = diff.hunks[0]
        let selected = Set(hunk.lines.indices.filter { ["b", "B", "d"].contains(hunk.lines[$0].text) && hunk.lines[$0].isChange })
        let patch = try #require(PatchBuilder.makePatch(file: diff, selection: [hunk.id: selected], reverse: false))
        try await t.repo.applyPatch(patch, cached: true, reverse: false)
        #expect(try await t.git("show", ":g.txt") == "a\nB\nc\nd")
    }

    @Test func lineSelectionKeepsLineOrder() async throws {
        let t = try await TestRepo.make()
        defer { t.cleanup() }
        try t.write("p.txt", "top\na\nb\nmid\nfoo\nbaz\nend\n")
        try await t.commitAll("init")
        try t.write("p.txt", "top\nA\nB\nmid\nbar\nend\n")
        let change = FileChange(path: "p.txt", kind: .modified)

        func select(_ diff: FileDiff, _ texts: [String]) -> [Int: Set<Int>] {
            var result: [Int: Set<Int>] = [:]
            for hunk in diff.hunks {
                let indices = hunk.lines.indices.filter { hunk.lines[$0].isChange && texts.contains(hunk.lines[$0].text) }
                if !indices.isEmpty { result[hunk.id] = Set(indices) }
            }
            return result
        }

        // Stage cặp thứ hai (b → B) và việc sửa foo → bar, giữ nguyên a và baz.
        var diff = try #require(try await t.repo.workingDiff(change, kind: .unstaged))
        let stagePatch = try #require(PatchBuilder.makePatch(file: diff, selection: select(diff, ["b", "B", "foo", "bar"]), reverse: false))
        try await t.repo.applyPatch(stagePatch, cached: true, reverse: false)
        #expect(try await t.git("show", ":p.txt") == "top\na\nB\nmid\nbar\nbaz\nend\n")

        // Huỷ trong working tree cặp a → A (khôi phục "a"), giữ các thay đổi còn lại.
        diff = try #require(try await t.repo.workingDiff(change, kind: .unstaged))
        let discardPatch = try #require(PatchBuilder.makePatch(file: diff, selection: select(diff, ["a", "A"]), reverse: true))
        try await t.repo.applyPatch(discardPatch, cached: false, reverse: true)
        #expect(try t.read("p.txt") == "top\na\nB\nmid\nbar\nend\n")

        // Unstage riêng việc sửa b → B khỏi index.
        let staged = try #require(try await t.repo.workingDiff(change, kind: .staged))
        let unstagePatch = try #require(PatchBuilder.makePatch(file: staged, selection: select(staged, ["b", "B"]), reverse: true))
        try await t.repo.applyPatch(unstagePatch, cached: true, reverse: true)
        #expect(try await t.git("show", ":p.txt") == "top\na\nb\nmid\nbar\nbaz\nend\n")
    }

    @Test func discardSnapshotAndUndo() async throws {
        let t = try await TestRepo.make()
        defer { t.cleanup() }
        try t.write("a.txt", "gốc\n")
        try await t.commitAll("init")
        try t.write("a.txt", "đã sửa\n")
        try t.write("junk.txt", "rác\n")

        let snapshot = try #require(try await t.repo.snapshotChanges())
        try await t.repo.discard(paths: ["a.txt"])
        #expect(try t.read("a.txt") == "gốc\n")
        try await t.repo.restoreWorkingFiles(from: snapshot, paths: ["a.txt"])
        #expect(try t.read("a.txt") == "đã sửa\n")

        // Stash ghi lại commit lơ lửng → danh sách stash vẫn trống.
        #expect(try await t.repo.stashes().isEmpty)
        _ = try t.repo.trashUntracked(paths: ["junk.txt"])
        #expect(!FileManager.default.fileExists(atPath: t.url.appendingPathComponent("junk.txt").path))
    }

    @Test func mergeConflictLifecycle() async throws {
        let t = try await TestRepo.make()
        defer { t.cleanup() }
        try t.write("a.txt", "dòng 1\ndòng 2\ndòng 3\n")
        try await t.commitAll("init")

        try await t.repo.createBranch("feature/x", at: nil, checkout: true)
        try t.write("a.txt", "dòng 1\nfeature\ndòng 3\n")
        try await t.commitAll("feature change")

        try await t.repo.switchTo(branch: "main")
        try t.write("a.txt", "dòng 1\nmain\ndòng 3\n")
        try await t.commitAll("main change")

        await #expect(throws: GitError.self) { try await t.repo.merge("feature/x") }
        #expect(t.repo.operationState() == .merging)
        let status = try await t.repo.status()
        #expect(status.conflicts == [ConflictEntry(path: "a.txt", kind: .bothModified)])
        #expect(t.repo.pendingCommitMessage()?.hasPrefix("Merge branch 'feature/x'") == true)

        let conflict = ConflictFile.parse(try t.repo.readWorkingFile("a.txt"))
        #expect(conflict.conflictCount == 1)
        #expect(conflict.blocks[0].ours == ["main"])
        #expect(conflict.blocks[0].theirs == ["feature"])
        let resolved = try #require(conflict.resolved(with: [0: .oursThenTheirs]))
        try t.repo.writeWorkingFile("a.txt", contents: resolved)
        try await t.repo.markResolved(paths: ["a.txt"])
        try await t.repo.continueOperation(.merging)

        #expect(t.repo.operationState() == nil)
        let log = try await t.repo.log(limit: 10, order: .topo, includeHEAD: true)
        #expect(log[0].isMerge)
        #expect(try t.read("a.txt") == "dòng 1\nmain\nfeature\ndòng 3\n")
        let history = try await t.repo.history(limit: 10, order: .topo, head: try await t.repo.status().head, showWorkingTree: false)
        #expect(history.rows.map(\.width).max() == 2)
    }

    @Test func conflictSidesAndAbort() async throws {
        let t = try await TestRepo.make()
        defer { t.cleanup() }
        try t.write("a.txt", "x\n")
        try await t.commitAll("init")
        try await t.repo.createBranch("other", at: nil, checkout: true)
        try t.write("a.txt", "theirs\n")
        try await t.commitAll("other")
        try await t.repo.switchTo(branch: "main")
        try t.write("a.txt", "ours\n")
        try await t.commitAll("main")

        // Rebase có xung đột rồi huỷ.
        await #expect(throws: GitError.self) { try await t.repo.rebase(onto: "other") }
        guard case .rebasing = t.repo.operationState() else {
            Issue.record("Phải đang rebase")
            return
        }
        try await t.repo.abort(.rebasing(step: nil, total: nil, headName: nil))
        #expect(t.repo.operationState() == nil)
        #expect(try t.read("a.txt") == "ours\n")

        // Merge rồi chọn toàn bộ bên kia.
        await #expect(throws: GitError.self) { try await t.repo.merge("other") }
        try await t.repo.resolveConflict(path: "a.txt", kind: .bothModified, useOurs: false)
        #expect(try t.read("a.txt") == "theirs\n")
        #expect(try await t.repo.status().conflicts.isEmpty)
        try await t.repo.abort(.merging)
        #expect(try t.read("a.txt") == "ours\n")
    }

    @Test func stashRoundTripIncludesUntracked() async throws {
        let t = try await TestRepo.make()
        defer { t.cleanup() }
        try t.write("a.txt", "1\n")
        try await t.commitAll("init")
        try t.write("a.txt", "2\n")
        try t.write("new.txt", "mới\n")
        try await t.repo.stashPush(message: "cất tạm", includeUntracked: true)
        #expect(try await t.repo.status().isClean)

        let stashes = try await t.repo.stashes()
        #expect(stashes.count == 1)
        #expect(stashes[0].displayMessage == "cất tạm")
        #expect(stashes[0].parents.count == 3)
        let files = try await t.repo.stashFiles(stashes[0])
        #expect(files.contains(FileChange(path: "a.txt", kind: .modified)))
        #expect(files.contains(FileChange(path: "new.txt", kind: .untracked)))
        let untrackedDiff = try #require(try await t.repo.stashDiff(stashes[0], file: FileChange(path: "new.txt", kind: .untracked)))
        #expect(untrackedDiff.additions == 1)

        // Xoá rồi khôi phục stash.
        try await t.repo.stashDrop(stashes[0].selector)
        #expect(try await t.repo.stashes().isEmpty)
        try await t.repo.stashStore(sha: stashes[0].sha, message: stashes[0].message)
        let restored = try await t.repo.stashes()
        #expect(restored.count == 1)

        try await t.repo.stashPop(restored[0].selector)
        #expect(try t.read("a.txt") == "2\n")
        #expect(try t.read("new.txt") == "mới\n")
    }

    @Test func branchesTagsAndRefs() async throws {
        let t = try await TestRepo.make()
        defer { t.cleanup() }
        try t.write("a.txt", "1\n")
        try await t.commitAll("init")
        let head = try await t.repo.resolveCommit("HEAD")
        try await t.repo.createBranch("dev", at: head, checkout: false)
        try await t.repo.createTag("v1.0", at: head, message: "Phiên bản 1")
        try await t.repo.createTag("nhe", at: head, message: nil)
        var refs = try await t.repo.refs()
        #expect(Set(refs.map(\.name)) == ["main", "dev", "v1.0", "nhe"])
        let annotated = try #require(refs.first { $0.name == "v1.0" })
        #expect(annotated.isAnnotatedTag && annotated.target == head)

        try await t.repo.renameBranch("dev", to: "phat-trien")
        try await t.repo.deleteTag("v1.0")
        try await t.repo.updateRef(annotated.fullName, to: annotated.objectName)
        refs = try await t.repo.refs()
        #expect(refs.contains { $0.name == "phat-trien" })
        #expect(refs.first { $0.name == "v1.0" }?.isAnnotatedTag == true)

        try await t.repo.deleteBranch("phat-trien", force: false)
        #expect(!(try await t.repo.refs()).contains { $0.name == "phat-trien" })
        #expect(await t.repo.isValidRefName("feature/ok", branch: true))
        #expect(!(await t.repo.isValidRefName("bad..name", branch: true)))
    }

    @Test func fetchPushPullWithLocalRemote() async throws {
        let origin = try await TestRepo.make()
        defer { origin.cleanup() }
        try origin.write("a.txt", "1\n")
        try await origin.commitAll("init")
        try await origin.git("config", "receive.denyCurrentBranch", "updateInstead")

        let parent = FileManager.default.temporaryDirectory.appendingPathComponent("nhanh-clone-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: parent) }
        let destination = parent.appendingPathComponent("ban-sao")
        let progressLines = LockedBox([String]())
        try await GitRepository.clone(url: origin.url.path, to: destination, environment: origin.store) { line in
            progressLines.withValue { $0.append(line) }
        }
        let clone = try await GitRepository.open(at: destination, environment: origin.store)
        try await clone.runner.run(["config", "user.name", "Clone"])
        try await clone.runner.run(["config", "user.email", "clone@example.com"])
        let remotes = try await clone.remotes()
        #expect(remotes.map(\.name) == ["origin"])

        // Commit ở clone rồi push.
        try Data("2\n".utf8).write(to: destination.appendingPathComponent("a.txt"))
        try await clone.stageAll()
        try await clone.commit(message: "từ clone", amend: false)
        var status = try await clone.status()
        #expect(status.ahead == 1 && status.upstream == "origin/main")
        try await clone.push(remote: "origin", localBranch: "main", remoteBranch: "main", setUpstream: false, force: false)
        #expect(try origin.read("a.txt") == "2\n")

        // Commit ở origin rồi fetch + pull.
        try origin.write("b.txt", "b\n")
        try await origin.commitAll("từ origin")
        try await clone.fetch(remote: nil, prune: true)
        status = try await clone.status()
        #expect(status.behind == 1)
        try await clone.pull(mode: .merge)
        status = try await clone.status()
        #expect(status.behind == 0 && status.ahead == 0)
        #expect(FileManager.default.fileExists(atPath: destination.appendingPathComponent("b.txt").path))

        // Nhánh mới đẩy lên kèm upstream.
        try await clone.createBranch("tinh-nang", at: nil, checkout: true)
        try await clone.push(remote: "origin", localBranch: "tinh-nang", remoteBranch: "tinh-nang", setUpstream: true, force: false)
        let refs = try await clone.refs()
        #expect(refs.first { $0.name == "tinh-nang" }?.upstream == "origin/tinh-nang")
        #expect(refs.contains { $0.kind == .remoteBranch && $0.name == "origin/tinh-nang" })
        try await clone.deleteRemoteBranch(remote: "origin", branch: "tinh-nang")
        #expect(!(try await clone.refs()).contains { $0.name == "origin/tinh-nang" })
    }

    @Test func openRejectsNonRepository() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("nhanh-not-repo-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        await #expect(throws: RepositoryError.self) {
            _ = try await GitRepository.open(at: dir, environment: TestRepo.isolatedEnvironment())
        }
    }

    @Test func repoConfiguredFsmonitorCommandNeverRuns() async throws {
        let test = try await TestRepo.make()
        defer { test.cleanup() }
        // Repo lạ đặt core.fsmonitor thành script: mở/làm mới repo (git status) không được chạy nó.
        let marker = test.url.appendingPathComponent("fsmonitor-ran")
        let script = test.url.appendingPathComponent("hook.sh")
        try test.write("hook.sh", "#!/bin/sh\ntouch \"\(marker.path)\"\n")
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: script.path)
        try await test.git("config", "core.fsmonitor", script.path)
        try test.write("a.txt", "xin chào\n")
        _ = try await test.repo.status()
        #expect(!FileManager.default.fileExists(atPath: marker.path))
    }
}
