import CryptoKit
import Foundation

/// Số phiên bản dạng "1.2.3" (bỏ tiền tố "v"), so sánh theo từng phần số: 1.10 > 1.9, 1.1 == 1.1.0.
public struct AppVersion: Comparable, Hashable, Sendable, CustomStringConvertible {
    public let text: String
    private let parts: [Int]

    public init?(_ string: String) {
        var trimmed = Substring(string.trimmingCharacters(in: .whitespacesAndNewlines))
        if trimmed.first == "v" || trimmed.first == "V" { trimmed = trimmed.dropFirst() }
        let pieces = trimmed.split(separator: ".", omittingEmptySubsequences: false)
        guard (1...4).contains(pieces.count) else { return nil }
        var values: [Int] = []
        for piece in pieces {
            guard !piece.isEmpty, piece.count <= 9, piece.allSatisfy({ $0.isASCII && $0.isNumber }), let value = Int(piece) else { return nil }
            values.append(value)
        }
        // Bỏ số 0 ở cuối để 1.1 và 1.1.0 bằng nhau.
        while values.count > 1, values.last == 0 { values.removeLast() }
        text = String(trimmed)
        parts = values
    }

    public var description: String { text }

    /// Dạng OperatingSystemVersion (để so với phiên bản macOS tối thiểu).
    public var operatingSystemVersion: OperatingSystemVersion {
        OperatingSystemVersion(
            majorVersion: parts[0],
            minorVersion: parts.count > 1 ? parts[1] : 0,
            patchVersion: parts.count > 2 ? parts[2] : 0
        )
    }

    public static func == (lhs: AppVersion, rhs: AppVersion) -> Bool { lhs.parts == rhs.parts }
    public func hash(into hasher: inout Hasher) { hasher.combine(parts) }
    public static func < (lhs: AppVersion, rhs: AppVersion) -> Bool { lhs.parts.lexicographicallyPrecedes(rhs.parts) }
}

/// Thông tin một bản phát hành (`update.json`, đăng kèm file zip trong GitHub Release).
public struct UpdateManifest: Codable, Sendable, Equatable {
    public var version: String
    public var url: URL
    /// Kích thước file zip (byte).
    public var size: Int
    public var sha256: String
    /// Chữ ký Ed25519 (base64) trên toàn bộ byte của file zip, ký bằng khoá bí mật của người phát hành.
    public var signature: String
    public var notes: String?
    public var minimumSystemVersion: String?
    public var publishedAt: Date?

    public init(
        version: String, url: URL, size: Int, sha256: String, signature: String,
        notes: String? = nil, minimumSystemVersion: String? = nil, publishedAt: Date? = nil
    ) {
        self.version = version
        self.url = url
        self.size = size
        self.sha256 = sha256
        self.signature = signature
        self.notes = notes
        self.minimumSystemVersion = minimumSystemVersion
        self.publishedAt = publishedAt
    }

    public static func decode(_ data: Data) throws -> UpdateManifest {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let manifest: UpdateManifest
        do {
            manifest = try decoder.decode(UpdateManifest.self, from: data)
        } catch {
            throw UpdateError.invalidManifest(String(localized: "không đọc được update.json"))
        }
        guard AppVersion(manifest.version) != nil else { throw UpdateError.invalidManifest(String(localized: "số phiên bản \"\(manifest.version)\" sai")) }
        guard manifest.size > 0, manifest.size <= UpdateClient.maxArchiveSize else { throw UpdateError.archiveTooLarge }
        guard manifest.sha256.count == 64, manifest.sha256.allSatisfy(\.isHexDigit) else { throw UpdateError.invalidManifest(String(localized: "sha256 sai định dạng")) }
        guard Data(base64Encoded: manifest.signature)?.count == 64 else { throw UpdateError.invalidManifest(String(localized: "chữ ký sai định dạng")) }
        return manifest
    }

