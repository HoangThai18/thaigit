import Foundation

/// An open pull request on GitHub (`GET /repos/{owner}/{repo}/pulls`).
public struct GitHubPullRequest: Sendable, Equatable, Identifiable {
    public let number: Int
    public let title: String
    public let body: String?
    public let isDraft: Bool
    /// The PR's page on github.com (nil when GitHub returns an unexpected address — don't open it).
    public let webURL: URL?
    public let author: String
    public let headBranch: String
    public let headSHA: String
    /// "owner/repo" holding the PR's branch; nil when the fork repo was deleted.
    public let headRepository: String?
    public let baseBranch: String
    public let updatedAt: Date?
    /// Logins of the PR's assignees (`assignees`).
    public let assignees: [String]
    /// Logins of the requested reviewers (`requested_reviewers`).
    public let reviewers: [String]

    public init(number: Int, title: String, body: String? = nil, isDraft: Bool = false, webURL: URL? = nil, author: String,
                headBranch: String, headSHA: String, headRepository: String?, baseBranch: String, updatedAt: Date? = nil,
                assignees: [String] = [], reviewers: [String] = []) {
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
        self.assignees = assignees
        self.reviewers = reviewers
    }

    public var id: Int { number }

    /// The PR's branch lives directly in `repo` (not from a fork): after fetching it's on the remote.
    public func isSameRepository(as repo: GitHubRepoRef) -> Bool {
        headRepository?.caseInsensitiveCompare("\(repo.owner)/\(repo.name)") == .orderedSame
    }
}

/// An open issue on GitHub.
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

/// The body of a new Pull Request (`POST /repos/{owner}/{repo}/pulls`).
public struct NewPullRequest: Sendable, Equatable {
    public var title: String
    public var body: String
    /// The branch holding the changes (the branch name on GitHub, no remote prefix).
    public var head: String
    /// The branch that will receive the changes.
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

/// A repo-API-specific failure (outside the shared cases in `GitHubError`).
public enum GitHubRepoAPIError: LocalizedError, Equatable, Sendable {
    /// The owner / repo name has unusual characters — don't call the API.
    case invalidRepository
    /// 404: the repo doesn't exist, or it's private and the token (if any) has no access.
    case notFound
    /// 403 from an exhausted API rate limit (GitHub allows 60/hour when not signed in).
    case rateLimited
    /// 422: GitHub rejected the submitted content (a PR already exists, the branches are identical…).
    case rejected(String)

    public var errorDescription: String? {
        switch self {
        case .invalidRepository: return String(localized: "Tên repo trên GitHub không hợp lệ.")
        case .notFound: return String(localized: "Không thấy repo trên GitHub — repo riêng tư cần đăng nhập tài khoản có quyền.")
        case .rateLimited: return String(localized: "GitHub tạm chặn vì gọi quá nhiều lần — đăng nhập GitHub hoặc thử lại sau ít phút.")
        case .rejected(let message): return message
        }
    }
}

/// Calls GitHub's REST API for one repo: list / create Pull Requests, the default branch.
/// Every request goes only to https://api.github.com; the token (when present) only ever rides in the Authorization header.
public struct GitHubRepoAPI: Sendable {
    /// At most 3 pages × 100 open PRs.
    public static let maxPages = 3
    private let transport: GitHubHTTPTransport

    public init(transport: @escaping GitHubHTTPTransport = GitHubAuth.urlSessionTransport()) {
        self.transport = transport
    }

    /// Open PRs, most recently updated first. A public repo is readable without signing in (`token` nil).
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

    /// Create a PR; returns the newly created PR (with its number and path).
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

    /// Open issues (Pull Request entries excluded — GitHub's issues API returns them too), most recently updated first.
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

    /// The repo's default branch on GitHub (suggested as the PR target).
    public func defaultBranch(of repo: GitHubRepoRef, token: String?) async throws -> String {
        guard let url = Self.url(repo, "") else { throw GitHubRepoAPIError.invalidRepository }
        let (data, response) = try await send(Self.request(url, token: token))
        try Self.check(response, data: data)
        struct Info: Decodable { let default_branch: String }
        guard let info = try? JSONDecoder().decode(Info.self, from: data) else { throw GitHubError.invalidResponse }
        return info.default_branch
    }

    /// The people assignable to the repo's PRs / issues (`GET /repos/{owner}/{repo}/assignees`), at most 3 pages × 100.
    public func assignableUsers(in repo: GitHubRepoRef, token: String) async throws -> [ForgePerson] {
        guard var next = Self.url(repo, "/assignees", query: [URLQueryItem(name: "per_page", value: "100")])
        else { throw GitHubRepoAPIError.invalidRepository }
        struct User: Decodable { let login: String }
        var result: [ForgePerson] = []
        var seen = Set<String>()
        for _ in 0..<Self.maxPages {
            let (data, response) = try await send(Self.request(next, token: token))
            try Self.check(response, data: data)
            guard let page = try? JSONDecoder().decode([User].self, from: data) else { throw GitHubError.invalidResponse }
            for user in page {
                if seen.insert(user.login.lowercased()).inserted { result.append(ForgePerson(username: user.login)) }
            }
            guard let url = GitHubAuth.nextPageURL(linkHeader: response.value(forHTTPHeaderField: "Link")).flatMap(GitHubAuth.trustedAPIURL)
            else { break }
            next = url
        }
        return result
    }

