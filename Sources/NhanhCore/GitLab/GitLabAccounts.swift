import Foundation
import Security

/// Một tài khoản GitLab (gitlab.com hoặc máy chủ tự host) — phần không bí mật, lưu trong UserDefaults. Token nằm trong
/// Keychain theo `key`.
public struct GitLabAccount: Codable, Sendable, Equatable, Identifiable {
    public let host: String
    public let user: GitLabUser

    public init(host: String, user: GitLabUser) {
        self.host = host
        self.user = user
    }

    public var id: String { key }
    /// "gitlab.com/alice" — khoá trong Keychain và danh sách.
    public var key: String { "\(host)/\(user.username.lowercased())" }
    public var displayName: String { user.name.flatMap { $0.isEmpty ? nil : $0 } ?? user.username }
}

/// Nơi cất token GitLab (JSON của `GitLabToken`). App dùng Keychain; test dùng bản trong bộ nhớ.
public protocol GitLabTokenStore: Sendable {
    func read(key: String) throws -> GitLabToken?
    func save(_ token: GitLabToken, key: String) throws
    func delete(key: String) throws
}

/// Token trong Keychain: generic password, service `com.phanthai.thaigit.gitlab`, account = "host/username", chỉ trên máy
/// này, không đồng bộ iCloud.
public struct KeychainGitLabTokenStore: GitLabTokenStore {
    public static let service = "com.phanthai.thaigit.gitlab"

    public init() {}

    public func read(key: String) throws -> GitLabToken? {
        var query = baseQuery(key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        switch status {
        case errSecSuccess: return (result as? Data).flatMap { try? JSONDecoder().decode(GitLabToken.self, from: $0) }
        case errSecItemNotFound: return nil
        default: throw GitLabError.keychain(status)
        }
    }

    public func save(_ token: GitLabToken, key: String) throws {
        guard let data = try? JSONEncoder().encode(token) else { throw GitLabError.invalidResponse }
        var status = SecItemUpdate(baseQuery(key) as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var item = baseQuery(key)
            item[kSecValueData as String] = data
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            item[kSecAttrLabel as String] = "Thaigit — GitLab (\(key))"
            status = SecItemAdd(item as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw GitLabError.keychain(status) }
    }

    public func delete(key: String) throws {
        let status = SecItemDelete(baseQuery(key) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw GitLabError.keychain(status) }
    }

    private func baseQuery(_ key: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.service,
            kSecAttrAccount as String: key,
            kSecAttrSynchronizable as String: kCFBooleanFalse as Any,
        ]
    }
}

public final class InMemoryGitLabTokenStore: GitLabTokenStore, @unchecked Sendable {
    private let lock = NSLock()
    private var tokens: [String: GitLabToken] = [:]

    public init() {}

    public func read(key: String) throws -> GitLabToken? {
        lock.lock()
        defer { lock.unlock() }
        return tokens[key]
    }

    public func save(_ token: GitLabToken, key: String) throws {
        lock.lock()
        tokens[key] = token
        lock.unlock()
    }

    public func delete(key: String) throws {
        lock.lock()
        tokens[key] = nil
        lock.unlock()
    }
}

/// Tài khoản GitLab của app + token, an toàn đa luồng. Lệnh git HTTPS tới host của một tài khoản nhận token qua
/// credential helper (xem `GitLabCredentialInjection`); token OAuth sắp hết hạn được làm mới trước khi dùng.
public final class GitLabAccounts: @unchecked Sendable {
    public static let listKey = "thaigit.gitlabAccounts"

    private let lock = NSLock()
    private let storage: GitHubSettingsStorage
    private let tokens: GitLabTokenStore
    private let api: GitLabAPI
    /// host → Client ID của OAuth App (để làm mới token OAuth). gitlab.com lấy từ Info.plist.
    private let clientIDs: @Sendable (String) -> String?
    private var cached: [GitLabAccount]
    /// Chỉ một lần làm mới cho mỗi tài khoản tại một thời điểm (refresh token dùng một lần).
    private var refreshing: [String: Task<GitLabToken?, Never>] = [:]

    public init(storage: GitHubSettingsStorage = UserDefaultsSettingsStorage(), tokens: GitLabTokenStore = KeychainGitLabTokenStore(),
                api: GitLabAPI = GitLabAPI(), clientIDs: @escaping @Sendable (String) -> String?) {
        self.storage = storage
        self.tokens = tokens
        self.api = api
        self.clientIDs = clientIDs
        cached = storage.data(forKey: Self.listKey).flatMap { try? JSONDecoder().decode([GitLabAccount].self, from: $0) } ?? []
    }

    public var accounts: [GitLabAccount] {
        lock.lock()
        defer { lock.unlock() }
        return cached
    }

    /// Host có tài khoản (để nhận remote HTTPS của GitLab tự host).
    public var hosts: Set<String> { Set(accounts.map(\.host)) }

