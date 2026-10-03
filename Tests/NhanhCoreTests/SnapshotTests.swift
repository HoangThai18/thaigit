import Foundation
import Testing
@testable import NhanhCore

/// File đặc tả dùng chung với app Tauri (`packages/contracts`).
private func contractJSON(_ name: String) throws -> [String: Any] {
    let url = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("packages/contracts/\(name)")
    let object = try JSONSerialization.jsonObject(with: Data(contentsOf: url))
    return try #require(object as? [String: Any])
}

@Suite("Snapshot: đặc tả chung với app Tauri")
struct SnapshotSpecTests {
    @Test func constantsMatchTheSharedSpec() throws {
        let spec = try contractJSON("snapshot.json")
        #expect(spec["ref"] as? String == SnapshotSpec.ref)
        #expect(spec["indexFile"] as? String == SnapshotSpec.indexFile)
        #expect(spec["messageHeader"] as? String == SnapshotSpec.messageHeader)
        #expect(spec["reflogMessage"] as? String == SnapshotSpec.reflogMessage)
        let identity = try #require(spec["identity"] as? [String: String])
        #expect(identity["name"] == SnapshotSpec.identityName)
        #expect(identity["email"] == SnapshotSpec.identityEmail)
        #expect(spec["reasons"] as? [String] == SnapshotReason.allCases.map(\.rawValue))
        let defaults = try #require(spec["defaults"] as? [String: Int])
        #expect(defaults["quietMs"] == Int(SnapshotSpec.quietSeconds * 1000))
        #expect(defaults["minIntervalMs"] == Int(SnapshotSpec.minIntervalSeconds * 1000))
        #expect(defaults["pruneIntervalMs"] == Int(SnapshotSpec.pruneIntervalSeconds * 1000))
        #expect(defaults["keepDays"] == SnapshotSpec.defaultKeepDays)
        #expect(defaults["keepCount"] == SnapshotSpec.defaultKeepCount)
    }

    @Test func parseMessageVectors() throws {
        let vectors = try contractJSON("snapshot.vectors.json")
        let cases = try #require(vectors["parse"] as? [[String: Any]])
        #expect(!cases.isEmpty)
        for item in cases {
            let message = try #require(item["message"] as? String)
            let parsed = SnapshotSpec.parseMessage(message)
            if let expected = item["expected"] as? [String: Any] {
                #expect(parsed?.reason.rawValue == expected["reason"] as? String, "\(message.debugDescription)")
                #expect(parsed?.files == expected["files"] as? Int, "\(message.debugDescription)")
                if expected["files"] is NSNull { #expect(parsed?.files == nil) }
            } else {
                #expect(parsed == nil, "\(message.debugDescription)")
            }
        }
    }

    @Test func formatMessageVectors() throws {
        let vectors = try contractJSON("snapshot.vectors.json")
        let cases = try #require(vectors["format"] as? [[String: Any]])
        for item in cases {
            let raw = try #require(item["reason"] as? String)
            let reason = try #require(SnapshotReason(rawValue: raw))
            let files = try #require(item["files"] as? Int)
            let message = SnapshotSpec.formatMessage(reason: reason, files: files)
            #expect(message == item["expected"] as? String)
            #expect(SnapshotSpec.parseMessage(message) == SnapshotMeta(reason: reason, files: files))
        }
    }

    @Test func expiredVectors() throws {
        let vectors = try contractJSON("snapshot.vectors.json")
        let cases = try #require(vectors["expired"] as? [[String: Any]])
        for item in cases {
            let times = try #require(item["times"] as? [Int])
            let entries = times.enumerated().map { (index: $0.offset, time: $0.element) }
            let now = try #require(item["now"] as? Int)
            let keepDays = try #require(item["keepDays"] as? Int)
            let keepCount = try #require(item["keepCount"] as? Int)
            let result = SnapshotSpec.selectExpired(entries: entries, now: now, keepDays: keepDays, keepCount: keepCount)
            #expect(result == item["expected"] as? [Int], "\(times)")
        }
    }

    @Test func watcherIgnoresTheSnapshotRef() {
        #expect(RepoWatcher.classifyGitPath("refs/worktree/thaigit/snapshots") == [])
        #expect(RepoWatcher.classifyGitPath("worktrees/wt/refs/worktree/thaigit/snapshots") == [])
        #expect(RepoWatcher.classifyGitPath("thaigit/snapshot.index") == [])
        #expect(RepoWatcher.classifyGitPath("refs/worktree/khac") == [.refs, .workingTree])
    }
}

@Suite("Snapshot: chụp, khôi phục, dọn (git thật)")
struct SnapshotTests {
    private func seeded() async throws -> TestRepo {
        let t = try await TestRepo.make()
        try t.write("a.txt", "a1\n")
        try t.write(".gitignore", "build/\n*.log\n")
        try await t.commitAll("init")
        return t
    }

