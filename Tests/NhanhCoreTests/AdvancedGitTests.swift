import Foundation
import Testing
@testable import NhanhCore

@Suite("Ký commit, submodule, worktree, LFS, Git Flow")
struct AdvancedGitTests {
    @Test func detectsAndVerifiesSSHSignature() async throws {
        let t = try await TestRepo.make()
        defer { t.cleanup() }
        let keyDirectory = t.url.appendingPathComponent(".khoa")
        try FileManager.default.createDirectory(at: keyDirectory, withIntermediateDirectories: true)
        let key = keyDirectory.appendingPathComponent("id_test")
        let generated = try await ProcessRunner.run(executable: URL(fileURLWithPath: "/usr/bin/ssh-keygen"),
                                                    arguments: ["-q", "-t", "ed25519", "-N", "", "-C", "test@example.com", "-f", key.path])
        #expect(generated.exitCode == 0)
        try Data("/.khoa/\n".utf8).write(to: t.url.appendingPathComponent(".gitignore"))

        try t.write("a.txt", "1\n")
        try await t.commitAll("chưa ký")
        let unsigned = try await t.repo.resolveCommit("HEAD")

        try await t.repo.configureSigning(CommitSigningConfig(signCommits: true, signTags: false, format: .ssh, key: key.path), global: false)
        let config = await t.repo.signingConfig()
        #expect(config == CommitSigningConfig(signCommits: true, signTags: false, format: .ssh, key: key.path))
        try t.write("a.txt", "2\n")
        try await t.commitAll("đã ký")
        let signed = try await t.repo.resolveCommit("HEAD")

        #expect(await t.repo.signatureFormat(of: unsigned) == nil)
        #expect(await t.repo.signatureFormat(of: signed) == .ssh)
        #expect(await t.repo.verifySignature(of: unsigned) == .unsigned)

        // The repo sets gpg.ssh.program to an odd command: verification still uses the real ssh-keygen and never runs the odd command.
        let marker = t.url.appendingPathComponent("da-chay")
        try t.write("evil.sh", "#!/bin/sh\ntouch '\(marker.path)'\nexit 1\n")
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: t.url.appendingPathComponent("evil.sh").path)
        try await t.git("config", "gpg.ssh.program", t.url.appendingPathComponent("evil.sh").path)
        let publicKey = try String(contentsOf: key.appendingPathExtension("pub"), encoding: .utf8)
        let allowed = keyDirectory.appendingPathComponent("allowed_signers")
        try Data("test@example.com namespaces=\"git\" \(publicKey)".utf8).write(to: allowed)
        try await t.git("config", "gpg.ssh.allowedSignersFile", allowed.path)
        let verification = await t.repo.verifySignature(of: signed)
        guard case .good = verification else {
            Issue.record("Chữ ký phải hợp lệ, nhận \(verification)")
            return
        }
        #expect(!FileManager.default.fileExists(atPath: marker.path))

