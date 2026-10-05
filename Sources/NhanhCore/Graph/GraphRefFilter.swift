import Foundation

/// Hidden / show-only ("solo") branches on the graph, like GitKraken. Refs are written with their full name
/// (`refs/heads/x`, `refs/remotes/origin/x`).
/// Hiding a branch only removes it from the history starting points: commits shared with another branch stay visible.
public struct GraphRefFilter: Sendable, Equatable, Codable {
    public var hidden: Set<String>
    /// Non-empty: the graph contains only the history of these refs.
    public var solo: Set<String>

    public init(hidden: Set<String> = [], solo: Set<String> = []) {
        self.hidden = hidden
        self.solo = solo
    }

    public var isActive: Bool { !hidden.isEmpty || !solo.isEmpty }

    /// Whether a ref is drawn on the graph (label, own history). Tags are always shown when not solo.
    public func isVisible(_ fullName: String) -> Bool {
        if !solo.isEmpty { return solo.contains(fullName) }
        return !hidden.contains(fullName)
    }

    /// Drops refs that no longer exist (a deleted branch).
    public func keeping(_ existing: Set<String>) -> GraphRefFilter {
        GraphRefFilter(hidden: hidden.intersection(existing), solo: solo.intersection(existing))
    }

    /// The arguments choosing the starting points for `git log` (instead of `--branches --remotes --tags HEAD`).
    /// - solo: exactly those refs, plus HEAD (the checked-out branch and the WIP row are always shown).
    /// - hide: `--exclude=<pattern>` placed right before `--branches` / `--remotes` (patterns carry no
    ///   `refs/heads/` or `refs/remotes/` prefix and get their glob characters escaped — git treats an
    ///   --exclude pattern as a glob).
    public func revisionArguments(includeHEAD: Bool, includeRemotes: Bool, includeTags: Bool) -> [String] {
        if !solo.isEmpty {
            var args = solo.filter { $0.hasPrefix("refs/") }.sorted()
            if includeHEAD { args.append("HEAD") }
            return args
        }
        var args = excludes(prefix: "refs/heads/") + ["--branches"]
        if includeRemotes { args += excludes(prefix: "refs/remotes/") + ["--remotes"] }
        if includeTags { args += excludes(prefix: "refs/tags/") + ["--tags"] }
        if includeHEAD { args.append("HEAD") }
        return args
    }

    private func excludes(prefix: String) -> [String] {
        hidden.filter { $0.hasPrefix(prefix) }.sorted().map { "--exclude=" + Self.escapeGlob(String($0.dropFirst(prefix.count))) }
    }

    static func escapeGlob(_ text: String) -> String {
        var result = ""
        for character in text {
            if "*?[]\\".contains(character) { result.append("\\") }
            result.append(character)
        }
        return result
    }
}
