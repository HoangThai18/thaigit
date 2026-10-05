import Foundation

/// The commit signing format git uses (`gpg.format`).
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

/// The result of verifying a signature (git log's `%G?`).
public enum SignatureVerification: Sendable, Equatable {
    /// The signature is good; `trusted` false when the key isn't trusted yet (U).
    case good(signer: String, key: String, trusted: Bool)
    case bad(signer: String, key: String)
    /// The signature is good but expired / the key expired / the key was revoked.
    case expired(signer: String, key: String)
    case revoked(signer: String, key: String)
    /// Couldn't be checked: the public key is missing, allowedSignersFile isn't configured (SSH), there's no gpg program…
    case cannotCheck(key: String)
    case unsigned
}

/// The commit signing config currently in effect in the repo (local > global).
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

/// GPG secret keys on the machine (`gpg --list-secret-keys`).
public struct GPGSecretKey: Sendable, Equatable, Identifiable {
    public let id: String
    public let userID: String
}

extension GitRepository {
    /// The verification program is hardcoded — `gpg.program` / `gpg.ssh.program` set by the repo are not used (an
    /// untrusted repo could point them at an arbitrary command).
    static let trustedSignaturePrograms = [
        "-c", "gpg.program=gpg",
        "-c", "gpg.ssh.program=ssh-keygen",
        "-c", "gpg.x509.program=gpgsm",
    ]

    /// Whether a commit has a signature and of what kind — read from the object's `gpgsig` header, no external program runs.
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

    /// Verify a signature (runs the hardcoded gpg / ssh-keygen / gpgsm). Only called when the user presses "Verify".
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

    /// Write the signing config into this repo (`global` false) or into every repo (`global` true). Turning it off only sets
    /// commit.gpgsign / tag.gpgsign = false and leaves the keys alone.
    public func configureSigning(_ config: CommitSigningConfig, global: Bool) async throws {
        try await setConfig("commit.gpgsign", config.signCommits ? "true" : "false", global: global)
        try await setConfig("tag.gpgsign", config.signTags ? "true" : "false", global: global)
        guard config.signCommits || config.signTags else { return }
        try await setConfig("gpg.format", config.format.rawValue, global: global)
        if let key = config.key?.trimmingCharacters(in: .whitespacesAndNewlines), !key.isEmpty {
            try await setConfig("user.signingkey", key, global: global)
        }
    }

    /// SSH public keys in ~/.ssh (offered as signing keys).
    public static func sshPublicKeys(home: URL = FileManager.default.homeDirectoryForCurrentUser) -> [URL] {
        let directory = home.appendingPathComponent(".ssh")
        let names = (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
        return names.filter { $0.hasSuffix(".pub") }.sorted().map { directory.appendingPathComponent($0) }
    }

    /// GPG secret keys on the machine (empty when gpg isn't installed).
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
