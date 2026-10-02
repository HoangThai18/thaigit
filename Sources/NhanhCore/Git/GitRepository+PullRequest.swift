import Foundation

extension GitRepository {
    /// Lấy nhánh của Pull Request số `number` (GitHub giữ ở `refs/pull/N/head` trên remote, kể cả PR từ fork) về nhánh
    /// local `localBranch`. Không ép (không có "+"): nhánh local đã có commit riêng thì git từ chối thay vì ghi đè.
    public func fetchPullRequest(_ number: Int, remote: String, into localBranch: String,
                                 onProgress: (@Sendable (String) -> Void)? = nil) async throws {
        try await runner.run(["fetch", "--progress", remote, "refs/pull/\(number)/head:refs/heads/\(localBranch)"],
                             credentialURLs: await remoteURLs(remote, push: false), onProgress: onProgress)
    }
}