        // Signing off: the key is kept, only commit.gpgsign changes.
        try await t.repo.configureSigning(CommitSigningConfig(signCommits: false, signTags: false, format: .ssh, key: nil), global: false)
        #expect(await t.repo.signingConfig() == CommitSigningConfig(signCommits: false, signTags: false, format: .ssh, key: key.path))
    }

    @Test func parsesSignatureOutputs() {
        #expect(GitRepository.signatureFormat(inCommitObject: "tree a\nparent b\nauthor x\ncommitter y\ngpgsig -----BEGIN PGP SIGNATURE-----\n \n -----END PGP SIGNATURE-----\n\ngpgsig trong lời commit\n")
                == .openpgp)
        #expect(GitRepository.signatureFormat(inCommitObject: "tree a\nauthor x\n\nkhông ký\ngpgsig -----BEGIN SSH SIGNATURE-----\n") == nil)
        #expect(GitRepository.parseVerification("U\u{1F}An <an@x.vn>\u{1F}ABCD\n") == .good(signer: "An <an@x.vn>", key: "ABCD", trusted: false))
        #expect(GitRepository.parseVerification("E\u{1F}\u{1F}ABCD") == .cannotCheck(key: "ABCD"))
        let colons = """
        sec:u:255:22:1234ABCD5678EF90:1700000000:::u:::scESC:::+:::23::0:
        fpr:::::::::0123456789ABCDEF1234ABCD5678EF90:
        uid:u::::1700000000::HASH::Phan Thái <thai@example.com>::::::::::0:
        sec:u:255:22:FFFF0000FFFF0000:1700000000:::u:::scESC:::+:::23::0:
        uid:u::::1700000000::HASH::Công ty <cty@example.com>::::::::::0:
        """
        #expect(GitRepository.parseGPGSecretKeys(colons) == [
            GPGSecretKey(id: "1234ABCD5678EF90", userID: "Phan Thái <thai@example.com>"),
            GPGSecretKey(id: "FFFF0000FFFF0000", userID: "Công ty <cty@example.com>"),
        ])
    }

    @Test func listsAndUpdatesSubmodules() async throws {
        let library = try await TestRepo.make()
        defer { library.cleanup() }
        try library.write("lib.txt", "thư viện\n")
        try await library.commitAll("thư viện")

        let app = try await TestRepo.make()
        defer { app.cleanup() }
        try await app.git("config", "protocol.file.allow", "always")
        try await app.git("-c", "protocol.file.allow=always", "submodule", "add", library.url.path, "libs/thu-vien")
        try await app.commitAll("thêm submodule")

        var modules = try await app.repo.submodules()
        #expect(modules.map(\.path) == ["libs/thu-vien"])
        #expect(modules.first?.state == .upToDate)

        try await app.git("submodule", "deinit", "-f", "libs/thu-vien")
        modules = try await app.repo.submodules()
        #expect(modules.first?.state == .uninitialized)

        try await app.repo.updateSubmodules(["libs/thu-vien"])
        modules = try await app.repo.submodules()
        #expect(modules.first?.state == .upToDate)
        #expect(FileManager.default.fileExists(atPath: app.url.appendingPathComponent("libs/thu-vien/lib.txt").path))

        #expect(GitRepository.parseSubmoduleStatus(" abc123 a/b (v1.0-2-gabc)\n+def456 c d (heads/main)\n-0000 e\n").map(\.path) == ["a/b", "c d", "e"])
    }

    @Test func managesWorktrees() async throws {
        let t = try await TestRepo.make()
        defer { t.cleanup() }
        try t.write("a.txt", "1\n")
        try await t.commitAll("gốc")
        let path = t.url.deletingLastPathComponent().appendingPathComponent("wt-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: path) }

        try await t.repo.addWorktree(path: path.path, branch: "sua-gap", createBranch: true, startPoint: "main")
        var list = try await t.repo.worktrees()
        #expect(list.count == 2)
        #expect(list[0].isMain && list[0].branch == "main")
        #expect(list[1].branch == "sua-gap" && !list[1].isMain)
        #expect(URL(fileURLWithPath: list[1].path).resolvingSymlinksInPath().path == path.resolvingSymlinksInPath().path)

        try await t.repo.removeWorktree(path: path.path, force: false)
        list = try await t.repo.worktrees()
        #expect(list.count == 1)
    }

    @Test func gitFlowStartAndFinish() async throws {
        let t = try await TestRepo.make()
        defer { t.cleanup() }
        try t.write("a.txt", "1\n")
        try await t.commitAll("gốc")
        #expect(await t.repo.gitFlowConfig() == nil)

        let config = GitFlowConfig(versionTagPrefix: "v")
        try await t.repo.initGitFlow(config)
        #expect(await t.repo.gitFlowConfig() == config)
        #expect(config.classify("feature/dang-nhap")?.kind == .feature)
        #expect(config.classify("main") == nil)

        try await t.repo.startFlow(.feature, name: "dang-nhap", config: config)
        try t.write("login.txt", "đăng nhập\n")
        try await t.commitAll("tính năng đăng nhập")
        try await t.repo.finishFlow(.feature, name: "dang-nhap", config: config)
        var refs = try await t.repo.refs()
        #expect(!refs.contains { $0.name == "feature/dang-nhap" })
        #expect(try await t.git("log", "--format=%s", "develop").contains("tính năng đăng nhập"))
        #expect(try await t.git("log", "--format=%s", "main").contains("tính năng đăng nhập") == false)

        try await t.repo.startFlow(.release, name: "1.0", config: config)
        try t.write("VERSION", "1.0\n")
        try await t.commitAll("phiên bản 1.0")
        try await t.repo.finishFlow(.release, name: "1.0", config: config)
        refs = try await t.repo.refs()
        #expect(refs.contains { $0.kind == .tag && $0.name == "v1.0" })
        #expect(!refs.contains { $0.name == "release/1.0" })
        #expect(try await t.git("log", "--format=%s", "main").contains("tính năng đăng nhập"))
        #expect(try await t.git("log", "--format=%s", "develop").contains("phiên bản 1.0"))
        #expect(try await t.repo.status().head.branchName == "develop")

        // A conflict mid-way: report the stopping step and the remaining steps.
        try await t.repo.startFlow(.hotfix, name: "1.0.1", config: config)
        try t.write("VERSION", "1.0.1\n")
        try await t.commitAll("sửa gấp")
        try await t.git("switch", "develop")
        try t.write("VERSION", "2.0-dev\n")
        try await t.commitAll("develop đi tiếp")
        do {
            try await t.repo.finishFlow(.hotfix, name: "1.0.1", config: config)
            Issue.record("Phải dừng vì conflict ở develop")
        } catch let error as GitFlowStepError {
            #expect(error.step == "Merge hotfix/1.0.1 vào develop")
            #expect(error.remaining == ["Xoá nhánh hotfix/1.0.1"])
        }
        #expect(try await t.repo.refs().contains { $0.kind == .tag && $0.name == "v1.0.1" })
    }

    @Test func readsLFSPatterns() {
        let attributes = "*.psd filter=lfs diff=lfs merge=lfs -text\n# *.zip filter=lfs\n*.txt text\nassets/** filter=lfs diff=lfs merge=lfs -text\n"
        #expect(GitRepository.lfsPatterns(inAttributes: attributes) == ["*.psd", "assets/**"])
    }
}
