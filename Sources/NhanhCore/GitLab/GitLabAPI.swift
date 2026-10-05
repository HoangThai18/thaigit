import Foundation

/// A failure while talking to GitLab. The message is written for the user — it never contains a token or the raw response body.
public enum GitLabError: LocalizedError, Sendable, Equatable {
    case notConfigured
    case invalidHost
    case expired
    case accessDenied
    case unauthorized
    case network
    case badResponse(Int)
    case invalidResponse
    case keychain(Int32)
    /// 404: the project doesn't exist or the account can't see it.
    case projectNotFound
    /// 403: the account / token may not create Merge Requests in this project.
    case forbidden
    case mergeRequestRejected(MergeRequestRejection)

    public enum MergeRequestRejection: Sendable, Equatable {
        case alreadyExists
        case sourceMissing
        case targetMissing
        case other
    }

    public var errorDescription: String? {
        switch self {
        case .notConfigured: return String(localized: "Bản này chưa có OAuth App của GitLab — hãy thêm tài khoản bằng token.")
        case .invalidHost: return String(localized: "Địa chỉ máy chủ GitLab không hợp lệ (vd. gitlab.com hoặc gitlab.cong-ty.vn).")
        case .expired: return String(localized: "Mã xác nhận đã hết hạn — hãy đăng nhập lại để lấy mã mới.")
        case .accessDenied: return String(localized: "Bạn đã từ chối cấp quyền cho Thaigit trên GitLab.")
        case .unauthorized: return String(localized: "Token GitLab không hợp lệ hoặc đã hết hạn — đăng nhập lại hoặc tạo token mới.")
        case .network: return String(localized: "Không kết nối được tới máy chủ GitLab. Kiểm tra mạng rồi thử lại.")
        case .badResponse(let status): return String(localized: "GitLab trả về lỗi \(status).")
        case .invalidResponse: return String(localized: "Phản hồi của GitLab không đúng định dạng.")
        case .keychain: return String(localized: "Không đọc / ghi được Keychain của macOS. Hãy mở khoá Keychain rồi thử lại.")
        case .projectNotFound: return String(localized: "Không thấy project trên GitLab — project riêng tư cần đăng nhập tài khoản có quyền.")
        case .forbidden: return String(localized: "Tài khoản GitLab này không có quyền tạo Merge Request ở project này (token cần quyền api).")
        case .mergeRequestRejected(.alreadyExists): return String(localized: "Nhánh này đã có Merge Request đang mở.")
        case .mergeRequestRejected(.sourceMissing): return String(localized: "Nhánh nguồn chưa có trên GitLab — hãy push lên trước.")
        case .mergeRequestRejected(.targetMissing): return String(localized: "Nhánh đích không có trên GitLab.")
        case .mergeRequestRejected(.other): return String(localized: "GitLab không nhận Merge Request này — hai nhánh có khác nhau và đã push chưa?")
        }
    }
}

/// A GitLab user (`GET /api/v4/user`).
public struct GitLabUser: Codable, Sendable, Equatable {
    public let id: Int
    public let username: String
    public let name: String?
    public let avatarURL: String?

    enum CodingKeys: String, CodingKey {
        case id, username, name
        case avatarURL = "avatar_url"
    }

    public init(id: Int, username: String, name: String?, avatarURL: String?) {
        self.id = id
        self.username = username
        self.name = name
        self.avatarURL = avatarURL
    }
}

/// A GitLab token: an OAuth token (~2 hour lifetime, renewed with the refresh token) or a personal access token the user pasted.
public struct GitLabToken: Codable, Sendable, Equatable, CustomStringConvertible {
    public let accessToken: String
    public let refreshToken: String?
    public let expiresAt: Date?

    public init(accessToken: String, refreshToken: String?, expiresAt: Date?) {
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.expiresAt = expiresAt
    }

    /// OAuth token (with a refresh token) — git uses the username "oauth2".
    public var isOAuth: Bool { refreshToken != nil }

