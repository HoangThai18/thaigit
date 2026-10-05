import Foundation
import Security

/// One of Thaigit's SSH keys — the NON-secret part (name, public key…), stored in UserDefaults. The secret
/// lives in the Keychain (`SSHKeySecretStore`) and is never written to disk in the clear or shown in the UI.
public struct SSHKeyInfo: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public var name: String
    /// The "ssh-ed25519 AAAA… comment" public key line.
    public let publicKey: String
    public let fingerprint: String
    public let type: String
    /// The secret has a passphrase: every ssh-add asks for it through Thaigit's dialog.
    public let encrypted: Bool
    public let createdAt: Date

    public init(id: String = UUID().uuidString, name: String, publicKey: SSHPublicKey, encrypted: Bool, createdAt: Date = Date()) {
        self.id = id
        self.name = name
        self.publicKey = publicKey.line
        self.fingerprint = publicKey.fingerprint
        self.type = publicKey.displayType
        self.encrypted = encrypted
        self.createdAt = createdAt
    }
}

/// Where SSH private keys are stored (one entry per key id). The app uses the Keychain; tests use an in-memory version.
public protocol SSHKeySecretStore: Sendable {
    func read(id: String) throws -> Data?
    func save(_ key: Data, id: String, label: String) throws
    func delete(id: String) throws
}

/// Secrets in the macOS Keychain: a generic password with service `com.phanthai.thaigit.ssh` and account = the
/// key's id; only readable once the machine has been unlocked, and only on this machine (no iCloud sync, no
/// inclusion in backups copied elsewhere).
public struct KeychainSSHKeyStore: SSHKeySecretStore {
    public static let defaultService = "com.phanthai.thaigit.ssh"
    public let service: String

    public init(service: String = KeychainSSHKeyStore.defaultService) {
        self.service = service
    }

    public func read(id: String) throws -> Data? {
        var query = baseQuery(id)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        switch status {
        case errSecSuccess: return result as? Data
        case errSecItemNotFound: return nil
        default: throw SSHKeyError.keychain(status)
        }
    }

    public func save(_ key: Data, id: String, label: String) throws {
        var item = baseQuery(id)
        item[kSecValueData as String] = key
        item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        item[kSecAttrLabel as String] = "Thaigit — SSH (\(label))"
        var status = SecItemAdd(item as CFDictionary, nil)
        if status == errSecDuplicateItem {
            status = SecItemUpdate(baseQuery(id) as CFDictionary, [kSecValueData as String: key] as CFDictionary)
        }
        guard status == errSecSuccess else { throw SSHKeyError.keychain(status) }
    }

    public func delete(id: String) throws {
        let status = SecItemDelete(baseQuery(id) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw SSHKeyError.keychain(status) }
    }

    private func baseQuery(_ id: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: id,
            kSecAttrSynchronizable as String: kCFBooleanFalse as Any,
        ]
    }
}

/// In-memory keys — for tests (never touches the real Keychain).
public final class InMemorySSHKeyStore: SSHKeySecretStore, @unchecked Sendable {
    private let lock = NSLock()
    private var keys: [String: Data] = [:]

    public init() {}

    public func read(id: String) throws -> Data? {
        lock.lock()
        defer { lock.unlock() }
        return keys[id]
    }

    public func save(_ key: Data, id: String, label _: String) throws {
        lock.lock()
        keys[id] = key
        lock.unlock()
    }

    public func delete(id: String) throws {
        lock.lock()
        keys[id] = nil
        lock.unlock()
    }
}

/// Thaigit's list of SSH keys: add (generate / import), rename, delete, and hand the secrets to the
/// temporary ssh-agent when a git command touches an SSH remote (`GitRunner`). Thread-safe.
public final class SSHKeyring: @unchecked Sendable {
    public static let listKey = "thaigit.sshKeys"
    public static let enabledKey = "thaigit.sshKeysEnabled"

    private let lock = NSLock()
    private let storage: GitHubSettingsStorage
    private let secrets: SSHKeySecretStore
    private var cached: [SSHKeyInfo]

    public init(storage: GitHubSettingsStorage = UserDefaultsSettingsStorage(), secrets: SSHKeySecretStore = KeychainSSHKeyStore()) {
        self.storage = storage
        self.secrets = secrets
        cached = storage.data(forKey: Self.listKey).flatMap { try? JSONDecoder().decode([SSHKeyInfo].self, from: $0) } ?? []
    }

    public var keys: [SSHKeyInfo] {
        lock.lock()
        defer { lock.unlock() }
        return cached
    }

