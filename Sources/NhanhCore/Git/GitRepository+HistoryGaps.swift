import Foundation

/// A repo missing history / branches from its remote: a shallow clone (`--depth`) or a remote that only fetches a few branches
/// (`--single-branch`, a hand-edited refspec — what IDEs, CI and GitLab often do). Then a branch like `main` on the remote
/// never reaches the machine, not even when you press Fetch.
public struct HistoryGaps: Equatable, Sendable {
    /// A shallow clone: older commits are missing (`git rev-parse --is-shallow-repository`).
    public var shallow: Bool
    /// The remote has fetch refspecs but none of them fetches `refs/heads/*`.
    public var narrowRemotes: [String]

    public static let none = HistoryGaps(shallow: false, narrowRemotes: [])

    public init(shallow: Bool, narrowRemotes: [String]) {
        self.shallow = shallow
        self.narrowRemotes = narrowRemotes
    }

    public var isEmpty: Bool { !shallow && narrowRemotes.isEmpty }
}

extension GitParsers {
    /// Whether the fetch refspecs cover every branch of the remote (`[+]refs/heads/*:…`; exclude refspecs (`^…`) are ignored).
    public static func tracksAllBranches(_ refspecs: [String]) -> Bool {
        refspecs.contains { spec in
            let body = spec.hasPrefix("+") ? String(spec.dropFirst()) : spec
            return body.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false).first == "refs/heads/*"
        }
    }

    /// `git config -z --get-regexp '^remote\..+\.fetch$'` output ("key\nvalue\0"…) → refspecs keyed by remote name. A remote
    /// name keeps its case and may contain dots.
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
    /// Look at `HistoryGaps`. Read-only (rev-parse + config), cheap — safe to call on every refs change. A failure is treated as "nothing missing".
    public func historyGaps() async -> HistoryGaps {
        // A git too old to know this flag echoes it back verbatim → not "true" → treated as having full history.
        async let shallowOutput = try? runner.output(["rev-parse", "--is-shallow-repository"])
        // No key matched: git exits with code 1 → no refspecs.
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

    /// Make `remote` track every branch: ADD `+refs/heads/*:refs/remotes/<remote>/*`, keeping the old refspecs
    /// (`git remote set-branches --add <remote> '*'`).
    public func trackAllBranches(remote: String) async throws {
        try await runner.run(["remote", "set-branches", "--add", "--", remote, "*"])
    }

    /// Fetch the missing history of a shallow clone from `remote` (`git fetch --unshallow`).
    public func unshallow(remote: String, onProgress: (@Sendable (String) -> Void)? = nil) async throws {
        let urls = await remoteURLs(remote, push: false)
        try await runner.run(["fetch", "--progress", "--unshallow", "--", remote], credentialURLs: urls, onProgress: onProgress)
    }
}
