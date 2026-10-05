import CryptoKit
import Foundation

/// A repository on github.com, parsed out of a remote URL (https://, ssh://, git@github.com:…).
public struct GitHubRepoRef: Sendable, Hashable {
    public let owner: String
    public let name: String

    public init(owner: String, name: String) {
        self.owner = owner
        self.name = name
    }

    public static func parse(remoteURL: String) -> GitHubRepoRef? {
        var text = remoteURL.trimmingCharacters(in: .whitespacesAndNewlines)
        if let scheme = text.range(of: "://") {
            text = String(text[scheme.upperBound...])
        } else if let colon = text.firstIndex(of: ":"), !text[..<colon].contains("/") {
            // scp form: git@github.com:owner/repo.git
            text = text[..<colon] + "/" + text[text.index(after: colon)...]
        } else {
            return nil
        }
        var parts = text.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        guard parts.count >= 3 else { return nil }
        var host = parts.removeFirst()
        if let at = host.lastIndex(of: "@") { host = String(host[host.index(after: at)...]) }
        if let port = host.firstIndex(of: ":") { host = String(host[..<port]) }
        guard ["github.com", "www.github.com", "ssh.github.com"].contains(host.lowercased()) else { return nil }
        var name = parts[1]
        if name.hasSuffix(".git") { name.removeLast(4) }
        guard !parts[0].isEmpty, !name.isEmpty else { return nil }
        return GitHubRepoRef(owner: parts[0], name: name)
    }
}

/// An avatar address looked up by commit author email.
public enum AvatarSource {
    public static func normalize(_ email: String) -> String {
        email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    /// SHA-256 of the normalised email (hex): the cache file name and the Gravatar code.
    public static func hash(_ email: String) -> String {
        SHA256.hash(data: Data(normalize(email).utf8)).map { String(format: "%02x", $0) }.joined()
    }

    /// GitHub's hidden email: "12345+ten@users.noreply.github.com" → (12345, "ten"); "ten@users.noreply.github.com" → (nil, "ten").
    public static func githubNoreply(_ email: String) -> (id: Int?, login: String)? {
        let normalized = normalize(email)
        let suffix = "@users.noreply.github.com"
        guard normalized.hasSuffix(suffix) else { return nil }
        let local = normalized.dropLast(suffix.count)
        if let plus = local.firstIndex(of: "+"), let id = Int(local[..<plus]) {
            let login = String(local[local.index(after: plus)...])
            return login.isEmpty ? nil : (id, login)
        }
        return local.isEmpty ? nil : (nil, String(local))
    }

    public static func githubAvatarURL(id: Int?, login: String, size: Int) -> URL? {
        if let id { return URL(string: "https://avatars.githubusercontent.com/u/\(id)?s=\(size)&v=4") }
        guard let encoded = login.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) else { return nil }
        return URL(string: "https://github.com/\(encoded).png?size=\(size)")
    }

    /// `d=404`: Gravatar 404s when there's no image (it never serves a default image) so the app can draw initials.
    public static func gravatarURL(email: String, size: Int) -> URL? {
        URL(string: "https://gravatar.com/avatar/\(hash(email))?s=\(size)&d=404")
    }

    /// GitHub API: the author's most recent commit in the repo — the GitHub account behind that email carries `avatar_url`.
    public static func githubCommitsRequest(repo: GitHubRepoRef, email: String, token: String? = nil) -> URLRequest? {
        var components = URLComponents(string: "https://api.github.com")
        components?.path = "/repos/\(repo.owner)/\(repo.name)/commits"
        // Encode "+" too (a+b@x.vn): left as-is GitHub reads it as a space.
        var allowed = CharacterSet.urlQueryAllowed
        allowed.remove(charactersIn: "+&=")
        guard let author = normalize(email).addingPercentEncoding(withAllowedCharacters: allowed) else { return nil }
        components?.percentEncodedQuery = "author=\(author)&per_page=1"
        guard let url = components?.url else { return nil }
        var request = URLRequest(url: url, timeoutInterval: 15)
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.setValue("2022-11-28", forHTTPHeaderField: "X-GitHub-Api-Version")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        return request
    }

