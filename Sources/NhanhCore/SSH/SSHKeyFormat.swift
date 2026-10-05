import CryptoKit
import Foundation

/// Lỗi của khoá SSH. Thông báo viết cho người dùng — không chứa nội dung khoá.
public enum SSHKeyError: LocalizedError, Sendable, Equatable {
    /// File không phải khoá bí mật SSH mà Thaigit đọc được.
    case unsupportedFormat
    /// Khoá này đã có trong Thaigit.
    case duplicate
    /// Đọc / ghi Keychain lỗi (mã OSStatus chỉ ghi nhật ký).
    case keychain(Int32)
    /// Không chạy được ssh-agent / ssh-add trên máy.
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

/// Khoá SSH dạng OpenSSH: tạo khoá Ed25519 ngay trong app (CryptoKit, không ghi file tạm) và đọc khoá công khai từ khoá bí
/// mật có sẵn. Định dạng "openssh-key-v1" để khoá công khai KHÔNG mã hoá ngay đầu file, nên đọc được cả khi khoá có
/// passphrase.
public enum SSHKeyFormat {
    public struct Generated: Sendable {
        /// Khoá bí mật dạng PEM "OPENSSH PRIVATE KEY" (không passphrase — được Keychain bảo vệ).
        public let privateKey: Data
        public let publicKey: SSHPublicKey
    }

    private static let magic = Data("openssh-key-v1\0".utf8)
    private static let beginMarker = "-----BEGIN OPENSSH PRIVATE KEY-----"
    private static let endMarker = "-----END OPENSSH PRIVATE KEY-----"

    /// Tạo khoá Ed25519 mới. `comment` thường là email hoặc "thaigit@<tên máy>".
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

    /// Khoá công khai + khoá có passphrase không, đọc từ khoá bí mật dạng OpenSSH. nil nếu không phải dạng này.
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

    /// Có dạng khoá bí mật PEM nào đó (OpenSSH, RSA/EC/DSA kiểu cũ, PKCS#8) — để từ chối sớm file không phải khoá.
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

/// Khoá công khai SSH (blob nhị phân theo RFC 4253).
public struct SSHPublicKey: Sendable, Equatable {
    public let blob: Data
    public let comment: String

    public init(blob: Data, comment: String) {
        self.blob = blob
        self.comment = comment
    }

    /// Đọc dòng "ssh-ed25519 AAAA… comment" (nội dung file .pub hoặc output `ssh-keygen -y`).
    public init?(line: String) {
        let parts = line.trimmingCharacters(in: .whitespacesAndNewlines).split(separator: " ", maxSplits: 2)
        guard parts.count >= 2, let blob = Data(base64Encoded: String(parts[1])) else { return nil }
        self.init(blob: blob, comment: parts.count > 2 ? String(parts[2]) : "")
        guard let type, type == String(parts[0]) else { return nil }
    }

    /// Loại khoá ghi trong blob ("ssh-ed25519", "ssh-rsa", "ecdsa-sha2-nistp256"…). nil nếu blob hỏng.
    public var type: String? {
        var reader = SSHKeyFormat.Reader(blob)
        guard let name = reader.string(), !name.isEmpty, name.count < 64,
              let text = String(data: name, encoding: .ascii), text.allSatisfy({ $0.isLetter || $0.isNumber || "-@.".contains($0) })
        else { return nil }
        return text
    }

    /// Tên ngắn cho giao diện: "Ed25519", "RSA", "ECDSA"…
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

    /// Dòng để dán vào GitHub / GitLab: "<loại> <base64> <comment>".
    public var line: String {
        let base = "\(type ?? "ssh") \(blob.base64EncodedString())"
        return comment.isEmpty ? base : base + " " + comment
    }

    /// Dấu vân tay như `ssh-keygen -l`: "SHA256:<base64 không padding>".
    public var fingerprint: String {
        let digest = Data(SHA256.hash(data: blob)).base64EncodedString()
        return "SHA256:" + digest.replacingOccurrences(of: "=", with: "")
    }
}
