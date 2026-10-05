import Foundation

/// Gửi một request HTTP, trả về dữ liệu và phản hồi. Test thay bằng closure giả — không bao giờ gọi mạng thật.
public typealias GitHubHTTPTransport = @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)

/// Chờ giữa hai lần hỏi token (test thay bằng closure ghi lại thời gian chờ, không chờ thật).
public typealias GitHubSleep = @Sendable (Duration) async throws -> Void

/// Đăng nhập GitHub bằng OAuth Device Flow (không cần client secret, không cần trang callback) và gọi vài API cần cho app.
///
/// 1. `requestDeviceCode()` lấy mã để người dùng nhập ở github.com/login/device.
/// 2. `pollForToken(_:)` hỏi token theo `interval` tới khi người dùng xác nhận, từ chối hoặc mã hết hạn.
/// 3. `fetchUser(token:)` / `listRepositories(token:)` gọi REST API bằng token đó.
public struct GitHubAuth: Sendable {
    /// `workflow` cần để push thay đổi trong `.github/workflows`; `read:org` để biết tài khoản thuộc tổ chức nào
    /// (chọn token theo owner khi có nhiều tài khoản).
    public static let scopes = ["repo", "workflow", "read:org", "write:public_key"]
    public static let deviceCodeURL = URL(string: "https://github.com/login/device/code")!
    public static let accessTokenURL = URL(string: "https://github.com/login/oauth/access_token")!
    public static let userURL = URL(string: "https://api.github.com/user")!
    public static let sshKeysURL = URL(string: "https://api.github.com/user/keys")!
    public static let repositoriesURL =
        URL(string: "https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member")!
    public static let organizationsURL = URL(string: "https://api.github.com/user/orgs?per_page=100")!
    public static let defaultVerificationURL = URL(string: "https://github.com/login/device")!
    public static let maxRepositoryPages = 10
    /// Lỗi mạng liên tiếp tối đa khi đang chờ người dùng xác nhận (mất mạng thoáng qua không bắt nhập lại mã).
    static let maxPollingFailures = 3
    static let userAgent = "Thaigit"

    /// nil khi Info.plist chưa có Client ID: mọi thao tác ném `GitHubError.notConfigured(nil)`.
    public let clientID: String?
    private let transport: GitHubHTTPTransport
    private let sleep: GitHubSleep

    public init(
        clientID: String?,
        transport: @escaping GitHubHTTPTransport = GitHubAuth.urlSessionTransport(),
        sleep: @escaping GitHubSleep = { try await Task.sleep(for: $0) }
    ) {
        let trimmed = clientID?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        self.clientID = trimmed.isEmpty ? nil : trimmed
        self.transport = transport
        self.sleep = sleep
    }

    public var isConfigured: Bool { clientID != nil }

    /// Phiên mạng tạm (ephemeral): không cookie, không ghi cache phản hồi API ra đĩa.
    private static let session = URLSession(configuration: .ephemeral)

