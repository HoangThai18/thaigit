import CryptoKit
import Foundation

/// Repository trên github.com, tách từ URL remote (https://, ssh://, git@github.com:…).
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
            // Dạng scp: git@github.com:owner/repo.git
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

/// Địa chỉ ảnh đại diện theo email người commit.
public enum AvatarSource {
    public static func normalize(_ email: String) -> String {
        email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    /// SHA-256 của email đã chuẩn hoá (dạng hex): tên file cache, và mã Gravatar dùng.
    public static func hash(_ email: String) -> String {
        SHA256.hash(data: Data(normalize(email).utf8)).map { String(format: "%02x", $0) }.joined()
    }

    /// Email ẩn của GitHub: "12345+ten@users.noreply.github.com" → (12345, "ten"); "ten@users.noreply.github.com" → (nil, "ten").
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

    /// `d=404`: không có ảnh thì Gravatar trả 404 (không trả ảnh mặc định) để app vẽ chữ viết tắt.
    public static func gravatarURL(email: String, size: Int) -> URL? {
        URL(string: "https://gravatar.com/avatar/\(hash(email))?s=\(size)&d=404")
    }

    /// API GitHub: commit mới nhất của tác giả trong repo — tài khoản GitHub gắn với email đó kèm `avatar_url`.
    public static func githubCommitsRequest(repo: GitHubRepoRef, email: String, token: String? = nil) -> URLRequest? {
        var components = URLComponents(string: "https://api.github.com")
        components?.path = "/repos/\(repo.owner)/\(repo.name)/commits"
        // Mã hoá cả "+" (a+b@x.vn): để nguyên thì GitHub hiểu là dấu cách.
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

    /// `[0].author.avatar_url` của kết quả API commit (author là null khi email không gắn với tài khoản nào).
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

/// Tải và cache ảnh đại diện trên đĩa. Thứ tự: email ẩn GitHub → API GitHub của repo (nếu repo nằm trên GitHub) →
/// Gravatar. Không ai có ảnh thì nhớ "không có" vài ngày để khỏi hỏi lại; lỗi mạng thì không nhớ gì.
public actor AvatarFetcher {
    public static let imageLifetime: TimeInterval = 7 * 24 * 3600
    public static let missingLifetime: TimeInterval = 3 * 24 * 3600

    private let cacheDirectory: URL?
    private let session: URLSession
    /// API GitHub hết lượt (60 lần/giờ khi không đăng nhập): bỏ qua tới thời điểm này.
    private var githubBlockedUntil = Date.distantPast

    public init(cacheDirectory: URL?, session: URLSession? = nil) {
        self.cacheDirectory = cacheDirectory
        if let session {
            self.session = session
        } else {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.timeoutIntervalForRequest = 15
            configuration.httpAdditionalHeaders = ["User-Agent": "Thaigit"]
            self.session = URLSession(configuration: configuration)
        }
        if let cacheDirectory { try? FileManager.default.createDirectory(at: cacheDirectory, withIntermediateDirectories: true) }
    }

    private enum Lookup {
        case found(Data)
        case missing
        /// Lỗi mạng / máy chủ: lần sau thử lại.
        case unavailable
    }

    /// Byte ảnh (PNG/JPEG) của người có email này, hoặc nil nếu không có ảnh / không tải được.
    public func avatar(email: String, repo: GitHubRepoRef?, size: Int, token: String? = nil) async -> Data? {
        let key = AvatarSource.hash(email)
        if let cached = cached(key) { return cached.isEmpty ? nil : cached }
        var sawUnavailable = false
        for source in sources(email: email, repo: repo) {
            switch await lookup(source, size: size, token: token) {
            case .found(let data):
                store(data, key: key)
                return data
            case .missing:
                continue
            case .unavailable:
                sawUnavailable = true
            }
        }
        if !sawUnavailable { store(Data(), key: key) }
        return nil
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
            guard let (data, response) = try? await session.data(for: request), let http = response as? HTTPURLResponse else {
                return .unavailable
            }
            if http.statusCode == 403 || http.statusCode == 429 || http.value(forHTTPHeaderField: "X-RateLimit-Remaining") == "0" {
                let reset = http.value(forHTTPHeaderField: "X-RateLimit-Reset").flatMap(TimeInterval.init)
                githubBlockedUntil = reset.map { Date(timeIntervalSince1970: $0) } ?? Date().addingTimeInterval(3600)
                if http.statusCode != 200 { return .unavailable }
            }
            // 404/409/422: repo riêng tư (chưa đăng nhập), repo rỗng, email lạ — coi như GitHub không có ảnh.
            guard http.statusCode == 200 else { return (400..<500).contains(http.statusCode) ? .missing : .unavailable }
            guard let url = AvatarSource.parseCommitAvatar(data, size: size) else { return .missing }
            return await download(URLRequest(url: url, timeoutInterval: 15))
        }
    }

    private func download(_ request: URLRequest) async -> Lookup {
        guard let (data, response) = try? await session.data(for: request), let http = response as? HTTPURLResponse else {
            return .unavailable
        }
        if http.statusCode == 404 || http.statusCode == 410 { return .missing }
        guard http.statusCode == 200, !data.isEmpty, (http.mimeType ?? "").hasPrefix("image/") else { return .unavailable }
        return .found(data)
    }

    // MARK: Cache trên đĩa: <hash>.img là ảnh, <hash>.none là "không có ảnh".

    private func cached(_ key: String) -> Data? {
        guard let cacheDirectory else { return nil }
        let fm = FileManager.default
        func fresh(_ url: URL, lifetime: TimeInterval) -> Bool {
            guard let date = (try? fm.attributesOfItem(atPath: url.path))?[.modificationDate] as? Date else { return false }
            return Date().timeIntervalSince(date) < lifetime
        }
        let image = cacheDirectory.appendingPathComponent(key + ".img")
        if fresh(image, lifetime: Self.imageLifetime), let data = try? Data(contentsOf: image) { return data }
        if fresh(cacheDirectory.appendingPathComponent(key + ".none"), lifetime: Self.missingLifetime) { return Data() }
        return nil
    }

    private func store(_ data: Data, key: String) {
        guard let cacheDirectory else { return }
        let image = cacheDirectory.appendingPathComponent(key + ".img")
        let none = cacheDirectory.appendingPathComponent(key + ".none")
        if data.isEmpty {
            try? Data().write(to: none, options: .atomic)
        } else {
            try? data.write(to: image, options: .atomic)
            try? FileManager.default.removeItem(at: none)
        }
    }
}