    /// Renew when it's about to expire (under 2 minutes left) and before use.
    public func needsRefresh(now: Date = Date()) -> Bool {
        guard let expiresAt, refreshToken != nil else { return false }
        return expiresAt.timeIntervalSince(now) < 120
    }

    public var description: String { "GitLabToken(<ẩn>)" }
}

/// The sign-in code of the device flow.
public struct GitLabDeviceCode: Sendable, Equatable {
    public let deviceCode: String
    public let userCode: String
    public let verificationURL: URL
    public let expiresIn: Int
    public let interval: Int
}

/// The GitLab API (gitlab.com or self-hosted): OAuth device flow (public client, no client secret), token renewal, the
/// current user, adding SSH keys. Every request goes only to that account's own `https://<host>`.
public struct GitLabAPI: Sendable {
    public typealias Transport = @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)

    public static let scopes = "api read_user read_repository write_repository"
    static let userAgent = "Thaigit"

    let transport: Transport
    let sleep: @Sendable (Duration) async throws -> Void

    public init(transport: Transport? = nil, sleep: (@Sendable (Duration) async throws -> Void)? = nil) {
        self.transport = transport ?? { request in
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw GitLabError.invalidResponse }
            return (data, http)
        }
        self.sleep = sleep ?? { try await Task.sleep(for: $0) }
    }

    /// "gitlab.com", "https://gitlab.cong-ty.vn/" → the lowercased host; nil when invalid.
    public static func normalizedHost(_ text: String) -> String? {
        var value = text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if let scheme = value.range(of: "://") { value = String(value[scheme.upperBound...]) }
        value = String(value.prefix { $0 != "/" })
        guard !value.isEmpty, value.count < 256, !value.contains("@"),
              value.allSatisfy({ $0.isLetter || $0.isNumber || "-.:".contains($0) }),
              value.contains(".") || value.hasPrefix("localhost")
        else { return nil }
        return value
    }

    // MARK: - Device flow

    public func requestDeviceCode(host: String, clientID: String) async throws -> GitLabDeviceCode {
        let (data, response) = try await send(Self.formRequest(host: host, path: "/oauth/authorize_device", [
            ("client_id", clientID), ("scope", Self.scopes),
        ]))
        if [400, 401, 404].contains(response.statusCode) { throw GitLabError.notConfigured }
        guard (200..<300).contains(response.statusCode) else { throw GitLabError.badResponse(response.statusCode) }
        guard let body = try? JSONDecoder().decode(OAuthResponse.self, from: data),
              let deviceCode = body.deviceCode, let userCode = body.userCode, !deviceCode.isEmpty, !userCode.isEmpty
        else { throw GitLabError.invalidResponse }
        return GitLabDeviceCode(
            deviceCode: deviceCode,
            userCode: userCode,
            verificationURL: Self.sameHostPage(body.verificationURIComplete ?? body.verificationURI, host: host),
            expiresIn: max(1, body.expiresIn ?? 300),
            interval: max(1, body.interval ?? 5)
        )
    }

    /// Poll for the token every `interval` until the user confirms.
    public func pollForToken(host: String, clientID: String, code: GitLabDeviceCode, now: @Sendable () -> Date = Date.init) async throws -> GitLabToken {
        var interval = code.interval
        var waited = 0
        while true {
            guard waited + interval <= code.expiresIn else { throw GitLabError.expired }
            try await sleep(.seconds(interval))
            waited += interval
            try Task.checkCancellation()
            let (data, response) = try await send(Self.formRequest(host: host, path: "/oauth/token", [
                ("client_id", clientID), ("device_code", code.deviceCode),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ]))
            let body = try? JSONDecoder().decode(OAuthResponse.self, from: data)
            if let token = body?.token(now: now()) { return token }
            switch body?.error {
            case "authorization_pending"?: continue
            case "slow_down"?: interval += 5
            case "expired_token"?: throw GitLabError.expired
            case "access_denied"?: throw GitLabError.accessDenied
            case "invalid_client"?, "unauthorized_client"?: throw GitLabError.notConfigured
            default:
                if response.statusCode >= 500 { continue }
                throw GitLabError.badResponse(response.statusCode)
            }
        }
    }

    /// Renew an OAuth token (public client: only the client ID is needed). The old refresh token is invalidated by this call.
    public func refresh(host: String, clientID: String, token: GitLabToken, now: Date = Date()) async throws -> GitLabToken {
        guard let refreshToken = token.refreshToken else { return token }
        let (data, response) = try await send(Self.formRequest(host: host, path: "/oauth/token", [
            ("client_id", clientID), ("refresh_token", refreshToken), ("grant_type", "refresh_token"),
        ]))
        if [400, 401].contains(response.statusCode) { throw GitLabError.unauthorized }
        guard (200..<300).contains(response.statusCode) else { throw GitLabError.badResponse(response.statusCode) }
        guard let fresh = (try? JSONDecoder().decode(OAuthResponse.self, from: data))?.token(now: now) else {
            throw GitLabError.invalidResponse
        }
        return fresh
    }

    // MARK: - REST API

    public func fetchUser(host: String, token: String) async throws -> GitLabUser {
        let (data, response) = try await send(Self.apiRequest(host: host, path: "/api/v4/user", token: token))
        try Self.check(response)
        guard let user = try? JSONDecoder().decode(GitLabUser.self, from: data) else { throw GitLabError.invalidResponse }
        return user
    }

    /// Create a Merge Request; returns the newly created MR (with its number and path). The token only ever goes to `https://<the project's host>`.
    public func createMergeRequest(_ new: NewMergeRequest, in project: GitLabProjectRef, token: String) async throws -> GitLabMergeRequest {
        var request = Self.apiRequest(host: project.host, path: "/api/v4/projects/\(project.encodedPath)/merge_requests", token: token)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: [
            "source_branch": new.sourceBranch, "target_branch": new.targetBranch,
            "title": new.submittedTitle, "description": new.description,
        ])
        let (data, response) = try await send(request)
        switch response.statusCode {
        case 200..<300:
            struct Payload: Decodable { let iid: Int; let title: String; let web_url: String? }
            guard let payload = try? JSONDecoder().decode(Payload.self, from: data) else { throw GitLabError.invalidResponse }
            return GitLabMergeRequest(iid: payload.iid, title: payload.title,
                                      webURL: Self.trustedWebURL(payload.web_url, host: project.host))
        case 400, 409, 422:
            throw GitLabError.mergeRequestRejected(Self.rejection(from: data))
        case 403: throw GitLabError.forbidden
        case 404: throw GitLabError.projectNotFound
        default:
            try Self.check(response)
            throw GitLabError.badResponse(response.statusCode)
        }
    }

    /// The project's default branch (suggested as the MR target).
    public func defaultBranch(of project: GitLabProjectRef, token: String?) async throws -> String {
        var request = Self.apiRequest(host: project.host, path: "/api/v4/projects/\(project.encodedPath)", token: token ?? "")
        if token == nil { request.setValue(nil, forHTTPHeaderField: "Authorization") }
        let (data, response) = try await send(request)
        if response.statusCode == 404 { throw GitLabError.projectNotFound }
        try Self.check(response)
        struct Info: Decodable { let default_branch: String? }
        guard let branch = (try? JSONDecoder().decode(Info.self, from: data))?.default_branch, !branch.isEmpty else {
            throw GitLabError.invalidResponse
        }
        return branch
    }

    public enum SSHKeyUpload: Sendable, Equatable {
        case added, alreadyExists, missingScope
    }

    /// Add an SSH public key (`POST /api/v4/user/keys`, needs the `api` scope).
    public func addSSHKey(host: String, token: String, title: String, publicKey: String) async throws -> SSHKeyUpload {
        var request = Self.apiRequest(host: host, path: "/api/v4/user/keys", token: token)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["title": title, "key": publicKey])
        let (data, response) = try await send(request)
        switch response.statusCode {
        case 200..<300: return .added
        case 403: return .missingScope
        case 400:
            let text = String(decoding: data, as: UTF8.self).lowercased()
            if text.contains("taken") || text.contains("already") { return .alreadyExists }
            throw GitLabError.badResponse(400)
        default:
            try Self.check(response)
            throw GitLabError.badResponse(response.statusCode)
        }
    }

    // MARK: - Internal

    /// Why GitLab rejected the MR, guessed from the `message` field (a string or an array of strings) — never shown verbatim in the UI.
    static func rejection(from data: Data) -> GitLabError.MergeRequestRejection {
        var text = String(decoding: data, as: UTF8.self).lowercased()
        if let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let message = object["message"] {
            text = "\(message)".lowercased()
        }
        if text.contains("already exists") { return .alreadyExists }
        if text.contains("source branch") && (text.contains("does not exist") || text.contains("not exist")) { return .sourceMissing }
        if text.contains("target branch") && (text.contains("does not exist") || text.contains("not exist")) { return .targetMissing }
        return .other
    }

    /// Only accepts an https path on the project's exact host.
    static func trustedWebURL(_ text: String?, host: String) -> URL? {
        guard let text, let url = URL(string: text), url.scheme == "https",
              let urlHost = url.host?.lowercased(), urlHost == GitLabProjectRef.stripPort(host) else { return nil }
        return url
    }

    private struct OAuthResponse: Decodable {
        var deviceCode: String?
        var userCode: String?
        var verificationURI: String?
        var verificationURIComplete: String?
        var expiresIn: Int?
        var interval: Int?
        var accessToken: String?
        var refreshToken: String?
        var error: String?

        enum CodingKeys: String, CodingKey {
            case deviceCode = "device_code"
            case userCode = "user_code"
            case verificationURI = "verification_uri"
            case verificationURIComplete = "verification_uri_complete"
            case expiresIn = "expires_in"
            case interval
            case accessToken = "access_token"
            case refreshToken = "refresh_token"
            case error
        }

        func token(now: Date) -> GitLabToken? {
            guard let accessToken, !accessToken.isEmpty else { return nil }
            return GitLabToken(accessToken: accessToken, refreshToken: refreshToken,
                               expiresAt: expiresIn.map { now.addingTimeInterval(TimeInterval($0)) })
        }
    }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        do {
            return try await transport(request)
        } catch let error as GitLabError {
            throw error
        } catch {
            if Task.isCancelled || error is CancellationError { throw CancellationError() }
            throw GitLabError.network
        }
    }

    static func check(_ response: HTTPURLResponse) throws {
        switch response.statusCode {
        case 200..<300: return
        case 401: throw GitLabError.unauthorized
        default: throw GitLabError.badResponse(response.statusCode)
        }
    }

    /// Only opens the https confirmation page on that exact host.
    static func sameHostPage(_ text: String?, host: String) -> URL {
        let fallback = URL(string: "https://\(host)/oauth/device")!
        guard let text, let url = URL(string: text), url.scheme == "https", url.host?.lowercased() == host.split(separator: ":").first.map(String.init)
        else { return fallback }
        return url
    }

    static func url(host: String, path: String) -> URL {
        URL(string: "https://\(host)\(path)")!
    }

    static func formRequest(host: String, path: String, _ fields: [(String, String)]) -> URLRequest {
        var request = URLRequest(url: url(host: host, path: path))
        request.httpMethod = "POST"
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        request.httpBody = Data(GitHubAuth.formEncoded(fields).utf8)
        return request
    }

    static func apiRequest(host: String, path: String, token: String) -> URLRequest {
        var request = URLRequest(url: url(host: host, path: path))
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        return request
    }
}
