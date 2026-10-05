import CryptoKit
import Foundation

/// An SSH key error. The message is written for the user — it never contains key material.
public enum SSHKeyError: LocalizedError, Sendable, Equatable {
    /// The file is not an SSH private key Thaigit can read.
    case unsupportedFormat
    /// This key is already in Thaigit.
    case duplicate
    /// Keychain read / write failed (the OSStatus code only goes to the log).
    case keychain(Int32)
    /// ssh-agent / ssh-add cannot run on this machine.
    case agentUnavailable

    public var errorDescription: String? {
        switch self {
        case .unsupportedFormat:
            return String(localized: "File này không phải khoá SSH bí mật mà Thaigit đọc được. Hãy chọn file khoá bí mật (vd. ~/.ssh/id_ed25519), không phải file .pub.")
        case .duplicate:
            return String(localized: "Khoá SSH này đã có trong Thaigit.")
        case .keychain:
            return String(localized: "Không đọc / ghi được Keychain của macOS. Hãy mở khoá Keychain rồi thử lại.")
        case .agentUnavailable:
            return String(localized: "Không chạy được ssh-agent trên máy này nên chưa dùng được khoá SSH của Thaigit.")
        }
    }
}

/// An OpenSSH-format SSH key: generate Ed25519 keys right inside the app (CryptoKit, no temp files) and read
/// the public key back from the stored secret. The "openssh-key-v1" format leaves the public key
/// UNENCRYPTED at the start of the file, so it can be read even from a passphrase-protected key.
public enum SSHKeyFormat {
    public struct Generated: Sendable {
        /// PEM "OPENSSH PRIVATE KEY" secret (no passphrase — the Keychain protects it). */
        public let privateKey: Data
        public let publicKey: SSHPublicKey
    }

    private static let magic = Data("openssh-key-v1\0".utf8)
    private static let beginMarker = "-----BEGIN OPENSSH PRIVATE KEY-----"
    private static let endMarker = "-----END OPENSSH PRIVATE KEY-----"

    /// Generate a new Ed25519 key. `comment` is usually an email or "thaigit@<machine name>". */
    public static func generateEd25519(comment: String) -> Generated {
        let key = Curve25519.Signing.PrivateKey()
        let seed = key.rawRepresentation
        let publicBytes = key.publicKey.rawRepresentation
        let publicBlob = Writer.blob { $0.string("ssh-ed25519"); $0.string(publicBytes) }

        let check = UInt32.random(in: .min ... .max)
        var secret = Writer()
        secret.uint32(check)
        secret.uint32(check)
        secret.string("ssh-ed25519")
        secret.string(publicBytes)
        secret.string(seed + publicBytes)
        secret.string(Data(comment.utf8))
        var padding: UInt8 = 1
        while secret.data.count % 8 != 0 {
            secret.data.append(padding)
            padding += 1
        }

        var body = Writer()
        body.data.append(magic)
        body.string("none")
        body.string("none")
        body.string(Data())
        body.uint32(1)
        body.string(publicBlob)
        body.string(secret.data)

        let pem = pemEncode(body.data)
        return Generated(privateKey: Data(pem.utf8), publicKey: SSHPublicKey(blob: publicBlob, comment: comment))
    }

    /// The public key, plus whether the secret has a passphrase, read from an OpenSSH-format secret. nil when it isn't in that format.
    public static func inspectOpenSSH(_ privateKey: Data) -> (publicKey: SSHPublicKey, encrypted: Bool)? {
        guard let text = String(data: privateKey, encoding: .utf8),
              let start = text.range(of: beginMarker), let end = text.range(of: endMarker, range: start.upperBound..<text.endIndex)
        else { return nil }
        let base64 = text[start.upperBound..<end.lowerBound].filter { !$0.isWhitespace }
        guard let body = Data(base64Encoded: String(base64)), body.starts(with: magic) else { return nil }
        var reader = Reader(body.dropFirst(magic.count))
        guard let cipher = reader.string(), reader.string() != nil, reader.string() != nil,
              let count = reader.uint32(), count == 1, let blob = reader.string(),
              SSHPublicKey(blob: blob, comment: "").type != nil
        else { return nil }
        return (SSHPublicKey(blob: blob, comment: ""), String(decoding: cipher, as: UTF8.self) != "none")
    }

