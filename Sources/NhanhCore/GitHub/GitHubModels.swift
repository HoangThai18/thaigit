import Foundation

/// A signed-in GitHub account (`GET /user`). Public information only — safe to store in UserDefaults.
public struct GitHubAccount: Codable, Sendable, Equatable {
    public let id: Int64
    public let login: String
    public let name: String?
    public let avatarURL: URL?

    public init(id: Int64, login: String, name: String?, avatarURL: URL?) {
        self.id = id
        self.login = login
        self.name = name
        self.avatarURL = avatarURL
    }

    /// Display name: the real name when there is one, otherwise the login.
    public var displayName: String {
        guard let name, !name.trimmingCharacters(in: .whitespaces).isEmpty else { return login }
        return name
    }

    enum CodingKeys: String, CodingKey {
        case id, login, name
        case avatarURL = "avatar_url"
    }
}

/// A repository in the `GET /user/repos` list.
public struct GitHubRepository: Decodable, Sendable, Equatable, Identifiable {
    public let name: String
    public let fullName: String
    public let isPrivate: Bool
    public let cloneURL: String
    public let updatedAt: Date?
    public let description: String?

    public init(name: String, fullName: String, isPrivate: Bool, cloneURL: String, updatedAt: Date?, description: String?) {
        self.name = name
        self.fullName = fullName
        self.isPrivate = isPrivate
        self.cloneURL = cloneURL
        self.updatedAt = updatedAt
        self.description = description
    }

    public var id: String { fullName }

    enum CodingKeys: String, CodingKey {
        case name, description
        case fullName = "full_name"
        case isPrivate = "private"
        case cloneURL = "clone_url"
        case updatedAt = "updated_at"
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        name = try container.decode(String.self, forKey: .name)
        fullName = try container.decode(String.self, forKey: .fullName)
        isPrivate = try container.decodeIfPresent(Bool.self, forKey: .isPrivate) ?? false
        cloneURL = try container.decode(String.self, forKey: .cloneURL)
        description = try container.decodeIfPresent(String.self, forKey: .description)
        // A date in an unexpected format must not break the whole page of results.
        let updated: String? = try? container.decodeIfPresent(String.self, forKey: .updatedAt)
        updatedAt = updated.flatMap(Self.parseDate)
    }

    static func parseDate(_ text: String) -> Date? {
        (try? Date(text, strategy: .iso8601))
            ?? (try? Date(text, strategy: Date.ISO8601FormatStyle(includingFractionalSeconds: true)))
    }
}

/// The device code of the OAuth Device Flow: the user enters `userCode` at `verificationURL` while the app polls for a token every `interval`.
public struct GitHubDeviceCode: Sendable, Equatable {
    public let deviceCode: String
    public let userCode: String
    public let verificationURL: URL
    /// How many seconds the code stays valid.
    public let expiresIn: Int
    /// Minimum seconds between two token polls.
    public let interval: Int

    public init(deviceCode: String, userCode: String, verificationURL: URL, expiresIn: Int, interval: Int) {
        self.deviceCode = deviceCode
        self.userCode = userCode
        self.verificationURL = verificationURL
        self.expiresIn = expiresIn
        self.interval = interval
    }
}

public enum GitHubError: LocalizedError, Equatable, Sendable {
    /// A missing client ID (nil) or GitHub rejecting the OAuth App (with the reason): the app hasn't enabled the Device Flow, wrong client ID…
    case notConfigured(String?)
    case expired
    case accessDenied
    /// The token was revoked / expired (HTTP 401).
    case unauthorized
    case network(String)
    case badResponse(Int)
    case invalidResponse
    /// Another OAuth error GitHub returned (a code or a description).
    case oauth(String)
    case keychain(Int32)

    public var errorDescription: String? {
        switch self {
        case .notConfigured(nil): return String(localized: "Chưa cấu hình (thiếu Client ID của GitHub OAuth App)")
        case .notConfigured(let detail?): return String(localized: "Chưa cấu hình đúng GitHub OAuth App: \(detail).")
        case .expired: return String(localized: "Mã xác nhận đã hết hạn — hãy đăng nhập lại để lấy mã mới.")
        case .accessDenied: return String(localized: "Bạn đã từ chối cấp quyền cho Thaigit trên GitHub.")
        case .unauthorized: return String(localized: "Token GitHub không còn hợp lệ — đăng nhập lại.")
        case .network(let detail): return String(localized: "Không kết nối được tới GitHub: \(detail)")
        case .badResponse(let status): return String(localized: "GitHub trả về lỗi \(status).")
        case .invalidResponse: return String(localized: "Phản hồi của GitHub không đúng định dạng.")
        case .oauth(let detail): return String(localized: "GitHub từ chối đăng nhập: \(detail)")
        case .keychain(let status): return String(localized: "Không truy cập được Keychain (mã lỗi \(status)).")
        }
    }
}
