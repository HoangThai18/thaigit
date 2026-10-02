import Foundation

/// Một tài khoản GitHub đã đăng nhập (không có token): thông tin công khai, danh tính commit, tổ chức đã biết.
public struct GitHubAccountProfile: Codable, Sendable, Equatable, Identifiable {
    public var account: GitHubAccount
    /// Tên / email ghi vào config local của repo khi gán tài khoản cho repo (người dùng sửa được).
    public var commitName: String
    public var commitEmail: String
    /// Tổ chức tài khoản là thành viên (`GET /user/orgs`), lưu lại để chọn token theo owner.
    public var organizations: [String]
    public var organizationsUpdatedAt: Date?

    public init(account: GitHubAccount, commitName: String? = nil, commitEmail: String? = nil,
                organizations: [String] = [], organizationsUpdatedAt: Date? = nil) {
        self.account = account
        self.commitName = commitName ?? account.displayName
        self.commitEmail = commitEmail ?? Self.noreplyEmail(for: account)
        self.organizations = organizations
        self.organizationsUpdatedAt = organizationsUpdatedAt
    }

    public var id: String { account.login }
    public var login: String { account.login }

    /// Email ẩn của GitHub: commit vẫn được tính cho tài khoản mà không lộ email thật.
    public static func noreplyEmail(for account: GitHubAccount) -> String {
        "\(account.id)+\(account.login)@users.noreply.github.com"
    }
}

/// Các tài khoản GitHub, tài khoản mặc định và owner người dùng tự gán — phần không bí mật (lưu UserDefaults).
/// Token từng tài khoản nằm riêng trong Keychain theo login.
public struct GitHubAccountsState: Codable, Sendable, Equatable {
    public var profiles: [GitHubAccountProfile]
    public var defaultLogin: String?
    /// owner (viết thường) → login, do người dùng gán ("Tài khoản GitHub cho repo này").
    public var ownerAssignments: [String: String]

    public init(profiles: [GitHubAccountProfile] = [], defaultLogin: String? = nil, ownerAssignments: [String: String] = [:]) {
        self.profiles = profiles
        self.defaultLogin = defaultLogin
        self.ownerAssignments = ownerAssignments
    }

    public var isEmpty: Bool { profiles.isEmpty }

    /// Tài khoản mặc định: theo `defaultLogin`, không có thì tài khoản đầu tiên.
    public var defaultProfile: GitHubAccountProfile? { profile(login: defaultLogin) ?? profiles.first }

    public func profile(login: String?) -> GitHubAccountProfile? {
        guard let login else { return nil }
        return profiles.first { $0.login.caseInsensitiveCompare(login) == .orderedSame }
    }

    // MARK: - Chọn tài khoản theo owner

    /// Lý do chọn tài khoản cho một owner.
    public enum Match: Sendable, Equatable {
        /// Người dùng tự gán owner cho tài khoản.
        case assigned
        /// Owner chính là login của tài khoản.
        case login
        /// Owner là tổ chức mà tài khoản là thành viên.
        case organization
        /// Không khớp gì: dùng tài khoản mặc định.
        case fallback
    }

    public struct Resolution: Sendable, Equatable {
        public let profile: GitHubAccountProfile
        public let match: Match
    }

    /// Tài khoản dùng cho owner, theo thứ tự ưu tiên: 1. người dùng tự gán; 2. owner trùng login của một tài khoản;
    /// 3. tổ chức mà tài khoản là thành viên (nhiều tài khoản cùng tổ chức: tài khoản mặc định trước, rồi tài khoản
    /// đầu tiên); 4. còn lại: tài khoản mặc định. So khớp không phân biệt hoa thường. nil khi chưa có tài khoản nào.
    public func resolve(owner: String?) -> Resolution? {
        guard let fallback = defaultProfile else { return nil }
        guard let owner, let key = Self.normalizedOwner(owner) else { return Resolution(profile: fallback, match: .fallback) }
        if let login = ownerAssignments[key], let assigned = profile(login: login) {
            return Resolution(profile: assigned, match: .assigned)
        }
        if let own = profile(login: key) {
            return Resolution(profile: own, match: .login)
        }
        let candidates = [fallback] + profiles.filter { $0.login != fallback.login }
        if let member = candidates.first(where: { $0.organizations.contains { Self.normalizedOwner($0) == key } }) {
            return Resolution(profile: member, match: .organization)
        }
        return Resolution(profile: fallback, match: .fallback)
    }

    /// Bảng owner (viết thường) → login cho mọi owner đã biết (đã gán, login, tổ chức) — cùng kết quả với `resolve`.
    /// Owner ngoài bảng dùng tài khoản mặc định.
    public var ownerTable: [String: String] {
        var owners = Set(ownerAssignments.keys)
        for profile in profiles {
            if let key = Self.normalizedOwner(profile.login) { owners.insert(key) }
            owners.formUnion(profile.organizations.compactMap(Self.normalizedOwner))
        }
        var table: [String: String] = [:]
        for owner in owners {
            if let resolution = resolve(owner: owner) { table[owner] = resolution.profile.login }
        }
        return table
    }

    /// Owner hợp lệ trên GitHub (chữ, số, "-", "_", "."), viết thường; nil nếu rỗng hoặc có ký tự lạ.
    public static func normalizedOwner(_ owner: String) -> String? {
        let trimmed = owner.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, trimmed.count <= 100,
              trimmed.unicodeScalars.allSatisfy({ $0.isASCII && (CharacterSet.alphanumerics.contains($0) || "-_.".unicodeScalars.contains($0)) })
        else { return nil }
        return trimmed.lowercased()
    }

    // MARK: - Thay đổi

