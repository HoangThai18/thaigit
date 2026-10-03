import Foundation
import Testing
@testable import NhanhCore

/// Repo thiếu nhánh / lịch sử của remote (clone `--single-branch` / `--depth`): phát hiện và lấy đủ — git thật.
@Suite("Thiếu nhánh / lịch sử của remote")
struct HistoryGapsTests {
    @Test("Refspec lấy mọi nhánh / một nhánh / loại trừ")
    func refspecs() {
        #expect(GitParsers.tracksAllBranches(["+refs/heads/*:refs/remotes/origin/*"]))
        #expect(GitParsers.tracksAllBranches(["refs/heads/*:refs/remotes/origin/*"]))
        #expect(!GitParsers.tracksAllBranches(["+refs/heads/main:refs/remotes/origin/main"]))
        #expect(!GitParsers.tracksAllBranches(["^refs/heads/*"]))
        #expect(!GitParsers.tracksAllBranches([]))
        let parsed = GitParsers.fetchRefspecs(
            "remote.origin.fetch\n+refs/heads/main:refs/remotes/origin/main\0"
                + "remote.Gitlab.Mirror.fetch\n+refs/heads/*:refs/remotes/Gitlab.Mirror/*\0"
                + "remote.origin.fetch\n+refs/heads/dev:refs/remotes/origin/dev\0")
        #expect(parsed["origin"] == ["+refs/heads/main:refs/remotes/origin/main", "+refs/heads/dev:refs/remotes/origin/dev"])
        #expect(parsed["Gitlab.Mirror"] == ["+refs/heads/*:refs/remotes/Gitlab.Mirror/*"])
        #expect(GitParsers.fetchRefspecs("").isEmpty)
    }

    @Test("clone --single-branch --depth 1 → báo thiếu, lấy đủ nhánh và lịch sử sau khi sửa")
    func shallowSingleBranch() async throws {
        let origin = try await TestRepo.make()
        defer { origin.cleanup() }
        for index in 1...3 {
            try origin.write("f\(index).txt", "\(index)\n")
            try await origin.commitAll("main \(index)")
        }
        try await origin.git("switch", "-q", "-c", "feature/x")
        try origin.write("x.txt", "x\n")
        try await origin.commitAll("feature")
        try await origin.git("switch", "-q", "main")

        let parent = FileManager.default.temporaryDirectory.appendingPathComponent("nhanh-gaps-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: parent) }
        try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true)
        // `--depth` bị bỏ qua với đường dẫn cục bộ — phải dùng URL file://.
        let runner = GitRunner(environmentStore: origin.store, workingDirectory: parent)
        try await runner.run(["clone", "-q", "--single-branch", "--branch", "main", "--depth", "1",
                              origin.url.absoluteURL.absoluteString, "ban-sao"])
        let clone = try await GitRepository.open(at: parent.appendingPathComponent("ban-sao"), environment: origin.store)

        #expect(await clone.historyGaps() == HistoryGaps(shallow: true, narrowRemotes: ["origin"]))
        #expect(try await clone.log(limit: 50, order: .topo, includeHEAD: true).count == 1)

        try await clone.trackAllBranches(remote: "origin")
        try await clone.unshallow(remote: "origin")
        try await clone.fetch(remote: nil, prune: false)

        #expect(await clone.historyGaps() == .none)
        #expect(try await clone.refs().map(\.fullName).contains("refs/remotes/origin/feature/x"))
        #expect(try await clone.log(limit: 50, order: .topo, includeHEAD: true).count == 4)
        // Refspec cũ vẫn còn (chỉ THÊM refspec mọi nhánh).
        let specs = try await clone.runner.output(["config", "--get-all", "remote.origin.fetch"])
        #expect(specs.split(separator: "\n") == ["+refs/heads/main:refs/remotes/origin/main", "+refs/heads/*:refs/remotes/origin/*"])
    }

    @Test("Repo không có remote: không thiếu gì")
    func noRemote() async throws {
        let test = try await TestRepo.make()
        defer { test.cleanup() }
        #expect(await test.repo.historyGaps() == .none)
    }
}
