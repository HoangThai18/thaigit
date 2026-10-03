import Foundation

/// Pull request đang mở trên GitHub (`GET /repos/{owner}/{repo}/pulls`).
public struct GitHubPullRequest: Sendable, Equatable, Identifiable {
    public let number: Int
    public let title: String
    public let body: String?
    public let isDraft: Bool
    /// Trang của PR trên github.com (nil nếu GitHub trả về địa chỉ lạ — không mở).
    public let webURL: URL?
    public let author: String
    public let headBranch: String
    public let headSHA: String
    /// "owner/repo" chứa nhánh của PR; nil khi repo fork đã bị xoá.
    public let headRepository: String?
    public let baseBranch: String
    public let updatedAt: Date?

    public init(number: Int, title: String, body: String? = nil, isDraft: Bool = false, webURL: URL? = nil, author: String,
                headBranch: String, headSHA: String, headRepository: String?, baseBranch: String, updatedAt: Date? = nil) {
        self.number = number
        self.title = title
        self.body = body
        self.isDraft = isDraft
        self.webURL = webURL
        self.author = author
        self.headBranch = headBranch
        self.headSHA = headSHA
        self.headRepository = headRepository
        self.baseBranch = baseBranch
        self.updatedAt = updatedAt
    }

    public var id: Int { number }

    /// Nhánh của PR nằm ngay trong `repo` (không phải từ fork): fetch xong là có trên remote.
    public func isSameRepository(as repo: GitHubRepoRef) -> Bool {
        headRepository?.caseInsensitiveCompare("\(repo.owner)/\(repo.name)") == .orderedSame
    }
}

/// Issue đang mở trên GitHub.
public struct GitHubIssue: Sendable, Equatable, Identifiable {
    public let number: Int
    public let title: String
    public let author: String
    public let labels: [String]
    public let webURL: URL?
    public var id: Int { number }

    public init(number: Int, title: String, author: String, labels: [String] = [], webURL: URL? = nil) {
        self.number = number
        self.title = title
        self.author = author
        self.labels = labels
        self.webURL = webURL
    }
}

/// Nội dung một Pull Request mới (`POST /repos/{owner}/{repo}/pulls`).
public struct NewPullRequest: Sendable, Equatable {
    public var title: String
    public var body: String
    /// Nhánh chứa thay đổi (tên nhánh trên GitHub, không có tiền tố remote).
    public var head: String
    /// Nhánh sẽ nhận thay đổi.
    public var base: String
    public var draft: Bool

    public init(title: String, body: String, head: String, base: String, draft: Bool) {
        self.title = title
        self.body = body
        self.head = head
        self.base = base
        self.draft = draft
    }
}

/// Lỗi riêng của API repo (ngoài các lỗi chung trong `GitHubError`).
public enum GitHubRepoAPIError: LocalizedError, Equatable, Sendable {
    /// Tên owner / repo có ký tự lạ — không gọi API.
    case invalidRepository
    /// 404: repo không tồn tại hoặc là repo riêng tư mà token (nếu có) không có quyền.
    case notFound
    /// 403 do hết lượt gọi API (GitHub cho 60 lượt/giờ khi chưa đăng nhập).
    case rateLimited
    /// 422: GitHub từ chối nội dung gửi lên (PR đã có, hai nhánh không khác nhau…).
    case rejected(String)

    public var errorDescription: String? {
        switch self {
        case .invalidRepository: return "Tên repo trên GitHub không hợp lệ."
        case .notFound: return "Không thấy repo trên GitHub — repo riêng tư cần đăng nhập tài khoản có quyền."
        case .rateLimited: return "GitHub tạm chặn vì gọi quá nhiều lần — đăng nhập GitHub hoặc thử lại sau ít phút."
        case .rejected(let message): return message
        }
    }
}

/// Gọi REST API của GitHub cho một repo: danh sách / tạo Pull Request, nhánh mặc định.
/// Mọi request chỉ đi tới https://api.github.com; token (nếu có) chỉ nằm trong header Authorization.
public struct GitHubRepoAPI: Sendable {
    /// Tối đa 3 trang × 100 PR đang mở.
    public static let maxPages = 3
    private let transport: GitHubHTTPTransport

    public init(transport: @escaping GitHubHTTPTransport = GitHubAuth.urlSessionTransport()) {
        self.transport = transport
    }

