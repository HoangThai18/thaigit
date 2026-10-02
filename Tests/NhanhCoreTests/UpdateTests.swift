import CryptoKit
import Foundation
import Testing
@testable import NhanhCore

@Suite("Tự cập nhật")
struct UpdateTests {
    @Test func comparesVersionsNumerically() throws {
        #expect(try #require(AppVersion("1.0.10")) > #require(AppVersion("1.0.9")))
        #expect(AppVersion("v1.1") == AppVersion("1.1.0"))
        #expect(try #require(AppVersion("2")) > #require(AppVersion("1.9.9")))
        #expect(try #require(AppVersion("1.0.0")) < #require(AppVersion("1.0.1")))
        for invalid in ["", "1..2", "abc", "1.2.3.4.5", "+1", "1.-2", "1.2 beta"] {
            #expect(AppVersion(invalid) == nil, "\(invalid)")
        }
    }

    @Test func signatureMatchesOnlyOriginalBytesAndKey() throws {
        let key = Curve25519.Signing.PrivateKey()
        let other = Curve25519.Signing.PrivateKey()
        let publicKey = key.publicKey.rawRepresentation.base64EncodedString()
        let data = Data("bản cập nhật".utf8)
        let signature = try UpdateSignature.sign(data, privateKey: key.rawRepresentation.base64EncodedString())
        #expect(UpdateSignature.isValid(signature, for: data, publicKey: publicKey))
        #expect(!UpdateSignature.isValid(signature, for: data + Data([0]), publicKey: publicKey))
        #expect(!UpdateSignature.isValid(signature, for: data, publicKey: other.publicKey.rawRepresentation.base64EncodedString()))
        #expect(!UpdateSignature.isValid("không phải base64", for: data, publicKey: publicKey))
    }

    @Test func manifestRejectsMalformedFields() throws {
        let fixture = try UpdateFixture()
        defer { fixture.cleanup() }
        let release = try fixture.makeRelease(version: "1.1.0")
        #expect(try UpdateManifest.decode(release.manifest.encoded()) == release.manifest)

        var badHash = release.manifest
        badHash.sha256 = "xyz"
        #expect(throws: UpdateError.invalidManifest("sha256 sai định dạng")) { try UpdateManifest.decode(badHash.encoded()) }
        var badVersion = release.manifest
        badVersion.version = "mới nhất"
        #expect(throws: UpdateError.self) { try UpdateManifest.decode(badVersion.encoded()) }
        var tooBig = release.manifest
        tooBig.size = UpdateClient.maxArchiveSize + 1
        #expect(throws: UpdateError.archiveTooLarge) { try UpdateManifest.decode(tooBig.encoded()) }
    }

    @Test func reportsNewerVersionOnly() async throws {
        let fixture = try UpdateFixture()
        defer { fixture.cleanup() }
        let release = try fixture.makeRelease(version: "1.1.0")
        let client = UpdateClient(feed: UpdateFeed(manifestURL: release.manifestURL, allowedHosts: nil))
        #expect(try await client.check(currentVersion: "1.0.0") == .available(release.manifest))
        #expect(try await client.check(currentVersion: "1.1") == .upToDate)
        #expect(try await client.check(currentVersion: "2.0.0") == .upToDate)
    }

    @Test func refusesArchiveOutsideAllowedHosts() async throws {
        let fixture = try UpdateFixture()
        defer { fixture.cleanup() }
        let release = try fixture.makeRelease(version: "1.1.0", publishedURL: URL(string: "https://evil.example.com/Thaigit.zip"))
        let client = UpdateClient(feed: UpdateFeed(manifestURL: release.manifestURL, allowedHosts: ["github.com"]))
        await #expect(throws: UpdateError.untrustedURL("https://evil.example.com/Thaigit.zip")) {
            try await client.check(currentVersion: "1.0.0")
        }
    }

    @Test func downloadsVerifiesAndSwapsInstalledApp() async throws {
        let fixture = try UpdateFixture()
        defer { fixture.cleanup() }
        let installed = try fixture.makeApp(version: "1.0.0", in: fixture.root.appendingPathComponent("Applications"))
        let release = try fixture.makeRelease(version: "1.1.0")
        let client = UpdateClient(feed: UpdateFeed(manifestURL: release.manifestURL, allowedHosts: nil))
        guard case .available(let manifest) = try await client.check(currentVersion: "1.0.0") else {
            Issue.record("phải thấy bản 1.1.0")
            return
        }
        let archive = try await client.download(manifest, into: fixture.staging.appendingPathComponent("downloads"))
        let staged = try await fixture.installer().stage(archive: archive, manifest: manifest)
        #expect(staged.version == "1.1.0")
        #expect(staged.notes == "Ghi chú 1.1.0")

        try UpdateInstaller.install(staged, replacing: installed)
        let info = try UpdateInstaller.infoDictionary(of: installed)
        #expect(info["CFBundleShortVersionString"] as? String == "1.1.0")
        // Không để lại app cũ hay thư mục chờ cài.
        let leftovers = try FileManager.default.contentsOfDirectory(atPath: installed.deletingLastPathComponent().path)
        #expect(leftovers == ["Thaigit.app"])
        #expect(!FileManager.default.fileExists(atPath: staged.appURL.deletingLastPathComponent().path))
    }

    @Test func rejectsTamperedOrForeignArchives() async throws {
        let fixture = try UpdateFixture()
        defer { fixture.cleanup() }
        let installer = fixture.installer()

        // Một byte bị sửa sau khi ký.
        let tampered = try fixture.makeRelease(version: "1.1.0")
        var bytes = try Data(contentsOf: tampered.archive)
        bytes[bytes.count / 2] ^= 0xFF
        try bytes.write(to: tampered.archive)
        await #expect(throws: UpdateError.checksumMismatch) { try await installer.stage(archive: tampered.archive, manifest: tampered.manifest) }

        // Ký bằng khoá khác (checksum vẫn đúng).
        let foreign = try fixture.makeRelease(version: "1.2.0", signingKey: Curve25519.Signing.PrivateKey())
        await #expect(throws: UpdateError.badSignature) { try await installer.stage(archive: foreign.archive, manifest: foreign.manifest) }

        // Gói của app khác.
        let otherApp = try fixture.makeRelease(version: "1.3.0", bundleIdentifier: "com.example.other")
        await #expect(throws: UpdateError.invalidBundle("mã ứng dụng không khớp")) {
            try await installer.stage(archive: otherApp.archive, manifest: otherApp.manifest)
        }

        // update.json nói 9.9.9 nhưng gói bên trong là 1.4.0 (chặn ép cài bản cũ bằng số phiên bản giả).
        let mislabeled = try fixture.makeRelease(version: "1.4.0", manifestVersion: "9.9.9")
        await #expect(throws: UpdateError.invalidBundle("phiên bản trong gói khác thông tin phát hành")) {
            try await installer.stage(archive: mislabeled.archive, manifest: mislabeled.manifest)
        }
    }
}

