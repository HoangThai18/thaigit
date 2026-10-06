import Foundation
import Security

/// Where GitHub tokens are stored (one entry per account, keyed by login). The app uses `KeychainTokenStore`; tests use
/// the in-memory version (never touching the real Keychain).
public protocol GitHubTokenStore: Sendable {
    func readToken(account login: String) throws -> String?
    func saveToken(_ token: String, account login: String) throws
    func deleteToken(account login: String) throws
}

/// Tokens kept in memory only (the app's automated test mode — no real Keychain, no permission prompt).
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

/// Tokens in the macOS Keychain: a generic password with service `com.phanthai.thaigit.github.v2` and account = login,
/// readable only after the first unlock, no iCloud sync.
///
/// Items written by older builds sit under the plain `service`. Their access list still names the ad-hoc-signed build that
/// created them, so macOS asks for the keychain password on every launch and "Always Allow" does not stick. A token found
/// there is copied into a fresh `.v2` item — owned by the current signing identity, which every later build shares — and the
/// old item is deleted when macOS lets us.
public struct KeychainTokenStore: GitHubTokenStore {
    public static let defaultService = "com.phanthai.thaigit.github"
    public let service: String

    public init(service: String = KeychainTokenStore.defaultService) {
        self.service = service
    }

    private var currentService: String { service + ".v2" }

    public func readToken(account login: String) throws -> String? {
        if let token = try read(service: currentService, login: login) { return token }
        guard let token = try read(service: service, login: login) else { return nil }
        // The old item keeps working if the copy fails, and one that can't be deleted is never read again once `.v2` exists.
        if (try? write(token, service: currentService, login: login)) != nil {
            _ = SecItemDelete(baseQuery(service: service, login: login) as CFDictionary)
        }
        return token
    }

    public func saveToken(_ token: String, account login: String) throws {
        try write(token, service: currentService, login: login)
        _ = SecItemDelete(baseQuery(service: service, login: login) as CFDictionary)
    }

    public func deleteToken(account login: String) throws {
        var failure: OSStatus?
        for name in [currentService, service] {
            let status = SecItemDelete(baseQuery(service: name, login: login) as CFDictionary)
            if status != errSecSuccess && status != errSecItemNotFound { failure = failure ?? status }
        }
        if let failure { throw GitHubError.keychain(failure) }
    }

    private func read(service: String, login: String) throws -> String? {
        var query = baseQuery(service: service, login: login)
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

    private func write(_ token: String, service: String, login: String) throws {
        let data = Data(token.utf8)
        let query = baseQuery(service: service, login: login)
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

    private func baseQuery(service: String, login: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: login,
            kSecAttrSynchronizable as String: kCFBooleanFalse as Any,
        ]
    }
}

/// Where the non-secret part is stored (UserDefaults in the app, memory in tests — tests write no settings file).
public protocol GitHubSettingsStorage: Sendable {
    func data(forKey key: String) -> Data?
    func setData(_ data: Data?, forKey key: String)
}

public struct UserDefaultsSettingsStorage: GitHubSettingsStorage, @unchecked Sendable {
    // UserDefaults is thread-safe; @unchecked only because the SDK doesn't mark it Sendable.
    private let defaults: UserDefaults

    public init(_ defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public func data(forKey key: String) -> Data? { defaults.data(forKey: key) }

    public func setData(_ data: Data?, forKey key: String) {
        if let data { defaults.set(data, forKey: key) } else { defaults.removeObject(forKey: key) }
    }
}

/// Stores the GitHub accounts: the list, the default, the assigned owner and the commit identity in `storage`
/// (UserDefaults); each account's token in `tokens` (Keychain) keyed by login — a token never sits in UserDefaults.
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

    /// Add (or sign in again) an account: stores that account's token — other accounts' tokens are untouched.
    /// A GitHub login changed (same id, different case or a new name): delete the token stored under the old login
    /// so no orphaned Keychain entry is left — delete it BEFORE storing, because the Keychain compares account
    /// names case-insensitively.
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

