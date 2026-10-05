import Foundation
import Security

/// Nơi cất token GitHub (mỗi tài khoản một mục theo login). App dùng `KeychainTokenStore`; test dùng bản trong bộ nhớ
/// (không đụng Keychain thật).
public protocol GitHubTokenStore: Sendable {
    func readToken(account login: String) throws -> String?
    func saveToken(_ token: String, account login: String) throws
    func deleteToken(account login: String) throws
}

/// Token chỉ trong bộ nhớ (chế độ kiểm thử tự động của app — không đụng Keychain thật, không bật hộp hỏi quyền).
public final class InMemoryGitHubTokenStore: GitHubTokenStore, @unchecked Sendable {
    private let lock = NSLock()
    private var tokens: [String: String] = [:]

    public init() {}

    public func readToken(account login: String) throws -> String? {
        lock.withLock { tokens[login] }
    }

    public func saveToken(_ token: String, account login: String) throws {
        lock.withLock { tokens[login] = token }
    }

    public func deleteToken(account login: String) throws {
        lock.withLock { tokens[login] = nil }
    }
}

/// Token trong Keychain của macOS: mật khẩu chung (generic password), service `com.phanthai.thaigit.github`,
/// account = login, chỉ đọc được sau lần mở khoá đầu tiên, không đồng bộ iCloud.
public struct KeychainTokenStore: GitHubTokenStore {
    public static let defaultService = "com.phanthai.thaigit.github"
    public let service: String

    public init(service: String = KeychainTokenStore.defaultService) {
        self.service = service
    }

    public func readToken(account login: String) throws -> String? {
        var query = baseQuery(login)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        switch status {
        case errSecSuccess:
            guard let data = result as? Data, let token = String(data: data, encoding: .utf8), !token.isEmpty else { return nil }
            return token
        case errSecItemNotFound:
            return nil
        default:
            throw GitHubError.keychain(status)
        }
    }

    public func saveToken(_ token: String, account login: String) throws {
        let data = Data(token.utf8)
        let query = baseQuery(login)
        var status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var item = query
            item[kSecValueData as String] = data
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
            item[kSecAttrLabel as String] = "Thaigit — GitHub (\(login))"
            status = SecItemAdd(item as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw GitHubError.keychain(status) }
    }

    public func deleteToken(account login: String) throws {
        let status = SecItemDelete(baseQuery(login) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw GitHubError.keychain(status) }
    }

    private func baseQuery(_ login: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: login,
            kSecAttrSynchronizable as String: kCFBooleanFalse as Any,
        ]
    }
}

/// Nơi lưu phần không bí mật (UserDefaults trong app, bộ nhớ khi test — test không ghi file cài đặt nào).
public protocol GitHubSettingsStorage: Sendable {
    func data(forKey key: String) -> Data?
    func setData(_ data: Data?, forKey key: String)
}

public struct UserDefaultsSettingsStorage: GitHubSettingsStorage, @unchecked Sendable {
    // UserDefaults an toàn đa luồng; @unchecked chỉ vì SDK chưa đánh dấu Sendable.
    private let defaults: UserDefaults

    public init(_ defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public func data(forKey key: String) -> Data? { defaults.data(forKey: key) }

    public func setData(_ data: Data?, forKey key: String) {
        if let data { defaults.set(data, forKey: key) } else { defaults.removeObject(forKey: key) }
    }
}

/// Lưu các tài khoản GitHub: danh sách, mặc định, owner đã gán, danh tính commit trong `storage` (UserDefaults);
/// token từng tài khoản trong `tokens` (Keychain) theo login — token không bao giờ nằm trong UserDefaults.
public struct GitHubAccountStore: Sendable {
    public static let stateKey = "githubAccounts"
    public let storage: any GitHubSettingsStorage
    public let tokens: any GitHubTokenStore

