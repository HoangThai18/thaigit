import Foundation

extension GitRepository {
    /// Lấy nhiều refspec của một remote trong một lần fetch (đầu PR / MR và nhánh đích để review). Người gọi dựng refspec từ số
    /// PR và tên nhánh đã kiểm (`ForgeRequest.reviewRefs`). Không ép đè nhánh local: các refspec chỉ ghi vào `refs/remotes/…`.
    public func fetchRefspecs(_ refspecs: [String], remote: String, onProgress: (@Sendable (String) -> Void)? = nil) async throws {
        try await runner.run(["fetch", "--progress", remote] + refspecs,
                             credentialURLs: await remoteURLs(remote, push: false), onProgress: onProgress)
    }
}
