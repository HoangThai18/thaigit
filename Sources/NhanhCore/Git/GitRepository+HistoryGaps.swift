import Foundation

/// Repo thiếu lịch sử / nhánh của remote: clone nông (`--depth`) hoặc remote chỉ fetch vài nhánh (`--single-branch`, refspec
/// sửa tay — IDE, CI, GitLab hay dùng). Khi đó nhánh như `main` trên remote không bao giờ về máy, kể cả khi bấm Fetch.
public struct HistoryGaps: Equatable, Sendable {
    /// Clone nông: thiếu commit cũ (`git rev-parse --is-shallow-repository`).
    public var shallow: Bool
    /// Remote có refspec fetch nhưng không cái nào lấy `refs/heads/*`.
    public var narrowRemotes: [String]

    public static let none = HistoryGaps(shallow: false, narrowRemotes: [])

    public init(shallow: Bool, narrowRemotes: [String]) {
        self.shallow = shallow
        self.narrowRemotes = narrowRemotes
    }

    public var isEmpty: Bool { !shallow && narrowRemotes.isEmpty }
}

extension GitParsers {
    /// Refspec fetch có lấy mọi nhánh của remote không (`[+]refs/heads/*:…`; bỏ qua refspec loại trừ `^…`).
    public static func tracksAllBranches(_ refspecs: [String]) -> Bool {
        refspecs.contains { spec in
            let body = spec.hasPrefix("+") ? String(spec.dropFirst()) : spec
            return body.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false).first == "refs/heads/*"
        }
    }

    /// Output `git config -z --get-regexp '^remote\..+\.fetch$'` ("khoá\ngiá trị\0"…) → refspec theo tên remote. Tên remote
    /// giữ nguyên hoa thường và có thể chứa dấu chấm.
    public static func fetchRefspecs(_ output: String) -> [String: [String]] {
        var byRemote: [String: [String]] = [:]
        for entry in output.split(separator: "\0", omittingEmptySubsequences: true) {
            guard let newline = entry.firstIndex(of: "\n") else { continue }
            let key = String(entry[..<newline])
            let lower = key.lowercased()
            guard lower.hasPrefix("remote."), lower.hasSuffix(".fetch"), key.count > "remote.".count + ".fetch".count else { continue }
            let name = String(key.dropFirst("remote.".count).dropLast(".fetch".count))
            byRemote[name, default: []].append(String(entry[entry.index(after: newline)...]))
        }
        return byRemote
    }
}

extension GitRepository {
    /// Xem `HistoryGaps`. Chỉ đọc (rev-parse + config), rẻ — gọi lại mỗi lần refs đổi được. Lỗi → coi như không thiếu gì.
    public func historyGaps() async -> HistoryGaps {
        // git quá cũ không hiểu cờ này thì in lại nguyên chữ → không phải "true" → coi như đủ lịch sử.
        async let shallowOutput = try? runner.output(["rev-parse", "--is-shallow-repository"])
        // Không có khoá nào khớp: git thoát mã 1 → không có refspec.
        async let refspecOutput = try? runner.output(["config", "-z", "--get-regexp", "^remote\\..+\\.fetch$"])
        async let remoteList = try? remotes()
        let shallow = (await shallowOutput)?.trimmingCharacters(in: .whitespacesAndNewlines) == "true"
        let refspecs = GitParsers.fetchRefspecs(await refspecOutput ?? "")
        let narrow = (await remoteList ?? []).map(\.name).filter { name in
            let specs = refspecs[name] ?? []
            return !specs.isEmpty && !GitParsers.tracksAllBranches(specs)
        }
        return HistoryGaps(shallow: shallow, narrowRemotes: narrow)
    }

    /// Cho `remote` theo dõi mọi nhánh: THÊM `+refs/heads/*:refs/remotes/<remote>/*`, giữ refspec cũ
    /// (`git remote set-branches --add <remote> '*'`).
    public func trackAllBranches(remote: String) async throws {
        try await runner.run(["remote", "set-branches", "--add", "--", remote, "*"])
    }

    /// Lấy phần lịch sử còn thiếu của clone nông từ `remote` (`git fetch --unshallow`).
    public func unshallow(remote: String, onProgress: (@Sendable (String) -> Void)? = nil) async throws {
        let urls = await remoteURLs(remote, push: false)
        try await runner.run(["fetch", "--progress", "--unshallow", "--", remote], credentialURLs: urls, onProgress: onProgress)
    }
}
