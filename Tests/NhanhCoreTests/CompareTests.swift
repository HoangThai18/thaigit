import Foundation
import Testing
@testable import NhanhCore

@Suite("So sánh commit / nhánh")
struct CompareTests {
    @Test func comparesTwoCommitsAndBranches() async throws {
        let t = try await TestRepo.make()
        defer { t.cleanup() }
        try t.write("a.txt", "1\n")
        try await t.commitAll("gốc")
        let root = try await t.repo.resolveCommit("HEAD")
        try await t.git("switch", "-c", "tinh-nang")
        try t.write("a.txt", "1\n2\n")
        try t.write("moi.txt", "mới\n")
        try await t.commitAll("tính năng 1")
        try t.write("b.txt", "b\n")
        try await t.commitAll("tính năng 2")
        let feature = try await t.repo.resolveCommit("HEAD")
        try await t.git("switch", "main")
        try t.write("c.txt", "c\n")
        try await t.commitAll("main đi tiếp")
        let main = try await t.repo.resolveCommit("HEAD")

        // Two arbitrary commits: the files differing between the two revisions.
        let files = try await t.repo.changedFiles(commit: feature, parent: main)
        #expect(Set(files.map(\.path)) == ["a.txt", "b.txt", "c.txt", "moi.txt"])
        // A branch against the divergence point: only that branch's own changes.
        let base = try #require(await t.repo.mergeBase(main, feature))
        #expect(base == root)
        let featureOnly = try await t.repo.changedFiles(commit: feature, parent: base)
        #expect(Set(featureOnly.map(\.path)) == ["a.txt", "b.txt", "moi.txt"])
        let diff = try #require(try await t.repo.diff(commit: feature, parent: base, file: FileChange(path: "a.txt", kind: .modified)))
        #expect(diff.additions == 1)

        let between = try await t.repo.commits(from: main, to: feature)
        #expect(between.map(\.subject) == ["tính năng 2", "tính năng 1"])
        #expect(try await t.repo.commits(from: feature, to: feature).isEmpty)
    }
}