    /// Whether the file looks like ANY PEM private key (OpenSSH, older RSA/EC/DSA, PKCS#8) — to reject non-key files early.
    public static func looksLikePrivateKey(_ data: Data) -> Bool {
        guard data.count < 64 * 1024, let text = String(data: data, encoding: .utf8) else { return false }
        return text.contains("-----BEGIN ") && text.contains(" PRIVATE KEY-----")
    }

    private static func pemEncode(_ data: Data) -> String {
        let base64 = data.base64EncodedString()
        var lines: [String] = []
        var index = base64.startIndex
        while index < base64.endIndex {
            let next = base64.index(index, offsetBy: 70, limitedBy: base64.endIndex) ?? base64.endIndex
            lines.append(String(base64[index..<next]))
            index = next
        }
        return ([beginMarker] + lines + [endMarker]).joined(separator: "\n") + "\n"
    }

    struct Writer {
        var data = Data()

        mutating func uint32(_ value: UInt32) {
            withUnsafeBytes(of: value.bigEndian) { data.append(contentsOf: $0) }
        }

        mutating func string(_ value: Data) {
            uint32(UInt32(value.count))
            data.append(value)
        }

        mutating func string(_ value: String) { string(Data(value.utf8)) }

        static func blob(_ build: (inout Writer) -> Void) -> Data {
            var writer = Writer()
            build(&writer)
            return writer.data
        }
    }

    struct Reader {
        private var rest: Data

        init(_ data: Data) { rest = Data(data) }

        mutating func uint32() -> UInt32? {
            guard rest.count >= 4 else { return nil }
            let value = rest.prefix(4).reduce(UInt32(0)) { $0 << 8 | UInt32($1) }
            rest = rest.dropFirst(4)
            return value
        }

        mutating func string() -> Data? {
            guard let length = uint32(), rest.count >= Int(length) else { return nil }
            let value = Data(rest.prefix(Int(length)))
            rest = rest.dropFirst(Int(length))
            return value
        }
    }
}

/// An SSH public key (binary blob per RFC 4253).
public struct SSHPublicKey: Sendable, Equatable {
    public let blob: Data
    public let comment: String

    public init(blob: Data, comment: String) {
        self.blob = blob
        self.comment = comment
    }

    /// Parse the line "ssh-ed25519 AAAA… comment" (the content of a .pub file or `ssh-keygen -y` output).
    public init?(line: String) {
        let parts = line.trimmingCharacters(in: .whitespacesAndNewlines).split(separator: " ", maxSplits: 2)
        guard parts.count >= 2, let blob = Data(base64Encoded: String(parts[1])) else { return nil }
        self.init(blob: blob, comment: parts.count > 2 ? String(parts[2]) : "")
        guard let type, type == String(parts[0]) else { return nil }
    }

    /// The key type recorded in the blob ("ssh-ed25519", "ssh-rsa", "ecdsa-sha2-nistp256"…). nil when the blob is corrupt.
    public var type: String? {
        var reader = SSHKeyFormat.Reader(blob)
        guard let name = reader.string(), !name.isEmpty, name.count < 64,
              let text = String(data: name, encoding: .ascii), text.allSatisfy({ $0.isLetter || $0.isNumber || "-@.".contains($0) })
        else { return nil }
        return text
    }

    /// Short name for the UI: "Ed25519", "RSA", "ECDSA"…
    public var displayType: String {
        switch type ?? "" {
        case "ssh-ed25519": return "Ed25519"
        case "ssh-rsa": return "RSA"
        case "ssh-dss": return "DSA"
        case let other where other.hasPrefix("ecdsa-"): return "ECDSA"
        case let other where other.hasPrefix("sk-"): return String(localized: "Khoá phần cứng")
        default: return type ?? "?"
        }
    }

    /// The line to paste into GitHub / GitLab: "<type> <base64> <comment>".
    public var line: String {
        let base = "\(type ?? "ssh") \(blob.base64EncodedString())"
        return comment.isEmpty ? base : base + " " + comment
    }

    /// A fingerprint like `ssh-keygen -l` prints it: "SHA256:<base64 without padding>".
    public var fingerprint: String {
        let digest = Data(SHA256.hash(data: blob)).base64EncodedString()
        return "SHA256:" + digest.replacingOccurrences(of: "=", with: "")
    }
}