    public func encoded() throws -> Data {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(self)
    }
}

public enum UpdateError: LocalizedError, Equatable, Sendable {
    case badResponse(Int)
    case invalidManifest(String)
    case untrustedURL(String)
    case archiveTooLarge
    case checksumMismatch
    case badSignature
    case invalidBundle(String)
    case cannotInstall(String)

    public var errorDescription: String? {
        switch self {
        case .badResponse(let status): return String(localized: "Máy chủ cập nhật trả về lỗi \(status).")
        case .invalidManifest(let reason): return String(localized: "Thông tin bản cập nhật không hợp lệ: \(reason).")
        case .untrustedURL(let url): return String(localized: "Bỏ qua bản cập nhật tải từ địa chỉ lạ: \(url)")
        case .archiveTooLarge: return String(localized: "File cập nhật có kích thước bất thường nên đã bỏ qua.")
        case .checksumMismatch: return String(localized: "File cập nhật tải về bị hỏng (không khớp checksum).")
        case .badSignature: return String(localized: "Chữ ký của bản cập nhật không hợp lệ — file có thể đã bị sửa nên không cài.")
        case .invalidBundle(let reason): return String(localized: "Gói cập nhật không đúng: \(reason).")
        case .cannotInstall(let reason): return String(localized: "Không cài được bản cập nhật: \(reason).")
        }
    }
}

/// Ký và kiểm chữ ký Ed25519 cho file cập nhật.
public enum UpdateSignature {
    public static func sign(_ data: Data, privateKey: String) throws -> String {
        guard let raw = Data(base64Encoded: privateKey) else { throw UpdateError.badSignature }
        let key = try Curve25519.Signing.PrivateKey(rawRepresentation: raw)
        return try key.signature(for: data).base64EncodedString()
    }

    public static func isValid(_ signature: String, for data: Data, publicKey: String) -> Bool {
        guard let signatureData = Data(base64Encoded: signature),
              let keyData = Data(base64Encoded: publicKey),
              let key = try? Curve25519.Signing.PublicKey(rawRepresentation: keyData)
        else { return false }
        return key.isValidSignature(signatureData, for: data)
    }

    public static func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}

/// Nơi đăng bản phát hành. Mặc định: `update.json` của bản mới nhất trên GitHub Releases.
public struct UpdateFeed: Sendable {
    public let manifestURL: URL
    /// Host được phép đặt file zip (nil: không giới hạn, kể cả file:// — chỉ dùng khi kiểm thử).
    public let allowedHosts: Set<String>?

    public init(manifestURL: URL, allowedHosts: Set<String>?) {
        self.manifestURL = manifestURL
        self.allowedHosts = allowedHosts
    }
}

public enum UpdateCheck: Sendable, Equatable {
    case upToDate
    case available(UpdateManifest)
}

/// Hỏi máy chủ có bản mới không và tải file zip về.
public struct UpdateClient: Sendable {
    public static let maxArchiveSize = 300 * 1024 * 1024

    public let feed: UpdateFeed
    private let session: URLSession

    public init(feed: UpdateFeed, session: URLSession = .shared) {
        self.feed = feed
        self.session = session
    }

    public func check(currentVersion: String) async throws -> UpdateCheck {
        var request = URLRequest(url: feed.manifestURL)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        let (data, response) = try await session.data(for: request)
        if let http = response as? HTTPURLResponse {
            // Chưa có bản phát hành nào thì GitHub trả 404.
            if http.statusCode == 404 { return .upToDate }
            guard http.statusCode == 200 else { throw UpdateError.badResponse(http.statusCode) }
        }
        let manifest = try UpdateManifest.decode(data)
        guard let latest = AppVersion(manifest.version), let current = AppVersion(currentVersion), latest > current else {
            return .upToDate
        }
        if let minimum = manifest.minimumSystemVersion.flatMap(AppVersion.init),
           !ProcessInfo.processInfo.isOperatingSystemAtLeast(minimum.operatingSystemVersion) {
            return .upToDate
        }
        try checkTrusted(manifest.url)
        return .available(manifest)
    }

