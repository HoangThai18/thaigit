import Foundation

extension GitRepository {
    /// Fetch branch of Pull Request number `number` (GitHub keeps it at `refs/pull/N/head` on the remote, even for
    /// forked PRs) into local branch `localBranch`. No force (no "+"): if the local branch has its own commits git refuses rather than overwriting.
    public func fetchPullRequest(_ number: Int, remote: String, into localBranch: String,
                                 onProgress: (@Sendable (String) -> Void)? = nil) async throws {
        try await runner.run(["fetch", "--progress", remote, "refs/pull/\(number)/head:refs/heads/\(localBranch)"],
                             credentialURLs: await remoteURLs(remote, push: false), onProgress: onProgress)
    }
}