    public static func urlSessionTransport() -> GitHubHTTPTransport {
        { request in
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw GitHubError.invalidResponse }
            return (data, http)
        }
    }

    // MARK: - Device Flow

    public func requestDeviceCode() async throws -> GitHubDeviceCode {
        guard let clientID else { throw GitHubError.notConfigured(nil) }
        let (data, response) = try await send(Self.formRequest(Self.deviceCodeURL, [
            ("client_id", clientID),
            ("scope", Self.scopes.joined(separator: " ")),
        ]))
        let body = try? JSONDecoder().decode(OAuthResponse.self, from: data)
        let error = body?.error.map { Self.oauthError($0, description: body?.errorDescription) }
        if let error, case .notConfigured = error { throw error }
        // Client ID không tồn tại: GitHub trả 404 (kèm `{"error":"Not Found"}`).
        if response.statusCode == 404 { throw GitHubError.notConfigured(String(localized: "GitHub không nhận ra Client ID")) }
        if let error { throw error }
        guard response.statusCode == 200 else { throw GitHubError.badResponse(response.statusCode) }
        guard let body, let deviceCode = body.deviceCode, !deviceCode.isEmpty,
              let userCode = body.userCode, !userCode.isEmpty else {
            throw GitHubError.invalidResponse
        }
        return GitHubDeviceCode(
            deviceCode: deviceCode,
            userCode: userCode,
            verificationURL: Self.trustedVerificationURL(body.verificationURI),
            expiresIn: max(1, body.expiresIn ?? 900),
            interval: max(1, body.interval ?? 5)
        )
    }

    /// Hỏi token theo `interval` cho tới khi có kết quả. `slow_down` tăng khoảng chờ thêm 5 giây (RFC 8628).
    /// Huỷ Task thì ném `CancellationError`.
    public func pollForToken(_ code: GitHubDeviceCode) async throws -> String {
        guard let clientID else { throw GitHubError.notConfigured(nil) }
        var interval = max(1, code.interval)
        var waited = 0
        var failures = 0
        while true {
            // Lần hỏi kế tiếp đã quá hạn của mã: dừng thay vì hỏi tiếp vô ích.
            guard waited + interval <= code.expiresIn else { throw GitHubError.expired }
            try await sleep(.seconds(interval))
            waited += interval
            try Task.checkCancellation()

            let data: Data
            let response: HTTPURLResponse
            do {
                (data, response) = try await transport(Self.formRequest(Self.accessTokenURL, [
                    ("client_id", clientID),
                    ("device_code", code.deviceCode),
                    ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
                ]))
            } catch {
                if Task.isCancelled || error is CancellationError { throw CancellationError() }
                failures += 1
                if failures >= Self.maxPollingFailures { throw GitHubError.network(error.localizedDescription) }
                continue
            }

            let body = try? JSONDecoder().decode(OAuthResponse.self, from: data)
            if let token = body?.accessToken, !token.isEmpty { return token }
            switch body?.error {
            case "authorization_pending"?:
                failures = 0
            case "slow_down"?:
                failures = 0
                interval = max(interval + 5, body?.interval ?? 0)
            case "expired_token"?:
                throw GitHubError.expired
            case "access_denied"?:
                throw GitHubError.accessDenied
            case let error?:
                throw Self.oauthError(error, description: body?.errorDescription)
            case nil:
                // Máy chủ GitHub lỗi tạm thời: coi như lỗi mạng, hỏi lại.
                if response.statusCode >= 500 {
                    failures += 1
                    if failures >= Self.maxPollingFailures { throw GitHubError.badResponse(response.statusCode) }
                    continue
                }
                throw response.statusCode == 200 ? GitHubError.invalidResponse : GitHubError.badResponse(response.statusCode)
            }
        }
    }

    // MARK: - REST API

    public func fetchUser(token: String) async throws -> GitHubAccount {
        let (data, response) = try await send(Self.apiRequest(Self.userURL, token: token))
        try Self.checkAPIStatus(response)
        do {
            return try JSONDecoder().decode(GitHubAccount.self, from: data)
        } catch {
            throw GitHubError.invalidResponse
        }
    }

    /// Kết quả thêm khoá SSH lên tài khoản.
    public enum SSHKeyUpload: Sendable, Equatable {
        case added
        /// Khoá đã có trên GitHub (của tài khoản này hoặc tài khoản khác).
        case alreadyExists
        /// Token thiếu quyền `write:public_key` (đăng nhập trước khi Thaigit xin quyền này): cần đăng nhập lại hoặc tự dán.
        case missingScope
    }

    /// Thêm khoá SSH công khai vào tài khoản (`POST /user/keys`).
    public func addSSHKey(token: String, title: String, publicKey: String) async throws -> SSHKeyUpload {
        var request = Self.apiRequest(Self.sshKeysURL, token: token)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["title": title, "key": publicKey])
        let (data, response) = try await send(request)
        switch response.statusCode {
        case 200..<300: return .added
        case 403, 404: return .missingScope
        case 422:
            let text = String(decoding: data, as: UTF8.self).lowercased()
            if text.contains("already") { return .alreadyExists }
            throw GitHubError.badResponse(422)
        default:
            try Self.checkAPIStatus(response)
            throw GitHubError.badResponse(response.statusCode)
        }
    }

    /// Repo của người dùng (của mình, được mời làm collaborator, thuộc tổ chức), mới cập nhật trước.
    /// Đi theo header `Link: rel="next"`, tối đa `maxRepositoryPages` trang (100 repo mỗi trang).
    public func listRepositories(token: String) async throws -> [GitHubRepository] {
        // Repo vừa được cập nhật giữa hai lần gọi có thể nhảy sang trang sau: bỏ bản trùng.
        var seen = Set<String>()
        return try await paginated(Self.repositoriesURL, token: token, as: GitHubRepository.self)
            .filter { seen.insert($0.fullName).inserted }
    }

    /// Tổ chức của người dùng (`GET /user/orgs`, cần scope `read:org`) — để chọn token theo owner là tổ chức.
    public func listOrganizations(token: String) async throws -> [String] {
        struct Organization: Decodable { let login: String }
        var seen = Set<String>()
        return try await paginated(Self.organizationsURL, token: token, as: Organization.self)
            .map(\.login)
            .filter { seen.insert($0.lowercased()).inserted }
    }

    /// GET danh sách theo trang, đi theo header `Link: rel="next"` (chỉ tới api.github.com), tối đa `maxRepositoryPages` trang.
    private func paginated<Item: Decodable>(_ first: URL, token: String, as type: Item.Type) async throws -> [Item] {
        var next: URL? = first
        var pages = 0
        var result: [Item] = []
        while let url = next, pages < Self.maxRepositoryPages {
            let (data, response) = try await send(Self.apiRequest(url, token: token))
            try Self.checkAPIStatus(response)
            do {
                result += try JSONDecoder().decode([Item].self, from: data)
            } catch {
                throw GitHubError.invalidResponse
            }
            pages += 1
            next = Self.nextPageURL(linkHeader: response.value(forHTTPHeaderField: "Link")).flatMap(Self.trustedAPIURL)
        }
        return result
    }

    /// URL `rel="next"` trong header Link của GitHub, ví dụ
    /// `<https://api.github.com/user/repos?page=2>; rel="next", <https://api.github.com/user/repos?page=5>; rel="last"`.
    /// URL có thể chứa dấu phẩy (`affiliation=owner,collaborator`) nên tách theo cặp `<…>`, không tách theo dấu phẩy.
    public static func nextPageURL(linkHeader: String?) -> URL? {
        guard let linkHeader else { return nil }
        var rest = Substring(linkHeader)
        while let open = rest.firstIndex(of: "<") {
            guard let close = rest[open...].firstIndex(of: ">") else { return nil }
            let target = rest[rest.index(after: open)..<close]
            let afterTarget = rest[rest.index(after: close)...]
            let parametersEnd = afterTarget.firstIndex(of: "<") ?? afterTarget.endIndex
            if relations(in: afterTarget[..<parametersEnd]).contains("next") {
                return URL(string: String(target))
            }
            rest = afterTarget[parametersEnd...]
        }
        return nil
    }

    private static func relations(in parameters: Substring) -> [String] {
        for parameter in parameters.split(separator: ";") {
            let pair = parameter.split(separator: "=", maxSplits: 1)
            guard pair.count == 2, pair[0].trimmingCharacters(in: .whitespaces).lowercased() == "rel" else { continue }
            let value = pair[1].trimmingCharacters(in: CharacterSet(charactersIn: " \t\",")).lowercased()
            return value.split(separator: " ").map(String.init)
        }
        return []
    }

    // MARK: - Nội bộ

    private struct OAuthResponse: Decodable {
        var deviceCode: String?
        var userCode: String?
        var verificationURI: String?
        var expiresIn: Int?
        var interval: Int?
        var accessToken: String?
        var error: String?
        var errorDescription: String?

        enum CodingKeys: String, CodingKey {
            case deviceCode = "device_code"
            case userCode = "user_code"
            case verificationURI = "verification_uri"
            case expiresIn = "expires_in"
            case interval
            case accessToken = "access_token"
            case error
            case errorDescription = "error_description"
        }
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

    static func oauthError(_ code: String, description: String?) -> GitHubError {
        switch code {
        case "device_flow_disabled":
            return .notConfigured(String(localized: "OAuth App chưa bật Device Flow"))
        case "incorrect_client_credentials", "invalid_client", "unauthorized_client":
            return .notConfigured(String(localized: "Client ID không đúng"))
        case "expired_token":
            return .expired
        case "access_denied":
            return .accessDenied
        default:
            let detail = description?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            return .oauth(detail.isEmpty ? code : detail)
        }
    }

    static func checkAPIStatus(_ response: HTTPURLResponse) throws {
        switch response.statusCode {
        case 200..<300: return
        case 401: throw GitHubError.unauthorized
        default: throw GitHubError.badResponse(response.statusCode)
        }
    }

    /// Chỉ mở trang xác nhận trên github.com (không mở địa chỉ lạ dù phản hồi bị sửa).
    static func trustedVerificationURL(_ text: String?) -> URL {
        guard let text, let url = URL(string: text), url.scheme == "https",
              let host = url.host?.lowercased(), host == "github.com" else {
            return defaultVerificationURL
        }
        return url
    }

    /// Token chỉ được gửi tới https://api.github.com — không đi theo link trang sau trỏ sang host khác.
    static func trustedAPIURL(_ url: URL) -> URL? {
        guard url.scheme == "https", url.host?.lowercased() == "api.github.com" else { return nil }
        return url
    }

    static func formRequest(_ url: URL, _ fields: [(String, String)]) -> URLRequest {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        request.httpBody = Data(formEncoded(fields).utf8)
        return request
    }

    static func apiRequest(_ url: URL, token: String) -> URLRequest {
        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.setValue("2022-11-28", forHTTPHeaderField: "X-GitHub-Api-Version")
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        return request
    }

    private static let formAllowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")

    static func formEncoded(_ fields: [(String, String)]) -> String {
        fields.map { key, value in
            key + "=" + (value.addingPercentEncoding(withAllowedCharacters: formAllowed) ?? "")
        }.joined(separator: "&")
    }
}