    /// Tải file zip vào `directory`. Chữ ký được kiểm ở bước chuẩn bị (`UpdateInstaller.stage`).
    public func download(_ manifest: UpdateManifest, into directory: URL) async throws -> URL {
        try checkTrusted(manifest.url)
        let (temporary, response) = try await session.download(from: manifest.url)
        defer { try? FileManager.default.removeItem(at: temporary) }
        if let http = response as? HTTPURLResponse, http.statusCode != 200 {
            throw UpdateError.badResponse(http.statusCode)
        }
        let size = (try? temporary.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        guard size == manifest.size else { throw UpdateError.checksumMismatch }
        let fileManager = FileManager.default
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        let destination = directory.appendingPathComponent("Thaigit-\(manifest.version).zip")
        try? fileManager.removeItem(at: destination)
        try fileManager.moveItem(at: temporary, to: destination)
        return destination
    }

    private func checkTrusted(_ url: URL) throws {
        guard let allowed = feed.allowedHosts else { return }
        guard url.scheme == "https", let host = url.host?.lowercased(), allowed.contains(host) else {
            throw UpdateError.untrustedURL(url.absoluteString)
        }
    }
}

/// Bản cập nhật đã tải, kiểm chữ ký và giải nén — chờ thay vào app đang cài.
public struct StagedUpdate: Sendable, Equatable {
    public let version: String
    public let notes: String?
    public let appURL: URL

    public init(version: String, notes: String?, appURL: URL) {
        self.version = version
        self.notes = notes
        self.appURL = appURL
    }
}

/// Kiểm tra file zip đã tải rồi thay app đang cài bằng bản mới.
public struct UpdateInstaller: Sendable {
    public let bundleIdentifier: String
    /// Khoá công khai Ed25519 (base64) đi kèm app — chỉ file ký bằng khoá bí mật tương ứng mới được cài.
    public let publicKey: String
    public let stagingDirectory: URL
    public let verifyCodeSignature: Bool

    public init(bundleIdentifier: String, publicKey: String, stagingDirectory: URL, verifyCodeSignature: Bool = true) {
        self.bundleIdentifier = bundleIdentifier
        self.publicKey = publicKey
        self.stagingDirectory = stagingDirectory
        self.verifyCodeSignature = verifyCodeSignature
    }

    /// Kiểm checksum + chữ ký, giải nén, đối chiếu mã ứng dụng và số phiên bản bên trong gói.
    public func stage(archive: URL, manifest: UpdateManifest) async throws -> StagedUpdate {
        let data = try Data(contentsOf: archive, options: .mappedIfSafe)
        guard data.count == manifest.size, UpdateSignature.sha256Hex(data) == manifest.sha256.lowercased() else {
            throw UpdateError.checksumMismatch
        }
        guard UpdateSignature.isValid(manifest.signature, for: data, publicKey: publicKey) else {
            throw UpdateError.badSignature
        }

        let fileManager = FileManager.default
        let destination = stagingDirectory.appendingPathComponent(manifest.version, isDirectory: true)
        try? fileManager.removeItem(at: destination)
        try fileManager.createDirectory(at: destination, withIntermediateDirectories: true)
        let unzip = try await ProcessRunner.run(
            executable: URL(fileURLWithPath: "/usr/bin/ditto"),
            arguments: ["-x", "-k", archive.path, destination.path]
        )
        guard unzip.exitCode == 0 else {
            throw UpdateError.invalidBundle(String(localized: "không giải nén được (\(unzip.stderrString.trimmingCharacters(in: .whitespacesAndNewlines)))"))
        }

        let apps = try fileManager.contentsOfDirectory(at: destination, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "app" }
        guard apps.count == 1, let app = apps.first else {
            throw UpdateError.invalidBundle(String(localized: "file zip phải chứa đúng một ứng dụng .app"))
        }
        let info = try Self.infoDictionary(of: app)
        guard info["CFBundleIdentifier"] as? String == bundleIdentifier else {
            throw UpdateError.invalidBundle(String(localized: "mã ứng dụng không khớp"))
        }
        guard let bundleVersion = (info["CFBundleShortVersionString"] as? String).flatMap(AppVersion.init),
              bundleVersion == AppVersion(manifest.version) else {
            throw UpdateError.invalidBundle(String(localized: "phiên bản trong gói khác thông tin phát hành"))
        }
        if verifyCodeSignature {
            let check = try await ProcessRunner.run(
                executable: URL(fileURLWithPath: "/usr/bin/codesign"),
                arguments: ["--verify", "--deep", "--strict", app.path]
            )
            guard check.exitCode == 0 else { throw UpdateError.invalidBundle(String(localized: "chữ ký mã của ứng dụng không hợp lệ")) }
        }
        return StagedUpdate(version: manifest.version, notes: manifest.notes, appURL: app)
    }