    /// Thêm tài khoản, hoặc cập nhật nếu đã có — tìm theo id GitHub trước (login có thể đổi hoa/thường hoặc đổi tên),
    /// rồi theo login. Giữ danh tính commit người dùng đã sửa; login đổi thì owner đã gán và tài khoản mặc định đi theo
    /// login mới. Tài khoản đầu tiên thành mặc định. `organizations` nil: giữ danh sách tổ chức cũ.
    public mutating func upsert(_ account: GitHubAccount, organizations: [String]?, at date: Date = Date()) {
        if let index = profiles.firstIndex(where: { $0.account.id == account.id })
            ?? profiles.firstIndex(where: { $0.login.caseInsensitiveCompare(account.login) == .orderedSame }) {
            let oldLogin = profiles[index].login
            profiles[index].account = account
            if oldLogin != account.login {
                ownerAssignments = ownerAssignments.mapValues { $0 == oldLogin ? account.login : $0 }
                if defaultLogin == oldLogin { defaultLogin = account.login }
            }
            if let organizations {
                profiles[index].organizations = organizations
                profiles[index].organizationsUpdatedAt = date
            }
        } else {
            profiles.append(GitHubAccountProfile(account: account, organizations: organizations ?? [],
                                                 organizationsUpdatedAt: organizations == nil ? nil : date))
        }
        if profile(login: defaultLogin) == nil { defaultLogin = profiles.first?.login }
    }

    /// Bỏ tài khoản (và các owner đã gán cho nó). Xoá tài khoản mặc định thì tài khoản đầu tiên còn lại thành mặc định.
    public mutating func remove(login: String) {
        profiles.removeAll { $0.login.caseInsensitiveCompare(login) == .orderedSame }
        ownerAssignments = ownerAssignments.filter { $0.value.caseInsensitiveCompare(login) != .orderedSame }
        if profile(login: defaultLogin) == nil { defaultLogin = profiles.first?.login }
    }

    public mutating func setDefault(login: String) {
        guard let profile = profile(login: login) else { return }
        defaultLogin = profile.login
    }

    /// Gán owner cho tài khoản (`login` nil: bỏ gán). Owner không hợp lệ hoặc tài khoản không tồn tại thì bỏ qua.
    public mutating func assign(owner: String, to login: String?) {
        guard let key = Self.normalizedOwner(owner) else { return }
        if let login, let profile = profile(login: login) {
            ownerAssignments[key] = profile.login
        } else {
            ownerAssignments[key] = nil
        }
    }

    public mutating func setCommitIdentity(login: String, name: String, email: String) {
        guard let index = profiles.firstIndex(where: { $0.login == login }) else { return }
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)
        profiles[index].commitName = trimmedName.isEmpty ? profiles[index].account.displayName : trimmedName
        profiles[index].commitEmail = trimmedEmail.isEmpty ? GitHubAccountProfile.noreplyEmail(for: profiles[index].account) : trimmedEmail
    }

    public mutating func setOrganizations(login: String, _ organizations: [String], at date: Date = Date()) {
        guard let index = profiles.firstIndex(where: { $0.login == login }) else { return }
        profiles[index].organizations = organizations
        profiles[index].organizationsUpdatedAt = date
    }

    /// Repo chọn trong danh sách repo của tài khoản `login` (hộp Clone): owner đang dùng tài khoản khác (kể cả do quy tắc
    /// tổ chức / mặc định) thì gán owner cho `login`, để clone — và fetch / push sau này — dùng đúng tài khoản đã liệt kê
    /// repo đó. Trả về true nếu vừa gán.
    @discardableResult
    public mutating func assignOwnerForPickedRepository(owner: String, login: String) -> Bool {
        guard let picked = profile(login: login), let current = resolve(owner: owner),
              current.profile.login != picked.login else { return false }
        assign(owner: owner, to: picked.login)
        return true
    }
}

/// Đọc owner (người dùng / tổ chức) từ địa chỉ remote trên github.com.
public enum GitHubRemoteURL {
    /// `https://github.com/owner/repo(.git)`, `git@github.com:owner/repo.git`, `ssh://git@github.com/owner/repo`…
    /// nil nếu remote không ở github.com.
    public static func owner(of remote: String) -> String? {
        let text = remote.trimmingCharacters(in: .whitespacesAndNewlines)
        var path: Substring?
        if let components = URLComponents(string: text), components.scheme != nil, let host = components.host?.lowercased() {
            guard ["github.com", "www.github.com", "ssh.github.com"].contains(host) else { return nil }
            path = Substring(components.path)
        } else if let separator = text.range(of: "@github.com:", options: .caseInsensitive) {
            // Dạng scp của ssh: git@github.com:owner/repo.git
            path = text[separator.upperBound...]
        } else if text.lowercased().hasPrefix("github.com:") {
            path = text.dropFirst("github.com:".count)
        }
        guard let path, let owner = path.split(separator: "/").first.map(String.init),
              GitHubAccountsState.normalizedOwner(owner) != nil else { return nil }
        return owner
    }

    /// Username trong URL (`https://alice@github.com/…` → "alice"), nếu có.
    public static func username(of remote: String) -> String? {
        guard let user = URLComponents(string: remote.trimmingCharacters(in: .whitespacesAndNewlines))?.user, !user.isEmpty else {
            return nil
        }
        return user
    }

    /// Remote dùng HTTPS tới github.com (mới đi qua credential helper của Thaigit; SSH dùng khoá SSH).
    public static func isHTTPS(_ remote: String) -> Bool {
        guard let components = URLComponents(string: remote.trimmingCharacters(in: .whitespacesAndNewlines)) else { return false }
        return components.scheme?.lowercased() == "https" && components.host?.lowercased() == "github.com"
    }
}