    /// PR đang mở, mới cập nhật trước. Repo công khai đọc được cả khi chưa đăng nhập (`token` nil).
    public func openPullRequests(in repo: GitHubRepoRef, token: String?) async throws -> [GitHubPullRequest] {
        guard var next = Self.url(repo, "/pulls", query: [
            URLQueryItem(name: "state", value: "open"),
            URLQueryItem(name: "sort", value: "updated"),
            URLQueryItem(name: "direction", value: "desc"),
            URLQueryItem(name: "per_page", value: "100"),
        ]) else { throw GitHubRepoAPIError.invalidRepository }
        var result: [GitHubPullRequest] = []
        var seen = Set<Int>()
        for _ in 0..<Self.maxPages {
            let (data, response) = try await send(Self.request(next, token: token))
            try Self.check(response, data: data)
            guard let page = try? JSONDecoder().decode([PullPayload].self, from: data) else { throw GitHubError.invalidResponse }
            result += page.map(\.pullRequest).filter { seen.insert($0.number).inserted }
            guard let url = GitHubAuth.nextPageURL(linkHeader: response.value(forHTTPHeaderField: "Link")).flatMap(GitHubAuth.trustedAPIURL)
            else { break }
            next = url
        }
        return result
    }

    /// Tạo PR; trả về PR vừa tạo (có số và đường dẫn).
    public func createPullRequest(_ new: NewPullRequest, in repo: GitHubRepoRef, token: String) async throws -> GitHubPullRequest {
        guard let url = Self.url(repo, "/pulls") else { throw GitHubRepoAPIError.invalidRepository }
        var request = Self.request(url, token: token)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        struct Body: Encodable { let title, body, head, base: String; let draft: Bool }
        request.httpBody = try JSONEncoder().encode(Body(title: new.title, body: new.body, head: new.head, base: new.base, draft: new.draft))
        let (data, response) = try await send(request)
        try Self.check(response, data: data)
        guard let payload = try? JSONDecoder().decode(PullPayload.self, from: data) else { throw GitHubError.invalidResponse }
        return payload.pullRequest
    }

    /// Issue đang mở (bỏ các mục là Pull Request — API issues của GitHub trả cả PR), mới cập nhật trước.
    public func openIssues(in repo: GitHubRepoRef, token: String?, limit: Int = 100) async throws -> [GitHubIssue] {
        guard let url = Self.url(repo, "/issues", query: [
            URLQueryItem(name: "state", value: "open"),
            URLQueryItem(name: "sort", value: "updated"),
            URLQueryItem(name: "per_page", value: String(min(max(limit, 1), 100))),
        ]) else { throw GitHubRepoAPIError.invalidRepository }
        let (data, response) = try await send(Self.request(url, token: token))
        try Self.check(response, data: data)
        struct Item: Decodable {
            struct User: Decodable { let login: String }
            struct Label: Decodable { let name: String }
            let number: Int
            let title: String
            let html_url: String?
            let user: User?
            let labels: [Label]?
            let pull_request: [String: String?]?
        }
        guard let items = try? JSONDecoder().decode([Item].self, from: data) else { throw GitHubError.invalidResponse }
        return items.filter { $0.pull_request == nil }.map { item in
            GitHubIssue(number: item.number, title: item.title, author: item.user?.login ?? "?",
                        labels: (item.labels ?? []).map(\.name), webURL: item.html_url.flatMap(Self.trustedWebURL))
        }
    }

    /// Nhánh mặc định của repo trên GitHub (nhánh đích gợi ý khi tạo PR).
    public func defaultBranch(of repo: GitHubRepoRef, token: String?) async throws -> String {
        guard let url = Self.url(repo, "") else { throw GitHubRepoAPIError.invalidRepository }
        let (data, response) = try await send(Self.request(url, token: token))
        try Self.check(response, data: data)
        struct Info: Decodable { let default_branch: String }
        guard let info = try? JSONDecoder().decode(Info.self, from: data) else { throw GitHubError.invalidResponse }
        return info.default_branch
    }

    // MARK: - Nội bộ