    /// Remove an account: only that account's token is removed; the default account moves to a remaining one.
    /// The list is always updated; a failure to remove the token from the Keychain is returned so the user can be
    /// told. The token stays valid on GitHub until the user revokes it (an OAuth App can't revoke it by itself,
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

/// GitHub account + token shared across flows: git commands (via `GitEnvironmentStore`) and the API (avatars…)
/// pick the token by owner through the same table (`GitHubCredentialSet`, built once and kept until the
/// account / token list changes). A token that isn't loaded yet is read from the Keychain on demand —
/// OUTSIDE the main lock (the Keychain can wait for the user to click "Allow"), with only one reader at a
/// time so the prompt isn't repeated.
public final class GitHubTokenProvider: @unchecked Sendable {
    private let lock = NSLock()
    /// Only one task reads the token store at a time. Never hold `lock` while reading.
    private let loadLock = NSLock()
    private let tokenStore: any GitHubTokenStore
    private var state: GitHubAccountsState
    private var tokens: [String: String] = [:]
    /// A login whose Keychain read came back without a token (or failed) — don't read it again in a loop.
    private var unavailable: Set<String> = []
    /// A built table (`isCacheValid`): building the owner table takes tens of ms when accounts span hundreds of organisations.
    private var cachedSet: GitHubCredentialSet?
    private var isCacheValid = false

    public init(state: GitHubAccountsState = GitHubAccountsState(), tokenStore: any GitHubTokenStore) {
        self.state = state
        self.tokenStore = tokenStore
    }

    /// Update the account list (keeping already loaded tokens of accounts still in the list).
    public func update(state newState: GitHubAccountsState) {
        lock.lock()
        defer { lock.unlock() }
        state = newState
        let logins = Set(newState.profiles.map(\.login))
        tokens = tokens.filter { logins.contains($0.key) }
        unavailable.formIntersection(logins)
        isCacheValid = false
    }

    /// The token just received on sign-in (nil: forget the account's token).
    public func setToken(_ token: String?, for login: String) {
        lock.lock()
        defer { lock.unlock() }
        tokens[login] = token
        if token == nil { unavailable.insert(login) } else { unavailable.remove(login) }
        isCacheValid = false
    }

    /// Load the tokens of every account that doesn't have one (called on a background task at launch). Returns per-login Keychain errors.
    @discardableResult
    public func loadTokens() -> [String: any Error] {
        loadMissing()
    }

    public func hasToken(for login: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return tokens[login] != nil
    }

    /// The token of exactly the account `login` (loaded from the Keychain when needed). Callable from any task.
    public func token(login: String) -> String? {
        loadMissing()
        lock.lock()
        defer { lock.unlock() }
        return tokens[login]
    }

    /// The token for an owner (a user / organisation on github.com) following exactly the table git commands use; nil when
    /// the owner's account has no token. Callable from any task.
    public func token(forOwner owner: String?) -> String? {
        loadMissing()
        lock.lock()
        defer { lock.unlock() }
        return credentialSetLocked()?.credential(forOwner: owner)?.token
    }

    /// The table for git's credential helper (only accounts whose token is loaded). nil when there's no account yet.
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

    /// Read the tokens of accounts that aren't loaded, outside `lock`; it is only re-locked to write the results.
    @discardableResult
    private func loadMissing() -> [String: any Error] {
        let needsLoading = lock.withLock { !pendingLoginsLocked().isEmpty }
        guard needsLoading else { return [:] }
        loadLock.lock()
        defer { loadLock.unlock() }
        // Another task may have finished loading while we were waiting.
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
            // While we were reading, the account may have been removed or signed in again (`setToken`): keep that newer state.
            let logins = Set(state.profiles.map(\.login))
            for login in pending where logins.contains(login) && tokens[login] == nil && !unavailable.contains(login) {
                if let token = loaded[login] { tokens[login] = token } else { unavailable.insert(login) }
            }
            isCacheValid = false
        }
        return errors
    }
}