    /// Thay app đang cài bằng bản đã chuẩn bị. Trên APFS hai thư mục được đổi chỗ nguyên khối (không có lúc nào
    /// thiếu app); lỗi giữa chừng thì app cũ vẫn còn nguyên. App đang chạy không bị ảnh hưởng tới khi khởi động lại.
    public static func install(_ update: StagedUpdate, replacing installed: URL) throws {
        let fileManager = FileManager.default
        guard fileManager.fileExists(atPath: update.appURL.path) else {
            throw UpdateError.cannotInstall(String(localized: "không tìm thấy bản đã tải"))
        }
        let folder = installed.deletingLastPathComponent()
        let incoming = folder.appendingPathComponent(".\(installed.lastPathComponent)-\(update.version).incoming")
        try? fileManager.removeItem(at: incoming)
        do {
            try fileManager.moveItem(at: update.appURL, to: incoming)
        } catch {
            throw UpdateError.cannotInstall(String(localized: "không ghi được vào \(folder.path)"))
        }

        if renamex_np(incoming.path, installed.path, UInt32(RENAME_SWAP)) == 0 {
            // `incoming` giờ là app cũ.
            try? fileManager.removeItem(at: incoming)
        } else {
            // Ổ đĩa không hỗ trợ đổi chỗ nguyên khối: dời app cũ ra rồi đặt bản mới vào, lỗi thì trả lại.
            let backup = folder.appendingPathComponent(".\(installed.lastPathComponent).old")
            try? fileManager.removeItem(at: backup)
            do {
                try fileManager.moveItem(at: installed, to: backup)
            } catch {
                try? fileManager.removeItem(at: incoming)
                throw UpdateError.cannotInstall(String(localized: "không thay được \(installed.path)"))
            }
            do {
                try fileManager.moveItem(at: incoming, to: installed)
            } catch {
                try? fileManager.moveItem(at: backup, to: installed)
                try? fileManager.removeItem(at: incoming)
                throw UpdateError.cannotInstall(String(localized: "không đặt được bản mới vào \(installed.path)"))
            }
            try? fileManager.removeItem(at: backup)
        }
        // Dọn thư mục chờ cài (Updates/<phiên bản>) nếu đã trống.
        let staging = update.appURL.deletingLastPathComponent()
        if (try? fileManager.contentsOfDirectory(atPath: staging.path))?.isEmpty == true {
            try? fileManager.removeItem(at: staging)
        }
    }

    static func infoDictionary(of app: URL) throws -> [String: Any] {
        let plist = app.appendingPathComponent("Contents/Info.plist")
        guard let data = try? Data(contentsOf: plist),
              let info = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any]
        else { throw UpdateError.invalidBundle(String(localized: "thiếu Info.plist")) }
        return info
    }
}