    /// `https://api.github.com/repos/{owner}/{repo}{suffix}` — nil nếu owner / repo có ký tự ngoài bộ GitHub cho phép
    /// (không để tên lạ chen thêm đoạn đường dẫn hay query).
    static func url(_ repo: GitHubRepoRef, _ suffix: String, query: [URLQueryItem] = []) -> URL? {
        guard isValidName(repo.owner, allowDot: false), isValidName(repo.name, allowDot: true) else { return nil }
        var components = URLComponents()
        components.scheme = "https"
        components.host = "api.github.com"
        components.path = "/repos/\(repo.owner)/\(repo.name)\(suffix)"
        if !query.isEmpty { components.queryItems = query }
        return components.url
    }

    static func isValidName(_ name: String, allowDot: Bool) -> Bool {
        guard !name.isEmpty, name.count <= 100, name != ".", name != ".." else { return false }
        return name.unicodeScalars.allSatisfy { scalar in
            ("a"..."z").contains(scalar) || ("A"..."Z").contains(scalar) || ("0"..."9").contains(scalar)
                || scalar == "-" || scalar == "_" || (allowDot && scalar == ".")
        }
    }

    static func request(_ url: URL, token: String?) -> URLRequest {
        var request = URLRequest(url: url, timeoutInterval: 20)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.setValue("2022-11-28", forHTTPHeaderField: "X-GitHub-Api-Version")
        request.setValue(GitHubAuth.userAgent, forHTTPHeaderField: "User-Agent")
        if let token, GitHubAuth.trustedAPIURL(url) != nil {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        return request
    }

    static func check(_ response: HTTPURLResponse, data: Data) throws {
        switch response.statusCode {
        case 200..<300: return
        case 401: throw GitHubError.unauthorized
        case 404: throw GitHubRepoAPIError.notFound
        case 403, 429:
            if response.value(forHTTPHeaderField: "x-ratelimit-remaining") == "0" || response.statusCode == 429 {
                throw GitHubRepoAPIError.rateLimited
            }
            throw GitHubRepoAPIError.notFound
        case 422: throw GitHubRepoAPIError.rejected(rejectionMessage(data))
        default: throw GitHubError.badResponse(response.statusCode)
        }
    }

    /// Lời giải thích cho lỗi 422, dịch các trường hợp hay gặp sang tiếng Việt.
    static func rejectionMessage(_ data: Data) -> String {
        struct Payload: Decodable {
            struct Item: Decodable { let message: String? }
            let message: String?
            let errors: [Item]?
        }
        let payload = try? JSONDecoder().decode(Payload.self, from: data)
        let details = (payload?.errors ?? []).compactMap(\.message)
        let text = (details.isEmpty ? [payload?.message ?? ""] : details).joined(separator: " ")
        let lower = text.lowercased()
        if lower.contains("a pull request already exists") {
            return "Nhánh này đã có một Pull Request đang mở."
        }
        if lower.contains("no commits between") {
            return "Không có commit nào khác giữa hai nhánh — chưa có gì để tạo Pull Request."
        }
        if lower.contains("head") && lower.contains("invalid") {
            return "GitHub chưa thấy nhánh này — hãy push nhánh lên trước."
        }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "GitHub từ chối yêu cầu." : "GitHub từ chối: \(trimmed)"
    }

    private func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        do {
            return try await transport(request)
        } catch let error as GitHubError {
            throw error
        } catch {
            if Task.isCancelled || error is CancellationError { throw CancellationError() }
            throw GitHubError.network(error.localizedDescription)
        }
    }

    private struct PullPayload: Decodable {
        struct User: Decodable { let login: String }
        struct Repo: Decodable { let full_name: String }
        struct Branch: Decodable {
            let ref: String
            let sha: String
            let repo: Repo?
        }

        let number: Int
        let title: String
        let body: String?
        let draft: Bool?
        let html_url: String?
        let user: User?
        let head: Branch
        let base: Branch
        let updated_at: String?

        var pullRequest: GitHubPullRequest {
            GitHubPullRequest(
                number: number, title: title, body: body, isDraft: draft ?? false,
                webURL: html_url.flatMap(GitHubRepoAPI.trustedWebURL),
                author: user?.login ?? "?",
                headBranch: head.ref, headSHA: head.sha, headRepository: head.repo?.full_name,
                baseBranch: base.ref, updatedAt: updated_at.flatMap(GitHubRepository.parseDate))
        }
    }

    /// Chỉ mở trang trên https://github.com.
    static func trustedWebURL(_ text: String) -> URL? {
        guard let url = URL(string: text), url.scheme == "https", url.host?.lowercased() == "github.com" else { return nil }
        return url
    }
}
