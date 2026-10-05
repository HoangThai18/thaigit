import Foundation

/// Project trên GitLab (gitlab.com hoặc máy chủ tự host), tách từ URL remote: https://, ssh://, git@host:nhom/du-an.git.
public struct GitLabProjectRef: Sendable, Hashable {
    /// Host dùng cho API: "gitlab.com", hoặc "gitlab.cong-ty.vn:8443" khi remote HTTPS có cổng.
    public let host: String
    /// Đường dẫn đầy đủ của project: "nhom/du-an" hoặc "nhom/nhom-con/du-an".
    public let path: String

    public init(host: String, path: String) {
        self.host = host
        self.path = path
    }

    /// "gitlab.com/nhom/du-an" — để hiển thị.
    public var displayName: String { "\(host)/\(path)" }

    /// Host không kèm cổng ("gitlab.cong-ty.vn:8443" → "gitlab.cong-ty.vn").
    public var hostWithoutPort: String { Self.stripPort(host) }

    /// Nhận GitLab khi host là gitlab.com, có tên chứa "gitlab", hoặc là host của một tài khoản GitLab đã thêm (`knownHosts`).
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

    /// Đường dẫn project dạng dùng trong URL API: "nhom%2Fdu-an".
    var encodedPath: String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))
        return path.addingPercentEncoding(withAllowedCharacters: allowed) ?? path
    }
}

/// Nội dung một Merge Request mới (`POST /api/v4/projects/:id/merge_requests`).
public struct NewMergeRequest: Sendable, Equatable {
    public var title: String
    public var description: String
    public var sourceBranch: String
    public var targetBranch: String
    /// GitLab đánh dấu nháp bằng tiền tố "Draft: " trong tiêu đề.
    public var draft: Bool

    public init(title: String, description: String, sourceBranch: String, targetBranch: String, draft: Bool) {
        self.title = title
        self.description = description
        self.sourceBranch = sourceBranch
        self.targetBranch = targetBranch
        self.draft = draft
    }

    /// Tiêu đề gửi đi: thêm "Draft: " khi là nháp và chưa có.
    var submittedTitle: String {
        guard draft else { return title }
        let lower = title.lowercased()
        return lower.hasPrefix("draft:") || lower.hasPrefix("[draft]") || lower.hasPrefix("(draft)") ? title : "Draft: \(title)"
    }
}

/// Merge Request vừa tạo.
public struct GitLabMergeRequest: Sendable, Equatable {
    /// Số của MR trong project (`iid`, hiện dạng !12).
    public let iid: Int
    public let title: String
    public let webURL: URL?

    public init(iid: Int, title: String, webURL: URL?) {
        self.iid = iid
        self.title = title
        self.webURL = webURL
    }
}