    /// Use Thaigit's key for SSH remotes (on by default). Off means git uses ssh-agent / ~/.ssh keys as usual.
    public var isEnabled: Bool {
        get {
            storage.data(forKey: Self.enabledKey).map { $0 != Data([0]) } ?? true
        }
        set {
            storage.setData(Data([newValue ? 1 : 0]), forKey: Self.enabledKey)
        }
    }

    /// Generate a new Ed25519 key and store its secret.
    @discardableResult
    public func generate(name: String, comment: String) throws -> SSHKeyInfo {
        let generated = SSHKeyFormat.generateEd25519(comment: comment)
        let info = SSHKeyInfo(name: name, publicKey: generated.publicKey, encrypted: false)
        try add(info, privateKey: generated.privateKey)
        return info
    }

    /// Import an existing private key. `publicKey`: the already known public key (the accompanying .pub
    /// file / `ssh-keygen -y`) when the key isn't in OpenSSH format; an OpenSSH key yields its own public key.
    @discardableResult
    public func importKey(name: String, privateKey: Data, publicKey: SSHPublicKey?) throws -> SSHKeyInfo {
        guard SSHKeyFormat.looksLikePrivateKey(privateKey) else { throw SSHKeyError.unsupportedFormat }
        let info: SSHKeyInfo
        if let inspected = SSHKeyFormat.inspectOpenSSH(privateKey) {
            let comment = publicKey?.blob == inspected.publicKey.blob ? publicKey?.comment ?? "" : ""
            info = SSHKeyInfo(name: name, publicKey: SSHPublicKey(blob: inspected.publicKey.blob, comment: comment),
                              encrypted: inspected.encrypted)
        } else if let publicKey, publicKey.type != nil {
            let text = String(decoding: privateKey, as: UTF8.self)
            info = SSHKeyInfo(name: name, publicKey: publicKey, encrypted: text.contains("ENCRYPTED"))
        } else {
            throw SSHKeyError.unsupportedFormat
        }
        try add(info, privateKey: privateKey)
        return info
    }

    private func add(_ info: SSHKeyInfo, privateKey: Data) throws {
        lock.lock()
        let exists = cached.contains { $0.fingerprint == info.fingerprint }
        lock.unlock()
        guard !exists else { throw SSHKeyError.duplicate }
        try secrets.save(privateKey, id: info.id, label: info.name)
        mutate { $0.append(info) }
    }

    public func rename(id: String, to name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        mutate { list in
            if let index = list.firstIndex(where: { $0.id == id }) { list[index].name = trimmed }
        }
    }

    public func remove(id: String) throws {
        try secrets.delete(id: id)
        mutate { $0.removeAll { $0.id == id } }
    }

    /// Every key's secret (keys that can't be read are skipped). Empty when disabled or when there are no keys.
    public func privateKeys() -> [Data] {
        guard isEnabled else { return [] }
        return keys.compactMap { try? secrets.read(id: $0.id) }
    }

    private func mutate(_ change: (inout [SSHKeyInfo]) -> Void) {
        lock.lock()
        change(&cached)
        let data = try? JSONEncoder().encode(cached)
        lock.unlock()
        storage.setData(data, forKey: Self.listKey)
    }
}

/// A remote address that goes over SSH: `ssh://…`, `git+ssh://…` or scp form `git@github.com:owner/repo.git`.
public enum SSHRemoteURL {
    public static func isSSH(_ url: String) -> Bool {
        let lower = url.lowercased()
        if let scheme = lower.range(of: "://") {
            return ["ssh", "git+ssh", "ssh+git"].contains(String(lower[..<scheme.lowerBound]))
        }
        // scp form: a ":" before the first "/", and not a local path ("./a:b", "/x", "C:\…").
        guard !lower.hasPrefix("/"), !lower.hasPrefix("."), !lower.hasPrefix("~"),
              let colon = lower.firstIndex(of: ":") else { return false }
        let host = lower[..<colon]
        return !host.isEmpty && !host.contains("/") && host.count > 1
    }

    /// Host of the SSH address (user@ and port stripped), lowercased. nil when it isn't an SSH address.
    public static func host(of url: String) -> String? {
        guard isSSH(url) else { return nil }
        var authority: Substring
        if let scheme = url.range(of: "://") {
            let rest = url[scheme.upperBound...]
            authority = rest[..<(rest.firstIndex(of: "/") ?? rest.endIndex)]
            if let colon = authority.lastIndex(of: ":") { authority = authority[..<colon] }
        } else {
            authority = url[..<url.firstIndex(of: ":")!]
        }
        if let at = authority.lastIndex(of: "@") { authority = authority[authority.index(after: at)...] }
        return authority.isEmpty ? nil : authority.lowercased()
    }
}
