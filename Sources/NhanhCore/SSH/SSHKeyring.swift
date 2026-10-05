import Foundation
import Security

/// Một khoá SSH của Thaigit — phần KHÔNG bí mật (tên, khoá công khai…), lưu trong UserDefaults. Khoá bí mật nằm trong
/// Keychain (`SSHKeySecretStore`), không bao giờ ghi ra đĩa dạng thô hay hiện ra giao diện.
public struct SSHKeyInfo: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public var name: String
    /// Dòng khoá công khai "ssh-ed25519 AAAA… comment".
    public let publicKey: String
    public let fingerprint: String
    public let type: String
    /// Khoá bí mật có passphrase: mỗi lần dùng ssh-add hỏi passphrase qua hộp thoại của Thaigit.
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

/// Nơi cất khoá bí mật SSH (mỗi khoá một mục theo id). App dùng Keychain; test dùng bản trong bộ nhớ.
public protocol SSHKeySecretStore: Sendable {
    func read(id: String) throws -> Data?
    func save(_ key: Data, id: String, label: String) throws
    func delete(id: String) throws
}

/// Khoá bí mật trong Keychain của macOS: generic password, service `com.phanthai.thaigit.ssh`, account = id của khoá,
/// chỉ đọc được khi máy đã mở khoá, chỉ trên máy này (không đồng bộ iCloud, không vào bản sao lưu sang máy khác).
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

/// Khoá trong bộ nhớ — cho test (không đụng Keychain thật).
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

/// Danh sách khoá SSH của Thaigit: thêm (tạo mới / nhập), đổi tên, xoá, và đưa khoá bí mật cho ssh-agent tạm khi lệnh git
/// chạm remote SSH (`GitRunner`). An toàn đa luồng.
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

    /// Dùng khoá của Thaigit cho remote SSH (mặc định bật). Tắt thì git dùng ssh-agent / khoá ~/.ssh như bình thường.
    public var isEnabled: Bool {
        get {
            storage.data(forKey: Self.enabledKey).map { $0 != Data([0]) } ?? true
        }
        set {
            storage.setData(Data([newValue ? 1 : 0]), forKey: Self.enabledKey)
        }
    }

    /// Tạo khoá Ed25519 mới, cất khoá bí mật vào kho.
    @discardableResult
    public func generate(name: String, comment: String) throws -> SSHKeyInfo {
        let generated = SSHKeyFormat.generateEd25519(comment: comment)
        let info = SSHKeyInfo(name: name, publicKey: generated.publicKey, encrypted: false)
        try add(info, privateKey: generated.privateKey)
        return info
    }

    /// Nhập khoá bí mật có sẵn. `publicKey`: khoá công khai đã biết (file .pub đi kèm / `ssh-keygen -y`) khi khoá không ở
    /// dạng OpenSSH; khoá dạng OpenSSH tự đọc được khoá công khai.
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

    /// Khoá bí mật của mọi khoá (bỏ qua khoá không đọc được). Rỗng khi tắt hoặc chưa có khoá.
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

/// Địa chỉ remote đi qua SSH: `ssh://…`, `git+ssh://…` hoặc dạng scp `git@github.com:owner/repo.git`.
public enum SSHRemoteURL {
    public static func isSSH(_ url: String) -> Bool {
        let lower = url.lowercased()
        if let scheme = lower.range(of: "://") {
            return ["ssh", "git+ssh", "ssh+git"].contains(String(lower[..<scheme.lowerBound]))
        }
        // Dạng scp: có ":" trước dấu "/" đầu tiên, không phải đường dẫn trên máy ("./a:b", "/x", "C:\…").
        guard !lower.hasPrefix("/"), !lower.hasPrefix("."), !lower.hasPrefix("~"),
              let colon = lower.firstIndex(of: ":") else { return false }
        let host = lower[..<colon]
        return !host.isEmpty && !host.contains("/") && host.count > 1
    }

    /// Host của địa chỉ SSH (bỏ user@ và cổng), viết thường. nil nếu không phải địa chỉ SSH.
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