    /// The `[0].author.avatar_url` of a commits-API result (author is null when the email isn't tied to any account).
    public static func parseCommitAvatar(_ data: Data, size: Int) -> URL? {
        struct Item: Decodable {
            struct Author: Decodable { let avatar_url: String? }
            let author: Author?
        }
        guard let items = try? JSONDecoder().decode([Item].self, from: data),
              let raw = items.first?.author?.avatar_url, var components = URLComponents(string: raw) else { return nil }
        components.queryItems = (components.queryItems ?? []).filter { $0.name != "s" } + [URLQueryItem(name: "s", value: String(size))]
        return components.url
    }
}

/// The result of looking up an avatar address for an email.
public enum AvatarResult: Sendable, Equatable {
    case found(Data)
    /// No source has an image.
    case missing
    /// A temporary failure (network, server, API rate limit, expired token…): retry later.
    case unavailable

    public var data: Data? {
        if case .found(let data) = self { return data }
        return nil
    }
}

/// Downloads and disk-caches avatars. Order: GitHub hidden email → the repo's GitHub API (when the repo is
/// on GitHub) → Gravatar. When nobody has an image, "none" is remembered for a few days so we don't ask
/// again; a network error remembers nothing.
public actor AvatarFetcher {
    public static let imageLifetime: TimeInterval = 7 * 24 * 3600
    public static let missingLifetime: TimeInterval = 3 * 24 * 3600

    private let cacheDirectory: URL?
    private let transport: GitHubHTTPTransport
    /// GitHub API rate limit hit (60/hour when not signed in): skip until this moment.
    private var githubBlockedUntil = Date.distantPast

    public init(cacheDirectory: URL?, session: URLSession? = nil) {
        let session = session ?? {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.timeoutIntervalForRequest = 15
            configuration.httpAdditionalHeaders = ["User-Agent": "Thaigit"]
            return URLSession(configuration: configuration)
        }()
        self.init(cacheDirectory: cacheDirectory) { request in
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
            return (data, http)
        }
    }

    /// `transport`: performs one HTTP request — tests substitute their own fake server (never the real network).
    public init(cacheDirectory: URL?, transport: @escaping GitHubHTTPTransport) {
        self.cacheDirectory = cacheDirectory
        self.transport = transport
        if let cacheDirectory { try? FileManager.default.createDirectory(at: cacheDirectory, withIntermediateDirectories: true) }
    }

    private enum Lookup {
        case found(Data)
        case missing
        /// Network / server error: try again later.
        case unavailable
    }

    /// The image bytes (PNG/JPEG) of the person with this email, or nil when there's no image / it can't be downloaded.
    public func avatar(email: String, repo: GitHubRepoRef?, size: Int, token: String? = nil) async -> Data? {
        await lookupAvatar(email: email, repo: repo, size: size, token: token).data
    }

    /// Like `avatar` but distinguishes "no avatar" from a temporary failure (so the app can retry later).
    /// "None" is only remembered when every source answered explicitly; the case where the GitHub API was
    /// never asked (no `repo`) is remembered separately so a later lookup that does have a GitHub repo still
    /// asks GitHub.
    public func lookupAvatar(email: String, repo: GitHubRepoRef?, size: Int, token: String? = nil) async -> AvatarResult {
        let key = AvatarSource.hash(email)
        if let cached = cached(key, askedGitHub: repo != nil) { return cached.isEmpty ? .missing : .found(cached) }
        var sawUnavailable = false
        for source in sources(email: email, repo: repo) {
            switch await lookup(source, size: size, token: token) {
            case .found(let data):
                store(data, key: key)
                return .found(data)
            case .missing:
                continue
            case .unavailable:
                sawUnavailable = true
            }
        }
        if sawUnavailable { return .unavailable }
        storeMissing(key: key, askedGitHub: repo != nil)
        return .missing
    }

    private enum Source {
        case image(URL)
        case githubAPI(GitHubRepoRef, String)
    }

    private func sources(email: String, repo: GitHubRepoRef?) -> [Source] {
        var result: [Source] = []
        if let noreply = AvatarSource.githubNoreply(email), let url = AvatarSource.githubAvatarURL(id: noreply.id, login: noreply.login, size: 80) {
            result.append(.image(url))
        }
        if let repo { result.append(.githubAPI(repo, email)) }
        if let url = AvatarSource.gravatarURL(email: email, size: 80) { result.append(.image(url)) }
        return result
    }

    private func lookup(_ source: Source, size: Int, token: String?) async -> Lookup {
        switch source {
        case .image(let url):
            return await download(URLRequest(url: url, timeoutInterval: 15))
        case .githubAPI(let repo, let email):
            guard Date() >= githubBlockedUntil,
                  let request = AvatarSource.githubCommitsRequest(repo: repo, email: email, token: token) else { return .unavailable }
            guard let (data, http) = try? await transport(request) else { return .unavailable }
            if http.statusCode == 403 || http.statusCode == 429 || http.value(forHTTPHeaderField: "X-RateLimit-Remaining") == "0" {
                let reset = http.value(forHTTPHeaderField: "X-RateLimit-Reset").flatMap(TimeInterval.init)
                githubBlockedUntil = reset.map { Date(timeIntervalSince1970: $0) } ?? Date().addingTimeInterval(3600)
                if http.statusCode != 200 { return .unavailable }
            }
            // 401: the token expired / was revoked — a temporary error, signing in again fixes it.
            // 404/409/422: a private repo (not signed in), an empty repo, an unknown email — treat as GitHub having no image.
            guard http.statusCode == 200 else {
                return (400..<500).contains(http.statusCode) && http.statusCode != 401 ? .missing : .unavailable
            }
            guard let url = AvatarSource.parseCommitAvatar(data, size: size) else { return .missing }
            return await download(URLRequest(url: url, timeoutInterval: 15))
        }
    }

    private func download(_ request: URLRequest) async -> Lookup {
        guard let (data, http) = try? await transport(request) else { return .unavailable }
        if http.statusCode == 404 || http.statusCode == 410 { return .missing }
        guard http.statusCode == 200, !data.isEmpty, (http.mimeType ?? "").hasPrefix("image/") else { return .unavailable }
        return .found(data)
    }

    // MARK: On-disk cache: <hash>.img is the image; <hash>.none is "no avatar" (the GitHub API was already asked);
    // <hash>.nogithub.none is "no avatar" when the GitHub API was never asked (the repo isn't on GitHub).

    private func cached(_ key: String, askedGitHub: Bool) -> Data? {
        guard let cacheDirectory else { return nil }
        let fm = FileManager.default
        func fresh(_ url: URL, lifetime: TimeInterval) -> Bool {
            guard let date = (try? fm.attributesOfItem(atPath: url.path))?[.modificationDate] as? Date else { return false }
            return Date().timeIntervalSince(date) < lifetime
        }
        let image = cacheDirectory.appendingPathComponent(key + ".img")
        if fresh(image, lifetime: Self.imageLifetime), let data = try? Data(contentsOf: image) { return data }
        if fresh(cacheDirectory.appendingPathComponent(key + ".none"), lifetime: Self.missingLifetime) { return Data() }
        if !askedGitHub, fresh(cacheDirectory.appendingPathComponent(key + ".nogithub.none"), lifetime: Self.missingLifetime) {
            return Data()
        }
        return nil
    }

    private func store(_ data: Data, key: String) {
        guard let cacheDirectory, !data.isEmpty else { return }
        try? data.write(to: cacheDirectory.appendingPathComponent(key + ".img"), options: .atomic)
        for suffix in [".none", ".nogithub.none"] {
            try? FileManager.default.removeItem(at: cacheDirectory.appendingPathComponent(key + suffix))
        }
    }

    private func storeMissing(key: String, askedGitHub: Bool) {
        guard let cacheDirectory else { return }
        try? Data().write(to: cacheDirectory.appendingPathComponent(key + (askedGitHub ? ".none" : ".nogithub.none")), options: .atomic)
    }
}
