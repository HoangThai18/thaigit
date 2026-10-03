import Foundation

/// Kiểu chữ ký commit của git (`gpg.format`).
public enum SignatureFormat: String, Sendable, CaseIterable {
    case openpgp
    case ssh
    case x509

    public var title: String {
        switch self {
        case .openpgp: return "GPG"
        case .ssh: return "SSH"
        case .x509: return "X.509"
        }
    }
}

/// Kết quả xác minh chữ ký (`%G?` của git log).
public enum SignatureVerification: Sendable, Equatable {
    /// Chữ ký đúng; `trusted` false khi khoá chưa được tin cậy (U).
    case good(signer: String, key: String, trusted: Bool)
    case bad(signer: String, key: String)
    /// Chữ ký đúng nhưng đã hết hạn / khoá hết hạn / khoá bị thu hồi.
    case expired(signer: String, key: String)
    case revoked(signer: String, key: String)
    /// Không kiểm được: thiếu khoá công khai, chưa cấu hình allowedSignersFile (SSH), không có chương trình gpg…
    case cannotCheck(key: String)
    case unsigned
}

/// Cấu hình ký commit đang có hiệu lực trong repo (local > global).
public struct CommitSigningConfig: Sendable, Equatable {
    public var signCommits: Bool
    public var signTags: Bool
    public var format: SignatureFormat
    public var key: String?

    public init(signCommits: Bool, signTags: Bool, format: SignatureFormat, key: String?) {
        self.signCommits = signCommits
        self.signTags = signTags
        self.format = format
        self.key = key
    }
}

/// Khoá bí mật GPG trên máy (`gpg --list-secret-keys`).
public struct GPGSecretKey: Sendable, Equatable, Identifiable {
    public let id: String
    public let userID: String
}

extension GitRepository {
    /// Chương trình kiểm chữ ký cố định — không dùng `gpg.program` / `gpg.ssh.program` do repo tự đặt (repo lạ có thể
    /// trỏ chúng tới lệnh tuỳ ý).
    static let trustedSignaturePrograms = [
        "-c", "gpg.program=gpg",
        "-c", "gpg.ssh.program=ssh-keygen",
        "-c", "gpg.x509.program=gpgsm",
    ]

    /// Commit có chữ ký không, kiểu gì — đọc header `gpgsig` của object, không chạy chương trình ngoài.
    public func signatureFormat(of sha: String) async -> SignatureFormat? {
        guard let raw = try? await runner.output(["cat-file", "commit", sha]) else { return nil }
        return Self.signatureFormat(inCommitObject: raw)
    }

    static func signatureFormat(inCommitObject raw: String) -> SignatureFormat? {
        var lines = raw.split(separator: "\n", omittingEmptySubsequences: false).makeIterator()
        while let line = lines.next(), !line.isEmpty {
            guard line.hasPrefix("gpgsig ") || line.hasPrefix("gpgsig-sha256 ") else { continue }
            if line.contains("BEGIN SSH SIGNATURE") { return .ssh }
            if line.contains("BEGIN SIGNED MESSAGE") { return .x509 }
            return .openpgp
        }
        return nil
    }

    /// Xác minh chữ ký (chạy gpg / ssh-keygen / gpgsm cố định). Chỉ gọi khi người dùng bấm "Xác minh".
    public func verifySignature(of sha: String) async -> SignatureVerification {
        let args = Self.trustedSignaturePrograms + ["show", "-s", "--format=%G?%x1f%GS%x1f%GK", sha]
        guard let output = try? await runner.output(args) else { return .cannotCheck(key: "") }
        return Self.parseVerification(output)
    }

    static func parseVerification(_ output: String) -> SignatureVerification {
        let fields = output.trimmingCharacters(in: .whitespacesAndNewlines).split(separator: "\u{1F}", omittingEmptySubsequences: false)
            .map(String.init)
        let code = fields.first ?? "N"
        let signer = fields.count > 1 ? fields[1] : ""
        let key = fields.count > 2 ? fields[2] : ""
        switch code {
        case "G": return .good(signer: signer, key: key, trusted: true)
        case "U": return .good(signer: signer, key: key, trusted: false)
        case "B": return .bad(signer: signer, key: key)
        case "X", "Y": return .expired(signer: signer, key: key)
        case "R": return .revoked(signer: signer, key: key)
        case "E": return .cannotCheck(key: key)
        default: return .unsigned
        }
    }

    public func signingConfig() async -> CommitSigningConfig {
        async let sign = config("commit.gpgsign")
        async let tags = config("tag.gpgsign")
        async let format = config("gpg.format")
        async let key = config("user.signingkey")
        return CommitSigningConfig(signCommits: Self.isTrue(await sign), signTags: Self.isTrue(await tags),
                                   format: SignatureFormat(rawValue: (await format ?? "openpgp").lowercased()) ?? .openpgp,
                                   key: await key)
    }

    /// Ghi cấu hình ký vào repo này (`global` false) hoặc mọi repo (`global` true). Tắt thì chỉ đặt commit.gpgsign /
    /// tag.gpgsign = false, giữ nguyên khoá.
    public func configureSigning(_ config: CommitSigningConfig, global: Bool) async throws {
        try await setConfig("commit.gpgsign", config.signCommits ? "true" : "false", global: global)
        try await setConfig("tag.gpgsign", config.signTags ? "true" : "false", global: global)
        guard config.signCommits || config.signTags else { return }
        try await setConfig("gpg.format", config.format.rawValue, global: global)
        if let key = config.key?.trimmingCharacters(in: .whitespacesAndNewlines), !key.isEmpty {
            try await setConfig("user.signingkey", key, global: global)
        }
    }

    /// Khoá SSH công khai trong ~/.ssh (để chọn làm khoá ký).
    public static func sshPublicKeys(home: URL = FileManager.default.homeDirectoryForCurrentUser) -> [URL] {
        let directory = home.appendingPathComponent(".ssh")
        let names = (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
        return names.filter { $0.hasSuffix(".pub") }.sorted().map { directory.appendingPathComponent($0) }
    }

    /// Khoá bí mật GPG trên máy (rỗng nếu chưa cài gpg).
    public func gpgSecretKeys() async -> [GPGSecretKey] {
        let environment = runner.environmentStore.snapshot().0.variables
        guard let output = try? await ProcessRunner.run(executable: URL(fileURLWithPath: "/usr/bin/env"),
                                                        arguments: ["gpg", "--batch", "--list-secret-keys", "--with-colons"],
                                                        environment: environment),
              output.exitCode == 0 else { return [] }
        return Self.parseGPGSecretKeys(output.stdoutString)
    }

    static func parseGPGSecretKeys(_ text: String) -> [GPGSecretKey] {
        var keys: [GPGSecretKey] = []
        var pendingID: String?
        for line in text.split(separator: "\n") {
            let fields = line.split(separator: ":", omittingEmptySubsequences: false).map(String.init)
            guard let type = fields.first else { continue }
            if type == "sec", fields.count > 4 {
                pendingID = fields[4]
            } else if type == "uid", fields.count > 9, let id = pendingID {
                keys.append(GPGSecretKey(id: id, userID: fields[9]))
                pendingID = nil
            }
        }
        return keys
    }

    private static func isTrue(_ value: String?) -> Bool {
        ["true", "yes", "on", "1"].contains(value?.lowercased() ?? "")
    }
}