/// Dựng app giả (có mã thực thi ký ad-hoc), file zip, update.json đã ký trong thư mục tạm.
private struct UpdateFixture {
    static let bundleIdentifier = "com.phanthai.thaigit"
    let root: URL
    let staging: URL
    let signingKey = Curve25519.Signing.PrivateKey()

    init() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent("thaigit-update-\(UUID().uuidString)", isDirectory: true)
        staging = root.appendingPathComponent("Updates", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }

    func cleanup() { try? FileManager.default.removeItem(at: root) }

    func installer() -> UpdateInstaller {
        UpdateInstaller(
            bundleIdentifier: Self.bundleIdentifier,
            publicKey: signingKey.publicKey.rawRepresentation.base64EncodedString(),
            stagingDirectory: staging
        )
    }

    func makeApp(version: String, bundleIdentifier: String = Self.bundleIdentifier, in folder: URL) throws -> URL {
        let app = folder.appendingPathComponent("Thaigit.app", isDirectory: true)
        let macOS = app.appendingPathComponent("Contents/MacOS", isDirectory: true)
        try FileManager.default.createDirectory(at: macOS, withIntermediateDirectories: true)
        try FileManager.default.copyItem(atPath: "/usr/bin/true", toPath: macOS.appendingPathComponent("Thaigit").path)
        let info: [String: Any] = [
            "CFBundleIdentifier": bundleIdentifier,
            "CFBundleExecutable": "Thaigit",
            "CFBundlePackageType": "APPL",
            "CFBundleShortVersionString": version,
            "CFBundleVersion": "1",
        ]
        let plist = try PropertyListSerialization.data(fromPropertyList: info, format: .xml, options: 0)
        try plist.write(to: app.appendingPathComponent("Contents/Info.plist"))
        try run("/usr/bin/codesign", "--force", "--sign", "-", app.path)
        return app
    }

    struct Release {
        let archive: URL
        let manifest: UpdateManifest
        let manifestURL: URL
    }

    func makeRelease(
        version: String,
        manifestVersion: String? = nil,
        bundleIdentifier: String = Self.bundleIdentifier,
        signingKey: Curve25519.Signing.PrivateKey? = nil,
        publishedURL: URL? = nil
    ) throws -> Release {
        let folder = root.appendingPathComponent("release-\(version)", isDirectory: true)
        let app = try makeApp(version: version, bundleIdentifier: bundleIdentifier, in: folder.appendingPathComponent("build"))
        let archive = folder.appendingPathComponent("Thaigit-\(version).zip")
        try run("/usr/bin/ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", app.path, archive.path)
        let data = try Data(contentsOf: archive)
        let key = signingKey ?? self.signingKey
        let manifest = UpdateManifest(
            version: manifestVersion ?? version,
            url: publishedURL ?? archive,
            size: data.count,
            sha256: UpdateSignature.sha256Hex(data),
            signature: try key.signature(for: data).base64EncodedString(),
            notes: "Ghi chú \(version)",
            minimumSystemVersion: "14.0",
            publishedAt: Date(timeIntervalSince1970: 1_790_000_000)
        )
        let manifestURL = folder.appendingPathComponent("update.json")
        try manifest.encoded().write(to: manifestURL)
        return Release(archive: archive, manifest: manifest, manifestURL: manifestURL)
    }

    private func run(_ executable: String, _ arguments: String...) throws {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try process.run()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            throw UpdateError.cannotInstall("\(executable) thất bại (\(process.terminationStatus))")
        }
    }
}
