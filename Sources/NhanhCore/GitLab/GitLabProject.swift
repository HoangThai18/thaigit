import Foundation

/// A project on GitLab (gitlab.com or a self-hosted server), parsed from a remote URL: https://, ssh://, git@host:group/project.git.
public struct GitLabProjectRef: Sendable, Hashable {
    /// The host to use for API calls: "gitlab.com", or "gitlab.cong-ty.vn:8443" when the HTTPS remote has a port.
    public let host: String
    /// The project's full path: "group/project" or "group/subgroup/project".
    public let path: String

    public init(host: String, path: String) {
        self.host = host
        self.path = path
    }

    /// "gitlab.com/group/project" — for display.
    public var displayName: String { "\(host)/\(path)" }

    /// The host without its port ("gitlab.cong-ty.vn:8443" → "gitlab.cong-ty.vn").
    public var hostWithoutPort: String { Self.stripPort(host) }

    /// Whether a host is GitLab: it is gitlab.com, its name contains "gitlab", or it is the host of an already added GitLab account (`knownHosts`).
    public static func parse(remoteURL: String, knownHosts: Set<String> = []) -> GitLabProjectRef? {
        var text = remoteURL.trimmingCharacters(in: .whitespacesAndNewlines)
        var keepsPort = false
        if let scheme = text.range(of: "://") {
            keepsPort = text[..<scheme.lowerBound].lowercased().hasPrefix("http")
            text = String(text[scheme.upperBound...])
        } else if let colon = text.firstIndex(of: ":"), !text[..<colon].contains("/") {
            text = text[..<colon] + "/" + text[text.index(after: colon)...]
        } else {
            return nil
        }
        var parts = text.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        guard parts.count >= 3 else { return nil }
        var host = parts.removeFirst()
        if let at = host.lastIndex(of: "@") { host = String(host[host.index(after: at)...]) }
        host = host.lowercased()
        if !keepsPort { host = stripPort(host) }
        guard !host.isEmpty, host.count < 256,
              host.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || "-.:".contains($0)) }),
              isGitLabHost(host, knownHosts: knownHosts) else { return nil }
        if host == "www.gitlab.com" { host = "gitlab.com" }
        if var last = parts.last, last.hasSuffix(".git") {
            last.removeLast(4)
            parts[parts.count - 1] = last
        }
        guard parts.count >= 2, parts.allSatisfy(Self.isSafeSegment) else { return nil }
        return GitLabProjectRef(host: host, path: parts.joined(separator: "/"))
    }

    static func isGitLabHost(_ host: String, knownHosts: Set<String>) -> Bool {
        let bare = stripPort(host)
        if bare == "gitlab.com" || bare == "www.gitlab.com" || bare.contains("gitlab") { return true }
        return knownHosts.contains(host) || knownHosts.contains(bare)
    }

    static func stripPort(_ host: String) -> String {
        host.firstIndex(of: ":").map { String(host[..<$0]) } ?? host
    }

    static func isSafeSegment(_ segment: String) -> Bool {
        guard !segment.isEmpty, segment.count <= 100, segment != ".", segment != ".." else { return false }
        return segment.unicodeScalars.allSatisfy { scalar in
            ("a"..."z").contains(scalar) || ("A"..."Z").contains(scalar) || ("0"..."9").contains(scalar) || "._-".unicodeScalars.contains(scalar)
        }
    }

    /// The project path as used in API URLs: "group%2Fproject".
    var encodedPath: String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))
        return path.addingPercentEncoding(withAllowedCharacters: allowed) ?? path
    }
}

/// The body of a new Merge Request (`POST /api/v4/projects/:id/merge_requests`).
public struct NewMergeRequest: Sendable, Equatable {
    public var title: String
    public var description: String
    public var sourceBranch: String
    public var targetBranch: String
    /// GitLab marks a draft with a "Draft: " prefix in the title.
    public var draft: Bool

    public init(title: String, description: String, sourceBranch: String, targetBranch: String, draft: Bool) {
        self.title = title
        self.description = description
        self.sourceBranch = sourceBranch
        self.targetBranch = targetBranch
        self.draft = draft
    }

    /// The title to send: "Draft: " is prepended when it's a draft and doesn't have it yet.
    var submittedTitle: String {
        guard draft else { return title }
        let lower = title.lowercased()
        return lower.hasPrefix("draft:") || lower.hasPrefix("[draft]") || lower.hasPrefix("(draft)") ? title : "Draft: \(title)"
    }
}

/// A newly created Merge Request.
public struct GitLabMergeRequest: Sendable, Equatable {
    /// The MR's number within the project (`iid`, shown as !12).
    public let iid: Int
    public let title: String
    public let webURL: URL?

    public init(iid: Int, title: String, webURL: URL?) {
        self.iid = iid
        self.title = title
        self.webURL = webURL
    }
}
