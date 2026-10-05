import Foundation

extension GitRepository {
    /// The commits in `to` but not in `from` (`from..to`), newest first — "which commits does going from A to B bring".
    public func commits(from: String, to: String, limit: Int = 300) async throws -> [Commit] {
        let output = try await runner.run(["log", "-z", "--format=\(GitParsers.logFormat)", "--topo-order",
                                           "--max-count=\(limit)", "\(from)..\(to)", "--"])
        return GitParsers.parseLog(output.stdout)
    }

    /// The closest common point of two histories (where the branches forked), nil when there is no shared commit.
    public func mergeBase(_ a: String, _ b: String) async -> String? {
        guard let output = try? await runner.output(["merge-base", a, b]) else { return nil }
        let sha = output.trimmingCharacters(in: .whitespacesAndNewlines)
        return sha.isEmpty ? nil : sha
    }
}