    @Test func takeCapturesUntrackedFilesWithoutTouchingTheUsersIndex() async throws {
        let t = try await seeded()
        defer { t.cleanup() }
        try t.write("a.txt", "a2\n")
        try t.write("thư mục/tệp có dấu cách.txt", "mới\n")
        try t.write("build/out.bin", "bỏ qua")
        try t.write("debug.log", "bỏ qua")
        try t.write("staged.txt", "đã stage\n")
        try await t.git("add", "staged.txt")
        let statusBefore = try await t.git("status", "--porcelain=v1", "--untracked-files=all")
        let cachedBefore = try await t.git("diff", "--cached", "--name-status")
        let head = try await t.repo.resolveCommit("HEAD")

        let entry = try await t.repo.takeSnapshot(reason: .auto)

        #expect(try await t.git("status", "--porcelain=v1", "--untracked-files=all") == statusBefore)
        #expect(try await t.git("diff", "--cached", "--name-status") == cachedBefore)
        #expect(try await t.git("show", "\(entry.sha):a.txt") == "a2\n")
        #expect(try await t.git("show", "\(entry.sha):thư mục/tệp có dấu cách.txt") == "mới\n")
        let files = try await t.git("ls-tree", "-r", "--name-only", entry.sha)
        #expect(!files.contains("build/") && !files.contains("debug.log"))
        #expect(try await t.git("rev-parse", "\(entry.sha)^").trimmingCharacters(in: .whitespacesAndNewlines) == head)
        #expect(try await t.git("log", "-1", "--format=%an <%ae>", entry.sha).trimmingCharacters(in: .newlines)
            == "Thaigit <snapshot@thaigit.invalid>")
        #expect(entry.index == 0 && entry.reason == .auto && entry.files == 3)
    }

    @Test func unchangedTreeReusesTheLatestSnapshot() async throws {
        let t = try await seeded()
        defer { t.cleanup() }
        try t.write("a.txt", "a2\n")
        let first = try await t.repo.takeSnapshot(reason: .auto)
        let second = try await t.repo.takeSnapshot(reason: .auto)
        #expect(first.sha == second.sha)
        #expect(try await t.repo.snapshots().count == 1)
        try t.write("a.txt", "a3\n")
        _ = try await t.repo.takeSnapshot(reason: .manual)
        #expect(try await t.repo.snapshots().map(\.reason) == [.manual, .auto])
    }

    @Test func unbornRepoAndSigningConfigAreHandled() async throws {
        let t = try await TestRepo.make()
        defer { t.cleanup() }
        try await t.git("config", "commit.gpgSign", "true")
        try await t.git("config", "gpg.program", "/bin/false")
        try t.write("dau-tien.txt", "x\n")
        let entry = try await t.repo.takeSnapshot(reason: .auto)
        #expect(try await t.git("rev-list", "--parents", "-n1", entry.sha).trimmingCharacters(in: .newlines) == entry.sha)
        #expect(entry.files == 1)
    }

    @Test func staleIndexLockIsCleanedUp() async throws {
        let t = try await seeded()
        defer { t.cleanup() }
        let dir = t.repo.gitDir.appendingPathComponent("thaigit")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try Data().write(to: dir.appendingPathComponent("snapshot.index.lock"))
        try t.write("a.txt", "a2\n")
        let entry = try await t.repo.takeSnapshot(reason: .auto)
        #expect(try await t.git("show", "\(entry.sha):a.txt") == "a2\n")
        #expect(!FileManager.default.fileExists(atPath: dir.appendingPathComponent("snapshot.index.lock").path))
    }

