import Foundation
import Testing
@testable import NhanhCore

@Suite("Khoá SSH của Thaigit")
struct SSHKeyTests {
    private func temporaryDirectory() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("thaigit-ssh-test-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    private func keygen(_ arguments: [String], input: Data? = nil) async throws -> ProcessOutput {
        try await ProcessRunner.run(executable: URL(fileURLWithPath: "/usr/bin/ssh-keygen"), arguments: arguments,
                                    environment: ["PATH": "/usr/bin:/bin"], input: input)
    }

    @Test func generatedKeyIsReadableByOpenSSH() async throws {
        let generated = SSHKeyFormat.generateEd25519(comment: "thai@may")
        #expect(generated.publicKey.type == "ssh-ed25519")
        #expect(generated.publicKey.line.hasPrefix("ssh-ed25519 AAAA"))
        #expect(generated.publicKey.line.hasSuffix(" thai@may"))

        let directory = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("id")
        try generated.privateKey.write(to: file)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)

        let derived = try await keygen(["-y", "-f", file.path]).stdoutString
        #expect(SSHPublicKey(line: derived)?.blob == generated.publicKey.blob)
        let fingerprint = try await keygen(["-l", "-f", file.path]).stdoutString
        #expect(fingerprint.contains(generated.publicKey.fingerprint))
    }

    @Test func inspectsOpenSSHKeysIncludingEncrypted() async throws {
        let directory = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("enc")
        _ = try await keygen(["-q", "-t", "ed25519", "-N", "mat-khau", "-C", "x", "-f", file.path])
        let privateKey = try Data(contentsOf: file)
        let publicLine = try String(contentsOf: directory.appendingPathComponent("enc.pub"), encoding: .utf8)

        let inspected = try #require(SSHKeyFormat.inspectOpenSSH(privateKey))
        #expect(inspected.encrypted)
        #expect(inspected.publicKey.blob == SSHPublicKey(line: publicLine)?.blob)

        let plain = SSHKeyFormat.generateEd25519(comment: "")
        #expect(SSHKeyFormat.inspectOpenSSH(plain.privateKey)?.encrypted == false)
        #expect(SSHKeyFormat.inspectOpenSSH(Data("không phải khoá".utf8)) == nil)
    }

    @Test func keyringStoresSecretsSeparatelyAndRejectsDuplicates() throws {
        let storage = InMemorySettingsStorage()
        let secrets = InMemorySSHKeyStore()
        let keyring = SSHKeyring(storage: storage, secrets: secrets)
        let info = try keyring.generate(name: "Máy công ty", comment: "a@b")
        #expect(keyring.keys.map(\.name) == ["Máy công ty"])
        #expect(keyring.privateKeys().count == 1)
        // The stored settings hold no secret.
        let saved = String(decoding: storage.data(forKey: SSHKeyring.listKey) ?? Data(), as: UTF8.self)
        #expect(!saved.contains("PRIVATE KEY"))

        let privateKey = try #require(try secrets.read(id: info.id))
        #expect(throws: SSHKeyError.duplicate) { try keyring.importKey(name: "Lại", privateKey: privateKey, publicKey: nil) }
        #expect(throws: SSHKeyError.unsupportedFormat) {
            try keyring.importKey(name: "Pub", privateKey: Data(info.publicKey.utf8), publicKey: nil)
        }

        keyring.isEnabled = false
        #expect(keyring.privateKeys().isEmpty)
        keyring.isEnabled = true

        let reopened = SSHKeyring(storage: storage, secrets: secrets)
        reopened.rename(id: info.id, to: "  Laptop ")
        #expect(reopened.keys.first?.name == "Laptop")
        try reopened.remove(id: info.id)
        #expect(reopened.keys.isEmpty)
        #expect(try secrets.read(id: info.id) == nil)
    }

    @Test func detectsSSHRemotes() {
        #expect(SSHRemoteURL.isSSH("git@github.com:owner/repo.git"))
        #expect(SSHRemoteURL.isSSH("ssh://git@gitlab.cong-ty.vn:2222/nhom/repo.git"))
        #expect(SSHRemoteURL.isSSH("git+ssh://git@github.com/a/b"))
        #expect(!SSHRemoteURL.isSSH("https://github.com/owner/repo.git"))
        #expect(!SSHRemoteURL.isSSH("/Users/a/repo"))
        #expect(!SSHRemoteURL.isSSH("../repo"))
        #expect(!SSHRemoteURL.isSSH("file:///tmp/repo"))
        #expect(SSHRemoteURL.host(of: "git@GitHub.com:owner/repo.git") == "github.com")
        #expect(SSHRemoteURL.host(of: "ssh://git@gitlab.cong-ty.vn:2222/nhom/repo.git") == "gitlab.cong-ty.vn")
    }

    @Test func agentSessionLoadsKeysWithoutFilesAndCleansUp() async throws {
        let generated = SSHKeyFormat.generateEd25519(comment: "agent-test")
        let session = try await SSHAgentSession.start(keys: [generated.privateKey], environment: ["PATH": "/usr/bin:/bin"])
        let listed = try await ProcessRunner.run(
            executable: URL(fileURLWithPath: SSHAgentSession.addPath), arguments: ["-l"],
            environment: ["PATH": "/usr/bin:/bin", "SSH_AUTH_SOCK": session.socketPath]
        )
        #expect(listed.stdoutString.contains(generated.publicKey.fingerprint))
        let socket = session.socketPath
        session.stop()
        #expect(!FileManager.default.fileExists(atPath: socket))
    }
}
