import Foundation
import Security

/// A GitLab account (gitlab.com or a self-hosted server) — the non-secret part, stored in UserDefaults. The token lives in
/// the Keychain under `key`.
public struct GitLabAccount: Codable, Sendable, Equatable, Identifiable {
    public let host: String
    public let user: GitLabUser

    public init(host: String, user: GitLabUser) {
        self.host = host
        self.user = user
    }

    public var id: String { key }
    /// "gitlab.com/alice" — the Keychain key and the list's identity.
    public var key: String { "\(host)/\(user.username.lowercased())" }
    public var displayName: String { user.name.flatMap { $0.isEmpty ? nil : $0 } ?? user.username }
}

/// Where GitLab tokens are stored (the JSON of a `GitLabToken`). The app uses the Keychain; tests use an in-memory version.
public protocol GitLabTokenStore: Sendable {
    func read(key: String) throws -> GitLabToken?
    func save(_ token: GitLabToken, key: String) throws
    func delete(key: String) throws
}

/// Tokens in the Keychain: a generic password with service `com.phanthai.thaigit.gitlab` and account = "host/username", on this
/// machine only, no iCloud sync.
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

/// The app's GitLab accounts plus tokens, thread-safe. An HTTPS git command to one of the account's hosts receives the token
/// through a credential helper (see `GitLabCredentialInjection`); an OAuth token about to expire is renewed first.
public final class GitLabAccounts: @unchecked Sendable {
    public static let listKey = "thaigit.gitlabAccounts"

    private let lock = NSLock()
    private let storage: GitHubSettingsStorage
    private let tokens: GitLabTokenStore
    private let api: GitLabAPI
    /// host → the OAuth App's client ID (used to renew OAuth tokens). gitlab.com's comes from Info.plist.
    private let clientIDs: @Sendable (String) -> String?
    private var cached: [GitLabAccount]
    /// Only one renewal per account at a time (a refresh token can be used just once).
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

    /// Hosts that have an account (used to recognise a self-hosted GitLab HTTPS remote).
    public var hosts: Set<String> { Set(accounts.map(\.host)) }

    /// The account used for a host: exact host match (including port) first, then host name; `preferredUser` wins ties.
    public func account(forHost host: String, preferredUser: String? = nil) -> GitLabAccount? {
        let bare = GitLabProjectRef.stripPort(host.lowercased())
        let known = accounts
        let candidates = known.filter { $0.host == host.lowercased() }.isEmpty
            ? known.filter { GitLabProjectRef.stripPort($0.host) == bare }
            : known.filter { $0.host == host.lowercased() }
        let wanted = preferredUser?.lowercased()
        return candidates.first(where: { $0.user.username.lowercased() == wanted }) ?? candidates.first
    }

    /// The account's ready-to-use API token for `host` (renewing it when it's about to expire); nil when there's no account / token.
    public func apiToken(forHost host: String, preferredUser: String? = nil) async -> String? {
        guard let account = account(forHost: host, preferredUser: preferredUser) else { return nil }
        return await validToken(for: account)?.accessToken
    }

    /// Add (or update the token of) an account after sign-in / token paste.
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

    /// The account's ready-to-use token (renewing it when it's about to expire). nil when there's no token or the renewal failed.
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

    /// Sign-in info for a git command touching `urls`: the account of the first matching HTTPS host. The username is
    /// "oauth2" with an OAuth token and the GitLab username with a personal access token.
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

/// Username + token for one GitLab host. Printing it never exposes the token.
public struct GitLabCredential: Sendable, Equatable, CustomStringConvertible {
    public let host: String
    public let username: String
    public let token: String

    public var description: String { "GitLabCredential(\(host), \(username), token: <ẩn>)" }
}

/// Hands a GitLab token to git like GitHub's `GitCredentialInjection`: `-c credential.https://<host>.helper=` (clears the
/// user's own helper for exactly that URL), then a helper script reads the username / token from environment
/// variables of that git process alone.
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

/// The credential helper script for GitLab, installed next to `github-credential.sh`. It only answers "get".
public enum GitLabCredentialHelper {
    public static let fileName = "gitlab-credential.sh"

    public static let script = #"""
    #!/bin/sh
    # Thaigit — credential helper for GitLab (git calls: <script> get|store|erase). The username / token live in
    # environment variables of that git process alone (THAIGIT_GITLAB_USER / THAIGIT_GITLAB_TOKEN), never on disk.
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
