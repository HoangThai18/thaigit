import Foundation
import Testing
@testable import NhanhCore

@Suite("Repo watcher")
struct RepoWatcherTests {
    @Test func reportsChangesForRepoOpenedThroughSymlink() async throws {
        let test = try await TestRepo.make()
        defer { test.cleanup() }
        // Thư mục tạm nằm dưới /var → /private/var; FSEvents luôn báo đường dẫn thật.
        let linked = URL(fileURLWithPath: test.url.path.replacingOccurrences(of: "/private/var/", with: "/var/"))
        #expect(linked.path.hasPrefix("/var/"))
        let gitDir = linked.appendingPathComponent(".git")
        let received = LockedBox<RepoWatcher.Change>([])
        let watcher = RepoWatcher(root: linked, gitDir: gitDir, commonDir: gitDir) { change in
            received.withValue { $0.formUnion(change) }
        }
        watcher.start()
        defer { watcher.stop() }
        try await Task.sleep(for: .milliseconds(300))

        try test.write("ghi-chu.txt", "xin chào\n")
        let deadline = Date().addingTimeInterval(5)
        while !received.current.contains(.workingTree), Date() < deadline {
            try await Task.sleep(for: .milliseconds(100))
        }
        #expect(received.current.contains(.workingTree))

        try await test.git("add", "ghi-chu.txt")
        try await test.git("commit", "-m", "Thêm ghi chú")
        let refsDeadline = Date().addingTimeInterval(5)
        while !received.current.contains(.refs), Date() < refsDeadline {
            try await Task.sleep(for: .milliseconds(100))
        }
        #expect(received.current.contains(.refs))
    }

    @Test func relativePathMatchingIgnoresCase() {
        #expect(RepoWatcher.relative("/Users/a/Repo/src/x.swift", to: "/Users/a/repo") == "src/x.swift")
        #expect(RepoWatcher.relative("/Users/a/repo", to: "/Users/a/repo") == "")
        #expect(RepoWatcher.relative("/Users/a/repo2/x", to: "/Users/a/repo") == nil)
        #expect(RepoWatcher.relative("/Users/a/Tài liệu/x", to: "/Users/a/Tài liệu") == "x")
    }
}
