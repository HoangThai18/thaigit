import Foundation

/// Tài khoản GitHub đã đăng nhập (từ `GET /user`). Chỉ gồm thông tin công khai — lưu được vào UserDefaults.
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

    /// Tên hiển thị: tên thật nếu có, không thì login.
    public var displayName: String {
        guard let name, !name.trimmingCharacters(in: .whitespaces).isEmpty else { return login }
        return name
    }

    enum CodingKeys: String, CodingKey {
        case id, login, name
        case avatarURL = "avatar_url"
    }
}

/// Một repository trong danh sách `GET /user/repos`.
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
        // Ngày sai định dạng không được làm hỏng cả trang kết quả.
        let updated: String? = try? container.decodeIfPresent(String.self, forKey: .updatedAt)
        updatedAt = updated.flatMap(Self.parseDate)
    }

    static func parseDate(_ text: String) -> Date? {
        (try? Date(text, strategy: .iso8601))
            ?? (try? Date(text, strategy: Date.ISO8601FormatStyle(includingFractionalSeconds: true)))
    }
}

/// Mã thiết bị của OAuth Device Flow: người dùng nhập `userCode` tại `verificationURL`, app hỏi token theo `interval`.
public struct GitHubDeviceCode: Sendable, Equatable {
    public let deviceCode: String
    public let userCode: String
    public let verificationURL: URL
    /// Số giây mã còn hiệu lực.
    public let expiresIn: Int
    /// Số giây tối thiểu giữa hai lần hỏi token.
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
    /// Thiếu Client ID (nil) hoặc GitHub từ chối OAuth App (kèm lý do): app chưa bật Device Flow, Client ID sai…
    case notConfigured(String?)
    case expired
    case accessDenied
    /// Token bị thu hồi / hết hạn (HTTP 401).
    case unauthorized
    case network(String)
    case badResponse(Int)
    case invalidResponse
    /// Lỗi OAuth khác GitHub trả về (mã hoặc mô tả).
    case oauth(String)
    case keychain(Int32)

    public var errorDescription: String? {
        switch self {
        case .notConfigured(nil): return "Chưa cấu hình (thiếu Client ID của GitHub OAuth App)"
        case .notConfigured(let detail?): return "Chưa cấu hình đúng GitHub OAuth App: \(detail)."
        case .expired: return "Mã xác nhận đã hết hạn — hãy đăng nhập lại để lấy mã mới."
        case .accessDenied: return "Bạn đã từ chối cấp quyền cho Thaigit trên GitHub."
        case .unauthorized: return "Token GitHub không còn hợp lệ — đăng nhập lại."
        case .network(let detail): return "Không kết nối được tới GitHub: \(detail)"
        case .badResponse(let status): return "GitHub trả về lỗi \(status)."
        case .invalidResponse: return "Phản hồi của GitHub không đúng định dạng."
        case .oauth(let detail): return "GitHub từ chối đăng nhập: \(detail)"
        case .keychain(let status): return "Không truy cập được Keychain (mã lỗi \(status))."
        }
    }
}
