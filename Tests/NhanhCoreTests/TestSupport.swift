import Foundation
@testable import NhanhCore

/// Repository tạm cho integration test, cô lập khỏi cấu hình git của máy.
struct TestRepo {
    let url: URL
    let store: GitEnvironmentStore
    let repo: GitRepository

    static func make() async throws -> TestRepo {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("nhanh-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let store = isolatedEnvironment()
        try await GitRepository.initialize(at: dir, environment: store)
        let runner = GitRunner(environmentStore: store, workingDirectory: dir)
        try await runner.run(["config", "user.name", "Nhánh Test"])
        try await runner.run(["config", "user.email", "test@example.com"])
        let repo = try await GitRepository.open(at: dir, environment: store)
        return TestRepo(url: repo.root, store: store, repo: repo)
    }

    static func isolatedEnvironment() -> GitEnvironmentStore {
        var env = GitEnvironment.make(customGitPath: nil, loginShellPath: nil, askPassScript: nil)
        env.variables["GIT_CONFIG_GLOBAL"] = "/dev/null"
        env.variables["GIT_CONFIG_NOSYSTEM"] = "1"
        return GitEnvironmentStore(env)
    }

    func write(_ path: String, _ content: String) throws {
        let url = self.url.appendingPathComponent(path)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(content.utf8).write(to: url)
    }

    func read(_ path: String) throws -> String {
        try String(contentsOf: url.appendingPathComponent(path), encoding: .utf8)
    }

    @discardableResult
    func git(_ args: String...) async throws -> String {
        try await repo.runner.output(args)
    }

    func commitAll(_ message: String) async throws {
        try await repo.stageAll()
        try await repo.commit(message: message, amend: false)
    }

    func cleanup() {
        try? FileManager.default.removeItem(at: url)
    }
}

/// Tạo nội dung nhiều dòng "line 1\nline 2\n..."
func numberedLines(_ count: Int, prefix: String = "line") -> [String] {
    (1...count).map { "\(prefix) \($0)" }
}