    /// Replace the PR's assignees (`PATCH /repos/{owner}/{repo}/issues/{number}`): the whole new list is sent, an empty list removes them all.
    public func setAssignees(_ logins: [String], number: Int, in repo: GitHubRepoRef, token: String) async throws {
        guard let url = Self.url(repo, "/issues/\(number)") else { throw GitHubRepoAPIError.invalidRepository }
        var request = Self.request(url, token: token)
        request.httpMethod = "PATCH"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["assignees": logins])
        let (data, response) = try await send(request)
        try Self.checkAssignment(response, data: data)
        // GitHub returns 200 but silently drops an assignee when the account can't push (or that person can't
        // be assigned): compare against the `assignees` in the response so "updated" isn't reported when nothing changed.
        struct Echo: Decodable {
            struct User: Decodable { let login: String }
            let assignees: [User]?
        }
        if let echoed = (try? JSONDecoder().decode(Echo.self, from: data))?.assignees {
            let applied = Set(echoed.map { $0.login.lowercased() })
            if !Set(logins.map { $0.lowercased() }).isSubset(of: applied) { throw ForgeReviewError.rejected }
        }
    }

    /// Request more reviewers (`POST …/pulls/{number}/requested_reviewers`) and drop the ones no longer needed (`DELETE` on the same path).
    /// Removals go first, additions after; one call per group (an empty group isn't called).
    public func updateReviewers(add: [String], remove: [String], number: Int, in repo: GitHubRepoRef, token: String) async throws {
        guard let url = Self.url(repo, "/pulls/\(number)/requested_reviewers") else { throw GitHubRepoAPIError.invalidRepository }
        if !remove.isEmpty { try await sendReviewers(remove, method: "DELETE", to: url, token: token) }
        if !add.isEmpty { try await sendReviewers(add, method: "POST", to: url, token: token) }
    }

    private func sendReviewers(_ logins: [String], method: String, to url: URL, token: String) async throws {
        var request = Self.request(url, token: token)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["reviewers": logins])
        let (data, response) = try await send(request)
        try Self.checkAssignment(response, data: data)
    }

    // MARK: - Internal

    /// `https://api.github.com/repos/{owner}/{repo}{suffix}` — nil when owner / repo contains characters GitHub doesn't
    /// allow (so an odd name can't inject extra path segments or a query).
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

    /// Inspect an assign-people response: 403 / 404 mean a permission problem, 422 gets the reason guessed from GitHub's wording.
    static func checkAssignment(_ response: HTTPURLResponse, data: Data) throws {
        switch response.statusCode {
        case 200..<300: return
        case 403 where response.value(forHTTPHeaderField: "x-ratelimit-remaining") == "0": throw GitHubRepoAPIError.rateLimited
        case 429: throw GitHubRepoAPIError.rateLimited
        case 403, 404: throw ForgeReviewError.noPermission
        case 422:
            let text = String(decoding: data, as: UTF8.self).lowercased()
            if text.contains("pull request author") { throw ForgeReviewError.authorCannotReview }
            if text.contains("collaborator") { throw ForgeReviewError.notCollaborator }
            throw ForgeReviewError.rejected
        default:
            try check(response, data: data)
        }
    }

    /// An explanation for a 422, translating the common cases into the active language.
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
            return String(localized: "Nhánh này đã có một Pull Request đang mở.")
        }
        if lower.contains("no commits between") {
            return String(localized: "Không có commit nào khác giữa hai nhánh — chưa có gì để tạo Pull Request.")
        }
        if lower.contains("head") && lower.contains("invalid") {
            return String(localized: "GitHub chưa thấy nhánh này — hãy push nhánh lên trước.")
        }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? String(localized: "GitHub từ chối yêu cầu.") : String(localized: "GitHub từ chối: \(trimmed)")
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
        let assignees: [User]?
        let requested_reviewers: [User]?

        var pullRequest: GitHubPullRequest {
            GitHubPullRequest(
                number: number, title: title, body: body, isDraft: draft ?? false,
                webURL: html_url.flatMap(GitHubRepoAPI.trustedWebURL),
                author: user?.login ?? "?",
                headBranch: head.ref, headSHA: head.sha, headRepository: head.repo?.full_name,
                baseBranch: base.ref, updatedAt: updated_at.flatMap(GitHubRepository.parseDate),
                assignees: (assignees ?? []).map(\.login), reviewers: (requested_reviewers ?? []).map(\.login))
        }
    }

    /// Only opens pages on https://github.com.
    static func trustedWebURL(_ text: String) -> URL? {
        guard let url = URL(string: text), url.scheme == "https", url.host?.lowercased() == "github.com" else { return nil }
        return url
    }
}
