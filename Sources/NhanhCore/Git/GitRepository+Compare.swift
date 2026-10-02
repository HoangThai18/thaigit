import Foundation

extension GitRepository {
    /// Commit có trong `to` mà không có trong `from` (`from..to`), mới trước — "đi từ A tới B có những commit nào".
    public func commits(from: String, to: String, limit: Int = 300) async throws -> [Commit] {
        let output = try await runner.run(["log", "-z", "--format=\(GitParsers.logFormat)", "--topo-order",
                                           "--max-count=\(limit)", "\(from)..\(to)", "--"])
        return GitParsers.parseLog(output.stdout)
    }

    /// Điểm chung gần nhất của hai lịch sử (nơi hai nhánh tách nhau), nil nếu không có commit chung.
    public func mergeBase(_ a: String, _ b: String) async -> String? {
        guard let output = try? await runner.output(["merge-base", a, b]) else { return nil }
        let sha = output.trimmingCharacters(in: .whitespacesAndNewlines)
        return sha.isEmpty ? nil : sha
    }
}
