import Foundation
@testable import NhanhCore

/// A temp repository for integration tests, isolated from the machine's git config.
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
        // Bytes in the repo are exactly what the test wrote: no CRLF conversion, no reading of the machine's global file attributes.
        try await runner.run(["config", "core.autocrlf", "false"])
        try await runner.run(["config", "core.attributesFile", "/dev/null"])
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

    func write(_ path: String, bytes: Data) throws {
        let url = self.url.appendingPathComponent(path)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try bytes.write(to: url)
    }

    func read(_ path: String) throws -> String {
        try String(contentsOf: url.appendingPathComponent(path), encoding: .utf8)
    }

    func readBytes(_ path: String) throws -> Data {
        try Data(contentsOf: url.appendingPathComponent(path))
    }

    /// A blob's bytes in the index (`git cat-file blob :path`).
    func indexBlob(_ path: String) async throws -> Data {
        try await repo.blob(":" + path)
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

/// Builds multi-line content "line 1\nline 2\n..."
func numberedLines(_ count: Int, prefix: String = "line") -> [String] {
    (1...count).map { "\(prefix) \($0)" }
}

/// Every character U+0000…U+00FF as exactly one byte — the real content of a Latin-1 / CP1252 / CP1258 file.
func latin1(_ text: String) -> Data {
    Data(text.unicodeScalars.map { UInt8($0.value) })
}

/// Bytes in a readable form for comparisons: "\r", "\n", "\t" and printable non-ASCII bytes are shown escaped.
func show(_ data: Data) -> String {
    data.map { byte -> String in
        switch byte {
        case 0x0D: return "\\r"
        case 0x0A: return "\\n"
        case 0x09: return "\\t"
        case 0x20..<0x7F: return String(UnicodeScalar(byte))
        default: return String(format: "\\x%02X", byte)
        }
    }.joined()
}
