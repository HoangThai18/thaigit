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
        // Byte trong repo đúng như test ghi: không đổi CRLF, không đọc file attributes toàn cục của máy.
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

    /// Byte của blob trong index (`git cat-file blob :path`).
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

/// Tạo nội dung nhiều dòng "line 1\nline 2\n..."
func numberedLines(_ count: Int, prefix: String = "line") -> [String] {
    (1...count).map { "\(prefix) \($0)" }
}

/// Mỗi ký tự U+0000…U+00FF thành đúng một byte — nội dung thật của file Latin-1/CP1252/CP1258.
func latin1(_ text: String) -> Data {
    Data(text.unicodeScalars.map { UInt8($0.value) })
}

/// Byte dạng dễ đọc khi so sánh: "\r", "\n", "\t" và byte ngoài ASCII in được hiện dạng thoát.
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