    public init(storage: any GitHubSettingsStorage = UserDefaultsSettingsStorage(), tokens: any GitHubTokenStore = KeychainTokenStore()) {
        self.storage = storage
        self.tokens = tokens
    }

    public func loadState() -> GitHubAccountsState {
        guard let data = storage.data(forKey: Self.stateKey),
              let state = try? JSONDecoder().decode(GitHubAccountsState.self, from: data) else { return GitHubAccountsState() }
        return state
    }

    public func saveState(_ state: GitHubAccountsState) {
        storage.setData(state.isEmpty && state.ownerAssignments.isEmpty ? nil : try? JSONEncoder().encode(state), forKey: Self.stateKey)
    }

    /// Thêm (hoặc đăng nhập lại) một tài khoản: lưu token của tài khoản đó — không đụng token của tài khoản khác.
    /// Login trên GitHub đã đổi (cùng id, khác hoa/thường hoặc tên mới): xoá token cất theo login cũ để không để lại
    /// mục Keychain mồ côi — xoá TRƯỚC khi lưu vì Keychain có thể so tên tài khoản không phân biệt hoa thường.
    @discardableResult
    public func addAccount(_ account: GitHubAccount, token: String, organizations: [String]?,
                           to state: GitHubAccountsState) throws -> GitHubAccountsState {
        guard GitHubCredential(login: account.login, token: token) != nil else { throw GitHubError.invalidResponse }
        let previousLogin = state.profiles.first { $0.account.id == account.id }?.login ?? state.profile(login: account.login)?.login
        if let previousLogin, previousLogin != account.login { try? tokens.deleteToken(account: previousLogin) }
        try tokens.saveToken(token, account: account.login)
        var updated = state
        updated.upsert(account, organizations: organizations)
        saveState(updated)
        return updated
    }

    /// Xoá một tài khoản: chỉ xoá token của tài khoản đó; tài khoản mặc định chuyển sang tài khoản còn lại.
    /// Danh sách luôn được cập nhật; lỗi xoá token khỏi Keychain được trả về để báo người dùng.
    /// Token vẫn còn hiệu lực trên GitHub tới khi người dùng thu hồi (OAuth App không tự thu hồi được nếu không có
    /// client secret).
    public func removeAccount(login: String, from state: GitHubAccountsState) -> (state: GitHubAccountsState, tokenError: (any Error)?) {
        var updated = state
        updated.remove(login: login)
        saveState(updated)
        do {
            try tokens.deleteToken(account: login)
            return (updated, nil)
        } catch {
            return (updated, error)
        }
    }
}

/// Tài khoản + token GitHub dùng chung giữa các luồng: lệnh git (qua `GitEnvironmentStore`) và API (ảnh đại diện…)
/// chọn token theo owner bằng cùng một bảng (`GitHubCredentialSet`, dựng một lần rồi giữ tới khi danh sách tài khoản /
/// token đổi). Token chưa nạp thì đọc Keychain khi cần — NGOÀI khoá chính (Keychain có thể chờ người dùng bấm "Cho
/// phép"), chỉ một luồng đọc một lúc để không hỏi trùng lặp.
public final class GitHubTokenProvider: @unchecked Sendable {
    private let lock = NSLock()
    /// Chỉ một luồng đọc kho token một lúc. Không bao giờ giữ `lock` trong lúc đọc.
    private let loadLock = NSLock()
    private let tokenStore: any GitHubTokenStore
    private var state: GitHubAccountsState
    private var tokens: [String: String] = [:]
    /// Login đã đọc Keychain mà không có token (hoặc lỗi) — không đọc lại liên tục.
    private var unavailable: Set<String> = []
    /// Bảng đã dựng (`isCacheValid`): dựng bảng owner tốn vài chục ms khi tài khoản thuộc hàng trăm tổ chức.
    private var cachedSet: GitHubCredentialSet?
    private var isCacheValid = false

    public init(state: GitHubAccountsState = GitHubAccountsState(), tokenStore: any GitHubTokenStore) {
        self.state = state
        self.tokenStore = tokenStore
    }

