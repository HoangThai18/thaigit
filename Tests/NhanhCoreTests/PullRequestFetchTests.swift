import Foundation
import Testing
@testable import NhanhCore

@Suite("Lấy nhánh của Pull Request về máy")
struct PullRequestFetchTests {
    @Test func fetchesPullRequestHeadIntoLocalBranch() async throws {
        let origin = try await TestRepo.make()
        defer { origin.cleanup() }
        try origin.write("a.txt", "1\n")
        try await origin.commitAll("gốc")
        // Same as GitHub: a (forked) PR's branch only exists at refs/pull/7/head.
        try await origin.git("switch", "-c", "tam")
        try origin.write("a.txt", "1\nfork\n")
        try await origin.commitAll("thay đổi từ fork")
        let prHead = try await origin.repo.resolveCommit("HEAD")
        try await origin.git("update-ref", "refs/pull/7/head", prHead)
        try await origin.git("switch", "main")
        try await origin.git("branch", "-D", "tam")

        let parent = FileManager.default.temporaryDirectory.appendingPathComponent("nhanh-pr-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: parent) }
        let destination = parent.appendingPathComponent("ban-sao")
        try await GitRepository.clone(url: origin.url.path, to: destination, environment: origin.store)
        let clone = try await GitRepository.open(at: destination, environment: origin.store)

        try await clone.fetchPullRequest(7, remote: "origin", into: "pr/7")
        let refs = try await clone.refs()
        #expect(refs.first { $0.kind == .localBranch && $0.name == "pr/7" }?.target == prHead)

        // The PR was updated (a commit added): re-fetching advances the local branch.
        try await origin.git("switch", "-c", "tam2", prHead)
        try origin.write("b.txt", "b\n")
        try await origin.commitAll("sửa theo review")
        let newHead = try await origin.repo.resolveCommit("HEAD")
        try await origin.git("update-ref", "refs/pull/7/head", newHead)
        try await clone.fetchPullRequest(7, remote: "origin", into: "pr/7")
        #expect(try await clone.refs().first { $0.name == "pr/7" }?.target == newHead)
    }
}