    /// Thêm (hoặc cập nhật token của) tài khoản sau khi đăng nhập / dán token.
    public func add(host: String, user: GitLabUser, token: GitLabToken) throws -> GitLabAccount {
        let account = GitLabAccount(host: host, user: user)
        try tokens.save(token, key: account.key)
        lock.lock()
        cached.removeAll { $0.key == account.key }
        cached.append(account)
        let data = try? JSONEncoder().encode(cached)
        lock.unlock()
        storage.setData(data, forKey: Self.listKey)
        return account
    }

    public func remove(key: String) throws {
        try tokens.delete(key: key)
        lock.lock()
        cached.removeAll { $0.key == key }
        let data = try? JSONEncoder().encode(cached)
        lock.unlock()
        storage.setData(data, forKey: Self.listKey)
    }

    /// Token dùng được ngay của tài khoản (làm mới nếu sắp hết hạn). nil khi không có token hoặc làm mới lỗi.
    public func validToken(for account: GitLabAccount, now: Date = Date()) async -> GitLabToken? {
        guard let token = try? tokens.read(key: account.key) else { return nil }
        guard token.needsRefresh(now: now) else { return token }
        guard let clientID = clientIDs(account.host) else { return token }
        let api = self.api
        let store = self.tokens
        let key = account.key
        let task: Task<GitLabToken?, Never> = lock.withLock {
            if let running = refreshing[key] { return running }
            let task = Task<GitLabToken?, Never> {
                guard let fresh = try? await api.refresh(host: account.host, clientID: clientID, token: token, now: now) else { return nil }
                try? store.save(fresh, key: key)
                return fresh
            }
            refreshing[key] = task
            return task
        }
        let result = await task.value
        lock.withLock { refreshing[key] = nil }
        return result
    }

    /// Thông tin đăng nhập cho một lệnh git chạm `urls`: tài khoản đầu tiên của host HTTPS đầu tiên khớp. Username là
    /// "oauth2" với token OAuth, username GitLab với personal access token.
    public func credential(forURLs urls: [String]) async -> GitLabCredential? {
        let known = accounts
        for url in urls {
            guard let components = URLComponents(string: url), components.scheme?.lowercased() == "https",
                  let host = components.host?.lowercased() else { continue }
            let hostWithPort = components.port.map { "\(host):\($0)" } ?? host
            let urlUser = components.user?.lowercased()
            let candidates = known.filter { $0.host == hostWithPort }
            guard let account = candidates.first(where: { $0.user.username.lowercased() == urlUser }) ?? candidates.first,
                  let token = await validToken(for: account) else { continue }
            return GitLabCredential(host: hostWithPort, username: token.isOAuth ? "oauth2" : account.user.username,
                                    token: token.accessToken)
        }
        return nil
    }
}

/// Username + token cho một host GitLab. In ra không bao giờ lộ token.
public struct GitLabCredential: Sendable, Equatable, CustomStringConvertible {
    public let host: String
    public let username: String
    public let token: String

    public var description: String { "GitLabCredential(\(host), \(username), token: <ẩn>)" }
}

/// Đưa token GitLab cho git như `GitCredentialInjection` của GitHub: `-c credential.https://<host>.helper=` (xoá helper
/// của người dùng cho đúng URL đó) rồi helper script đọc username / token từ biến môi trường của riêng tiến trình git.
public enum GitLabCredentialInjection {
    public static let userVariable = "THAIGIT_GITLAB_USER"
    public static let tokenVariable = "THAIGIT_GITLAB_TOKEN"

    public static func additions(for credential: GitLabCredential?, helperPath: String?) -> GitCredentialInjection.Additions {
        guard let credential, let helperPath, !credential.token.contains(where: \.isNewline),
              !credential.username.contains(where: \.isNewline) else { return .none }
        let key = "credential.https://\(credential.host).helper"
        return GitCredentialInjection.Additions(
            arguments: ["-c", key + "=", "-c", key + "=" + GitHubCredentialHelper.configValue(path: helperPath)],
            environment: [userVariable: credential.username, tokenVariable: credential.token]
        )
    }
}

/// Script credential helper cho GitLab, cài cạnh `github-credential.sh`. Chỉ trả lời "get".
public enum GitLabCredentialHelper {
    public static let fileName = "gitlab-credential.sh"

    public static let script = #"""
    #!/bin/sh
    # Thaigit — credential helper cho GitLab (git gọi: <script> get|store|erase). Username / token nằm trong biến môi
    # trường của riêng tiến trình git (THAIGIT_GITLAB_USER / THAIGIT_GITLAB_TOKEN), không ghi ra đĩa.
    [ "$1" = "get" ] || exit 0
    [ -n "${THAIGIT_GITLAB_USER-}" ] && [ -n "${THAIGIT_GITLAB_TOKEN-}" ] || exit 0
    printf 'username=%s\npassword=%s\n' "$THAIGIT_GITLAB_USER" "$THAIGIT_GITLAB_TOKEN"

    """#

    @discardableResult
    public static func install(in directory: URL) throws -> URL {
        let fileManager = FileManager.default
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appendingPathComponent(fileName)
        let data = Data(script.utf8)
        if (try? Data(contentsOf: url)) != data {
            try data.write(to: url, options: .atomic)
        }
        try fileManager.setAttributes([.posixPermissions: 0o755], ofItemAtPath: url.path)
        return url
    }
}