    @Test func eachWorktreeHasItsOwnTimeline() async throws {
        let t = try await seeded()
        defer { t.cleanup() }
        try t.write("a.txt", "a2\n")
        _ = try await t.repo.takeSnapshot(reason: .auto)
        let other = t.url.deletingLastPathComponent().appendingPathComponent("wt-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: other) }
        try await t.git("worktree", "add", "-q", "-b", "khac", other.path)
        let otherRepo = try await GitRepository.open(at: other, environment: t.store)
        #expect(try await otherRepo.snapshots().isEmpty)
        try Data("b\n".utf8).write(to: other.appendingPathComponent("b.txt"))
        _ = try await otherRepo.takeSnapshot(reason: .auto)
        #expect(try await otherRepo.snapshots().count == 1)
        #expect(try await t.repo.snapshots().count == 1)
    }

    @Test func restoreOneFileByteExactAndUndo() async throws {
        let t = try await seeded()
        defer { t.cleanup() }
        let original = Data([0xEF, 0xBB, 0xBF, 0x78, 0x0D, 0x0A, 0xE9, 0x00, 0xFF, 0x0A])
        try t.write("du-lieu.bin", bytes: original)
        try t.write("khac.txt", "giữ nguyên\n")
        let target = try await t.repo.takeSnapshot(reason: .auto)
        try t.write("du-lieu.bin", "agent ghi đè\r\n")
        try t.write("khac.txt", "cũng đổi\n")
        let cachedBefore = try await t.git("diff", "--cached", "--name-status")

        let result = try await t.repo.restoreSnapshot(target.sha, paths: ["du-lieu.bin"])
        #expect(try t.readBytes("du-lieu.bin") == original)
        #expect(try t.read("khac.txt") == "cũng đổi\n")
        #expect(try await t.git("diff", "--cached", "--name-status") == cachedBefore)
        #expect(result.before.reason == .beforeRestore)

        _ = try await t.repo.restoreSnapshot(result.before.sha, paths: ["du-lieu.bin"])
        #expect(try t.read("du-lieu.bin") == "agent ghi đè\r\n")
    }

    @Test func restoreEverythingThenUndo() async throws {
        let t = try await seeded()
        defer { t.cleanup() }
        try t.write("b.txt", "b\n")
        try await t.commitAll("thêm b")
        try t.write("nhap.txt", "bản nháp cũ\n")
        let target = try await t.repo.takeSnapshot(reason: .auto)

        try t.write("a.txt", "agent\n")
        try await t.git("rm", "-q", "b.txt")
        try FileManager.default.removeItem(at: t.url.appendingPathComponent("nhap.txt"))
        try t.write("src/moi/x.swift", "let x = 1\n")
        let cachedBefore = try await t.git("diff", "--cached", "--name-status")

        let result = try await t.repo.restoreSnapshot(target.sha, paths: nil)
        #expect(try t.read("a.txt") == "a1\n")
        #expect(try t.read("b.txt") == "b\n")
        #expect(try t.read("nhap.txt") == "bản nháp cũ\n")
        #expect(!FileManager.default.fileExists(atPath: t.url.appendingPathComponent("src/moi/x.swift").path))
        #expect(result.trashed.contains("src/moi/x.swift"))
        #expect(try await t.git("diff", "--cached", "--name-status") == cachedBefore)

        _ = try await t.repo.restoreSnapshot(result.before.sha, paths: nil)
        #expect(try t.read("a.txt") == "agent\n")
        #expect(!FileManager.default.fileExists(atPath: t.url.appendingPathComponent("nhap.txt").path))
        #expect(try t.read("src/moi/x.swift") == "let x = 1\n")
    }

    @Test func pruneKeepsTheNewestAndRespectsLimits() async throws {
        let t = try await seeded()
        defer { t.cleanup() }
        for value in ["1", "2", "3", "4"] {
            try t.write("a.txt", "\(value)\n")
            _ = try await t.repo.takeSnapshot(reason: .auto)
        }
        let now = Int(Date().timeIntervalSince1970)
        #expect(try await t.repo.pruneSnapshots(now: now, keepDays: 7, keepCount: 300) == 0)
        #expect(try await t.repo.pruneSnapshots(now: now, keepDays: 7, keepCount: 2) == 2)
        let left = try await t.repo.snapshots()
        #expect(left.map(\.index) == [0, 1])
        #expect(try await t.git("show", "\(left[0].sha):a.txt") == "4\n")
        #expect(try await t.repo.pruneSnapshots(now: now + 8 * 86_400, keepDays: 7, keepCount: 300) == 1)
        #expect(try await t.repo.snapshots().count == 1)
        #expect(try await t.repo.pruneSnapshots(now: 0, keepDays: 7, keepCount: 300) == 0)
    }

    @Test func noSnapshotsYetIsNotAnError() async throws {
        let t = try await seeded()
        defer { t.cleanup() }
        #expect(try await t.repo.snapshots().isEmpty)
        #expect(try await t.repo.pruneSnapshots(now: 0, keepDays: 7, keepCount: 300) == 0)
    }
}