    /// Cập nhật danh sách tài khoản (giữ token đã nạp của tài khoản còn trong danh sách).
    public func update(state newState: GitHubAccountsState) {
        lock.lock()
        defer { lock.unlock() }
        state = newState
        let logins = Set(newState.profiles.map(\.login))
        tokens = tokens.filter { logins.contains($0.key) }
        unavailable.formIntersection(logins)
        isCacheValid = false
    }

    /// Token vừa nhận khi đăng nhập (nil: quên token của tài khoản).
    public func setToken(_ token: String?, for login: String) {
        lock.lock()
        defer { lock.unlock() }
        tokens[login] = token
        if token == nil { unavailable.insert(login) } else { unavailable.remove(login) }
        isCacheValid = false
    }

    /// Nạp token của mọi tài khoản chưa nạp (gọi ở luồng nền lúc mở app). Trả về lỗi Keychain theo login.
    @discardableResult
    public func loadTokens() -> [String: any Error] {
        loadMissing()
    }

    public func hasToken(for login: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return tokens[login] != nil
    }

    /// Token của đúng tài khoản `login` (nạp từ Keychain nếu chưa nạp). Gọi được từ mọi luồng.
    public func token(login: String) -> String? {
        loadMissing()
        lock.lock()
        defer { lock.unlock() }
        return tokens[login]
    }

    /// Token cho owner (người dùng / tổ chức trên github.com) theo đúng bảng mà lệnh git dùng; nil nếu tài khoản của
    /// owner chưa có token. Gọi được từ mọi luồng.
    public func token(forOwner owner: String?) -> String? {
        loadMissing()
        lock.lock()
        defer { lock.unlock() }
        return credentialSetLocked()?.credential(forOwner: owner)?.token
    }

    /// Bảng cho credential helper của lệnh git (chỉ gồm tài khoản đã nạp token). nil nếu chưa có tài khoản nào.
    public func credentialSet(helperPath: String) -> GitHubCredentialSet? {
        lock.lock()
        defer { lock.unlock() }
        return credentialSetLocked()?.withHelperPath(helperPath)
    }

    private func credentialSetLocked() -> GitHubCredentialSet? {
        if !isCacheValid {
            cachedSet = GitHubCredentialSet(helperPath: "", state: state, tokens: tokens)
            isCacheValid = true
        }
        return cachedSet
    }

    private func pendingLoginsLocked() -> [String] {
        state.profiles.map(\.login).filter { tokens[$0] == nil && !unavailable.contains($0) }
    }

    /// Đọc kho token cho các tài khoản chưa nạp, ngoài `lock`; chỉ khoá lại để ghi kết quả.
    @discardableResult
    private func loadMissing() -> [String: any Error] {
        let needsLoading = lock.withLock { !pendingLoginsLocked().isEmpty }
        guard needsLoading else { return [:] }
        loadLock.lock()
        defer { loadLock.unlock() }
        // Luồng khác có thể vừa nạp xong trong lúc chờ.
        let pending = lock.withLock { pendingLoginsLocked() }
        var loaded: [String: String] = [:]
        var errors: [String: any Error] = [:]
        for login in pending {
            do {
                if let token = try tokenStore.readToken(account: login), GitHubCredential(login: login, token: token) != nil {
                    loaded[login] = token
                }
            } catch {
                errors[login] = error
            }
        }
        lock.withLock {
            // Trong lúc đọc, tài khoản có thể vừa bị xoá hoặc vừa đăng nhập lại (`setToken`): giữ trạng thái mới đó.
            let logins = Set(state.profiles.map(\.login))
            for login in pending where logins.contains(login) && tokens[login] == nil && !unavailable.contains(login) {
                if let token = loaded[login] { tokens[login] = token } else { unavailable.insert(login) }
            }
            isCacheValid = false
        }
        return errors
    }
}
