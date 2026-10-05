import Foundation

extension GitRepository {
    /// Fetch several refspecs of one remote in a single fetch (the PR / MR head plus the target branch, for review). The caller builds the
    /// refspecs from the PR number and an already validated branch name (`ForgeRequest.reviewRefs`). Local branches are never
    /// force-updated: the refspecs only write into `refs/remotes/…`.
    public func fetchRefspecs(_ refspecs: [String], remote: String, onProgress: (@Sendable (String) -> Void)? = nil) async throws {
        try await runner.run(["fetch", "--progress", remote] + refspecs,
                             credentialURLs: await remoteURLs(remote, push: false), onProgress: onProgress)
    }
}
