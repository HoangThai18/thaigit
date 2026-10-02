import Foundation
import Testing
@testable import NhanhCore

@Suite("Nhiều tài khoản GitHub: token theo owner cho lệnh git (không đụng Keychain / cài đặt thật)")
struct GitHubCredentialTests {
    static let personal = GitHubAccount(id: 583231, login: "octocat", name: "The Octocat",
                                        avatarURL: URL(string: "https://avatars.githubusercontent.com/u/583231?v=4"))
    static let company = GitHubAccount(id: 9919, login: "thai-congty", name: "Thái (Công ty)", avatarURL: nil)

    /// Hai tài khoản: cá nhân (mặc định) và công ty (thành viên tổ chức Cong-Ty-ABC).
    static func twoAccounts() -> (state: GitHubAccountsState, tokens: [String: String]) {
        var state = GitHubAccountsState()
        state.upsert(personal, organizations: ["nhom-mo"])
        state.upsert(company, organizations: ["Cong-Ty-ABC", "nhom-mo"])
        return (state, ["octocat": "gho_canhan111", "thai-congty": "gho_congty222"])
    }

    static func credentialSet(helperPath: String = "/tmp/helper.sh") -> GitHubCredentialSet {
        let (state, tokens) = twoAccounts()
        return GitHubCredentialSet(helperPath: helperPath, state: state, tokens: tokens)!
    }

    // MARK: - Bảng owner → tài khoản

    @Test func ownerTableFollowsPriorityRules() {
        var (state, _) = Self.twoAccounts()
        #expect(state.defaultProfile?.login == "octocat")

        // Owner trùng login (không phân biệt hoa thường).
        #expect(state.resolve(owner: "OctoCat")?.profile.login == "octocat")
        #expect(state.resolve(owner: "thai-congty")?.match == .login)
        // Tổ chức: chỉ tài khoản công ty là thành viên.
        #expect(state.resolve(owner: "cong-ty-abc") == GitHubAccountsState.Resolution(profile: state.profiles[1], match: .organization))
        // Hai tài khoản cùng tổ chức: tài khoản mặc định trước.
        #expect(state.resolve(owner: "nhom-mo")?.profile.login == "octocat")
        state.setDefault(login: "thai-congty")
        #expect(state.resolve(owner: "nhom-mo")?.profile.login == "thai-congty")
        state.setDefault(login: "octocat")
        // Owner lạ: tài khoản mặc định.
        #expect(state.resolve(owner: "nguoi-la") == GitHubAccountsState.Resolution(profile: state.profiles[0], match: .fallback))
        #expect(state.resolve(owner: nil)?.match == .fallback)

        // Người dùng tự gán thắng mọi quy tắc khác, kể cả owner trùng login.
        state.assign(owner: "Du-An-Cu", to: "thai-congty")
        state.assign(owner: "thai-congty", to: "octocat")
        #expect(state.resolve(owner: "du-an-cu")?.match == .assigned)
        #expect(state.resolve(owner: "du-an-cu")?.profile.login == "thai-congty")
        #expect(state.resolve(owner: "thai-congty")?.profile.login == "octocat")
        #expect(state.ownerTable == [
            "octocat": "octocat", "thai-congty": "octocat", "cong-ty-abc": "thai-congty", "nhom-mo": "octocat",
            "du-an-cu": "thai-congty",
        ])
        // Owner không hợp lệ bị bỏ qua; bỏ gán.
        state.assign(owner: "khong hop le", to: "octocat")
        state.assign(owner: "thai-congty", to: nil)
        #expect(state.ownerAssignments == ["du-an-cu": "thai-congty"])

        // Xoá tài khoản: bỏ các owner đã gán cho nó, mặc định chuyển sang tài khoản còn lại.
        state.setDefault(login: "thai-congty")
        state.remove(login: "thai-congty")
        #expect(state.ownerAssignments.isEmpty)
        #expect(state.defaultLogin == "octocat")
        #expect(state.resolve(owner: "cong-ty-abc")?.match == .fallback)
    }

    @Test func profileKeepsEditedCommitIdentityOnRelogin() {
        var state = GitHubAccountsState()
        state.upsert(Self.company, organizations: nil)
        let profile = state.profiles[0]
        #expect(profile.commitName == "Thái (Công ty)")
        #expect(profile.commitEmail == "9919+thai-congty@users.noreply.github.com")
        #expect(GitHubAccountProfile(account: GitHubAccount(id: 1, login: "khong-ten", name: nil, avatarURL: nil)).commitName == "khong-ten")

        state.setCommitIdentity(login: "thai-congty", name: "Phan Thái", email: "thai@congty.vn")
        state.upsert(GitHubAccount(id: 9919, login: "thai-congty", name: "Tên mới", avatarURL: nil), organizations: ["Cong-Ty-ABC"])
        #expect(state.profiles.count == 1)
        #expect(state.profiles[0].account.name == "Tên mới")
        #expect(state.profiles[0].commitName == "Phan Thái")
        #expect(state.profiles[0].commitEmail == "thai@congty.vn")
        #expect(state.profiles[0].organizations == ["Cong-Ty-ABC"])
        // Để trống: quay về tên GitHub + email noreply.
        state.setCommitIdentity(login: "thai-congty", name: " ", email: "")
        #expect(state.profiles[0].commitName == "Tên mới")
        #expect(state.profiles[0].commitEmail == "9919+thai-congty@users.noreply.github.com")
    }

    @Test func readsOwnerFromRemoteURLs() {
        let cases: [(String, String?)] = [
            ("https://github.com/Cong-Ty-ABC/du-an.git", "Cong-Ty-ABC"),
            ("https://octocat@github.com/octocat/hello", "octocat"),
            ("git@github.com:thai-congty/app.git", "thai-congty"),
            ("ssh://git@github.com/nhom-mo/repo", "nhom-mo"),
            ("ssh://git@ssh.github.com:443/octocat/x.git", "octocat"),
            ("https://gitlab.com/octocat/x.git", nil),
            ("git@gitlab.com:octocat/x.git", nil),
            ("/Users/thai/du-an", nil),
            ("https://github.com/", nil),
        ]
        for (url, owner) in cases {
            #expect(GitHubRemoteURL.owner(of: url) == owner, "\(url)")
        }
        #expect(GitHubRemoteURL.isHTTPS("https://github.com/a/b.git"))
        #expect(!GitHubRemoteURL.isHTTPS("git@github.com:a/b.git"))
        #expect(!GitHubRemoteURL.isHTTPS("https://gitlab.com/a/b.git"))
    }

    // MARK: - Tham số / biến môi trường cho git

    @Test func addsHelperOnlyForGitHubURLsOfTheCommand() {
        let set = Self.credentialSet(helperPath: "/Users/thai/Library/Application Support/Thaigit/github-credential.sh")
        let expectedArguments = [
            "-c", "credential.https://github.com.helper=",
            "-c", "credential.https://github.com.helper=!'/Users/thai/Library/Application Support/Thaigit/github-credential.sh'",
            "-c", "credential.https://github.com.useHttpPath=true",
        ]
        // Một remote của tổ chức Cong-Ty-ABC: chỉ token tài khoản công ty; owner lạ (repo đổi owner) dùng luôn tài khoản đó.
        let company = GitCredentialInjection.additions(forURLs: ["https://github.com/Cong-Ty-ABC/du-an.git"], credentials: set)
        #expect(company.arguments == expectedArguments)
        #expect(company.environment == [
            "THAIGIT_GITHUB_ACCOUNTS": "1",
            "THAIGIT_GITHUB_USER_0": "thai-congty", "THAIGIT_GITHUB_TOKEN_0": "gho_congty222",
            "THAIGIT_GITHUB_DEFAULT": "0",
            "THAIGIT_GITHUB_OWNERS": "cong-ty-abc:0",
        ])
        // Nhiều remote (fetch --all): đúng các tài khoản của chúng, không có tài khoản mặc định cho owner lạ.
        let all = GitCredentialInjection.additions(forURLs: [
            "https://github.com/octocat/a.git", "https://github.com/nhom-mo/b", "https://github.com/cong-ty-abc/c",
            "https://gitlab.com/cong-ty-abc/d.git",
        ], credentials: set)
        #expect(all.arguments == expectedArguments)
        #expect(all.environment == [
            "THAIGIT_GITHUB_ACCOUNTS": "2",
            "THAIGIT_GITHUB_USER_0": "octocat", "THAIGIT_GITHUB_TOKEN_0": "gho_canhan111",
            "THAIGIT_GITHUB_USER_1": "thai-congty", "THAIGIT_GITHUB_TOKEN_1": "gho_congty222",
            "THAIGIT_GITHUB_OWNERS": "cong-ty-abc:1,nhom-mo:0,octocat:0",
        ])
        // Username trong URL trùng login: script chọn theo username, không cần bảng owner.
        let byUser = GitCredentialInjection.additions(forURLs: ["https://Thai-CongTy@github.com/octocat/x.git"], credentials: set)
        #expect(byUser.environment["THAIGIT_GITHUB_USER_0"] == "thai-congty")
        #expect(byUser.environment["THAIGIT_GITHUB_ACCOUNTS"] == "1")
        #expect(byUser.environment["THAIGIT_GITHUB_OWNERS"] == "")
        // Tham số lệnh không chứa token.
        #expect(![company, all, byUser].contains { $0.arguments.joined(separator: " ").contains("gho_") })

        // Không chạm https://github.com: không thêm gì.
        let notGitHub: [[String]] = [
            [], ["https://gitlab.com/octocat/x.git"], ["git@github.com:octocat/x.git"], ["ssh://git@github.com/octocat/x"],
            ["https://www.github.com/octocat/x"], ["/Users/thai/du-an"], ["."], ["https://github.com.evil.vn/octocat/x"],
        ]
        for urls in notGitHub {
            #expect(GitCredentialInjection.additions(forURLs: urls, credentials: set) == .none, "\(urls)")
        }
        // Chưa đăng nhập: không thêm gì (helper trả lời rỗng làm hỏng helper riêng của người dùng).
        #expect(GitCredentialInjection.additions(forURLs: ["https://github.com/octocat/x"], credentials: nil).isEmpty)
        // Đường dẫn có dấu nháy đơn vẫn được trích dẫn đúng cho shell.
        #expect(GitHubCredentialHelper.configValue(path: "/Users/O'Neil/x.sh") == #"!'/Users/O'\''Neil/x.sh'"#)
    }

    @Test func credentialSetMatchesHelperRules() throws {
        let (state, tokens) = Self.twoAccounts()
        let set = Self.credentialSet()
        #expect(set.defaultLogin == "octocat")
        #expect(set.credential(forOwner: "Cong-Ty-ABC")?.login == "thai-congty")
        #expect(set.credential(forOwner: "octocat")?.token == "gho_canhan111")
        #expect(set.credential(forOwner: "nguoi-la")?.login == "octocat")
        #expect(set.credential(forOwner: nil)?.login == "octocat")
        #expect(set.credential(forURL: "https://THAI-CONGTY@github.com/octocat/x")?.login == "thai-congty")
        #expect(set.credential(forURL: "https://nguoi-la@github.com/octocat/x")?.login == "octocat")

        // Tài khoản công ty chưa nạp được token: owner của nó KHÔNG dùng token tài khoản khác.
        let partial = try #require(GitHubCredentialSet(helperPath: "/tmp/h", state: state, tokens: ["octocat": tokens["octocat"]!]))
        #expect(partial.accounts.map(\.login) == ["octocat"])
        #expect(partial.credential(forOwner: "cong-ty-abc") == nil)
        #expect(GitCredentialInjection.additions(forURLs: ["https://github.com/cong-ty-abc/x"], credentials: partial).environment == [
            "THAIGIT_GITHUB_ACCOUNTS": "0", "THAIGIT_GITHUB_OWNERS": "cong-ty-abc:-",
        ])
        // Mặc định không có token: không tự nâng tài khoản còn lại lên làm mặc định.
        let onlyCompany = try #require(GitHubCredentialSet(helperPath: "/tmp/h", state: state, tokens: ["thai-congty": "gho_congty222"]))
        #expect(onlyCompany.defaultLogin == "octocat")
        #expect(onlyCompany.credential(forOwner: "nguoi-la") == nil)
        #expect(onlyCompany.credential(forOwner: "cong-ty-abc")?.login == "thai-congty")
        #expect(GitHubCredentialSet(helperPath: "/tmp/h", state: state, tokens: [:]) == nil)
        #expect(GitHubCredentialSet(helperPath: "/tmp/h", state: GitHubAccountsState(), tokens: tokens) == nil)
    }

    @Test func credentialRejectsUnsafeValuesAndNeverPrintsToken() throws {
        #expect(GitHubCredential(login: "", token: "gho_x") == nil)
        #expect(GitHubCredential(login: "octocat", token: "") == nil)
        // Xuống dòng sẽ chèn được dòng `key=value` lạ vào giao thức credential của git.
        #expect(GitHubCredential(login: "octocat", token: "gho_x\nusername=ke-gian") == nil)
        #expect(GitHubCredential(login: "octo cat", token: "gho_x") == nil)

        let credential = try #require(GitHubCredential(login: "octocat", token: "gho_bimat123"))
        #expect(!String(describing: credential).contains("gho_bimat123"))
        #expect(!String(reflecting: credential).contains("gho_bimat123"))
        var dumped = ""
        dump(credential, to: &dumped)
        #expect(!dumped.contains("gho_bimat123"))
        #expect(dumped.contains("octocat"))
    }

    /// `git` giả ghi lại tham số + biến môi trường nhận được: kiểm tra GitRunner thêm token đúng chỗ.
    @Test func runnerPassesTokensOnlyToNetworkCommands() async throws {
        let directory = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let log = directory.appendingPathComponent("calls.log")
        let fakeGit = directory.appendingPathComponent("git")
        try Data(#"""
        #!/bin/sh
        {
          echo "---"
          for argument in "$@"; do printf 'arg:%s\n' "$argument"; done
          printf 'owners:%s\n' "$THAIGIT_GITHUB_OWNERS"
          printf 'token0:%s\n' "$THAIGIT_GITHUB_TOKEN_0"
          printf 'token1:%s\n' "$THAIGIT_GITHUB_TOKEN_1"
        } >> "$FAKE_GIT_LOG"

        """#.utf8).write(to: fakeGit)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: fakeGit.path)

        let store = GitEnvironmentStore(GitEnvironment(executable: fakeGit, variables: ["PATH": "/usr/bin:/bin", "FAKE_GIT_LOG": log.path]))
        let records = LockedBox([GitCommandRecord]())
        let runner = GitRunner(environmentStore: store, workingDirectory: directory) { record in
            records.withValue { $0.append(record) }
        }

        let set = Self.credentialSet()
        let origin = ["https://github.com/cong-ty-abc/du-an.git"]
        store.githubCredentials = set
        try await runner.run(["fetch", "--progress", "origin"], credentialURLs: origin)
        try await runner.run(["status", "--porcelain=v2"])
        // Đăng xuất hết: runner đang dùng (repo đang mở) thấy ngay ở lệnh kế tiếp.
        store.githubCredentials = nil
        try await runner.run(["push", "origin", "main"], credentialURLs: origin)

        let calls = try String(contentsOf: log, encoding: .utf8)
            .components(separatedBy: "---\n")
            .filter { !$0.isEmpty }
            .map(FakeGitCall.init)
        #expect(calls.count == 3)
        guard calls.count == 3 else { return }
        let injected = GitCredentialInjection.additions(forURLs: origin, credentials: set)
        #expect(calls[0].arguments == GitRunner.globalArguments + injected.arguments + ["fetch", "--progress", "origin"])
        #expect(calls[0].values["owners"] == "cong-ty-abc:0")
        #expect(calls[0].values["token0"] == "gho_congty222" && calls[0].values["token1"] == "")
        #expect(calls[1].arguments == GitRunner.globalArguments + ["status", "--porcelain=v2"])
        #expect(calls[1].values["token0"] == "" && calls[1].values["owners"] == "")
        #expect(calls[2].arguments == GitRunner.globalArguments + ["push", "origin", "main"])
        #expect(calls[2].values["token0"] == "")

        // Nhật ký lệnh chỉ giữ tham số của người gọi — không có token, không có helper.
        let logged = records.current
        #expect(logged.map(\.arguments) == [["fetch", "--progress", "origin"], ["status", "--porcelain=v2"], ["push", "origin", "main"]])
        #expect(!logged.contains { $0.commandLine.contains("gho_") || $0.stderr.contains("gho_") })
    }

    /// git thật + script helper thật (cài vào thư mục có dấu cách và dấu nháy đơn, như "Application Support"):
    /// mỗi owner nhận đúng token của tài khoản mình, owner lạ dùng tài khoản mặc định, host khác vẫn dùng helper riêng
    /// (giả) của người dùng. Không dùng cấu hình hệ thống (osxkeychain) nên không chạm Keychain.
    @Test func realGitPicksTokenByOwner() async throws {
        let directory = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let helperDirectory = directory.appendingPathComponent("Application Support/Thaigit's", isDirectory: true)
        let helper = try GitHubCredentialHelper.install(in: helperDirectory)
        #expect(helper.path.contains(" ") && helper.path.contains("'"))
        #expect(try GitHubCredentialHelper.install(in: helperDirectory) == helper)

        let globalConfig = directory.appendingPathComponent("gitconfig")
        try Data(#"""
        [credential]
            helper = "!f() { test \"$1\" = get || exit 0; echo username=nguoi-dung; echo password=helper-rieng; }; f"

        """#.utf8).write(to: globalConfig)
        var environment = GitEnvironment.make(customGitPath: nil, loginShellPath: nil, askPassScript: nil)
        environment.variables["GIT_CONFIG_GLOBAL"] = globalConfig.path
        environment.variables["GIT_CONFIG_NOSYSTEM"] = "1"
        for key in environment.variables.keys where key.hasPrefix("THAIGIT_GITHUB_") || key.hasPrefix("GIT_CONFIG_PARAMETERS")
            || key.hasPrefix("GIT_CONFIG_COUNT") || key == "GIT_ASKPASS" || key == "SSH_ASKPASS" {
            environment.variables.removeValue(forKey: key)
        }
        let runner = GitRunner(environmentStore: GitEnvironmentStore(environment), workingDirectory: directory)
        let credentials = Self.credentialSet(helperPath: helper.path)
        // Lệnh chạm ba remote: owner octocat, tổ chức Cong-Ty-ABC, owner thai-congty.
        let loggedIn = GitCredentialInjection.additions(forURLs: [
            "https://github.com/octocat/du-an.git", "https://github.com/Cong-Ty-ABC/san-pham.git", "https://github.com/thai-congty/cong-cu",
        ], credentials: credentials)
        // Lệnh chạm một remote của owner lạ: tài khoản mặc định.
        let stranger = GitCredentialInjection.additions(forURLs: ["https://github.com/nguoi-la/repo.git"], credentials: credentials)

        func fill(_ host: String, path: String?, _ additions: GitCredentialInjection.Additions) async throws -> String? {
            var request = "protocol=https\nhost=\(host)\n"
            if let path { request += "path=\(path)\n" }
            // Không helper nào trả lời: git (không terminal, không askpass) thoát 128.
            let output = try await runner.run(additions.arguments + ["credential", "fill"], input: Data((request + "\n").utf8),
                                              acceptExitCodes: [0, 128], environment: additions.environment)
            guard output.exitCode == 0 else { return nil }
            var fields: [String: String] = [:]
            for line in output.stdoutString.split(separator: "\n") {
                let parts = line.split(separator: "=", maxSplits: 1).map(String.init)
                if parts.count == 2 { fields[parts[0]] = parts[1] }
            }
            return fields["username"].map { $0 + ":" + (fields["password"] ?? "") }
        }

        // Mỗi owner nhận đúng tài khoản của mình (owner không phân biệt hoa thường).
        #expect(try await fill("github.com", path: "octocat/du-an.git", loggedIn) == "octocat:gho_canhan111")
        #expect(try await fill("github.com", path: "Cong-Ty-ABC/san-pham.git", loggedIn) == "thai-congty:gho_congty222")
        #expect(try await fill("github.com", path: "thai-congty/cong-cu", loggedIn) == "thai-congty:gho_congty222")
        // Owner ngoài các remote của lệnh dùng nhiều tài khoản: không đoán, không trả lời.
        #expect(try await fill("github.com", path: "nguoi-la/repo.git", loggedIn) == nil)
        #expect(try await fill("github.com", path: nil, loggedIn) == nil)
        // Owner lạ của chính remote: tài khoản mặc định; lệnh chỉ dùng một tài khoản thì owner khác (chuyển hướng) cũng vậy.
        #expect(try await fill("github.com", path: "nguoi-la/repo.git", stranger) == "octocat:gho_canhan111")
        #expect(try await fill("github.com", path: nil, stranger) == "octocat:gho_canhan111")
        // Host khác: helper riêng của người dùng.
        #expect(try await fill("gitlab.com", path: "Cong-Ty-ABC/x.git", loggedIn) == "nguoi-dung:helper-rieng")
        // Chưa đăng nhập: github.com vẫn dùng helper riêng như trước.
        #expect(try await fill("github.com", path: "octocat/du-an.git", .none) == "nguoi-dung:helper-rieng")
    }

    @Test func recognizesGitHubAuthFailuresWithOwner() {
        func failure(_ stderr: String) -> GitError {
            GitError(arguments: ["push"], exitCode: 128, stdout: "", stderr: stderr)
        }
        #expect(GitHubAuthFailure.detect(in: failure("""
            remote: Invalid username or token. Password authentication is not supported for Git operations.
            fatal: Authentication failed for 'https://github.com/octocat/du-an.git/'
            """)) == GitHubAuthFailure(kind: .unauthenticated, owner: "octocat"))
        #expect(GitHubAuthFailure.detect(in: failure("fatal: could not read Username for 'https://github.com': terminal prompts disabled"))
                == GitHubAuthFailure(kind: .unauthenticated, owner: nil))
        #expect(GitHubAuthFailure.detect(in: failure("""
            remote: Permission to Cong-Ty-ABC/du-an.git denied to octocat.
            fatal: unable to access 'https://github.com/Cong-Ty-ABC/du-an.git/': The requested URL returned error: 403
            """)) == GitHubAuthFailure(kind: .forbidden, owner: "Cong-Ty-ABC"))
        #expect(GitHubAuthFailure.detect(in: failure("""
            remote: Repository not found.
            fatal: repository 'https://github.com/cong-ty-abc/bi-mat.git/' not found
            """)) == GitHubAuthFailure(kind: .notFound, owner: "cong-ty-abc"))
        // Host khác, SSH, push bị từ chối vì lịch sử: không phải lỗi tài khoản GitHub.
        #expect(GitHubAuthFailure.detect(in: failure("fatal: Authentication failed for 'https://gitlab.com/a/b.git/'")) == nil)
        #expect(GitHubAuthFailure.detect(in: failure("git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository."))
                == nil)
        #expect(GitHubAuthFailure.detect(in: failure("""
             ! [rejected]        main -> main (fetch first)
            error: failed to push some refs to 'https://github.com/octocat/du-an.git'
            """)) == nil)
    }

    // MARK: - Lưu trữ

    @Test func addingAccountKeepsOtherTokensAndRemovingDeletesOnlyItsOwn() throws {
        let storage = InMemorySettingsStorage()
        let tokens = InMemoryTokenStore()
        let store = GitHubAccountStore(storage: storage, tokens: tokens)
        #expect(store.loadState() == GitHubAccountsState())

        var state = try store.addAccount(Self.personal, token: "gho_canhan111", organizations: [], to: store.loadState())
        state = try store.addAccount(Self.company, token: "gho_congty222", organizations: ["Cong-Ty-ABC"], to: state)
        #expect(tokens.all == ["octocat": "gho_canhan111", "thai-congty": "gho_congty222"])
        #expect(state.defaultLogin == "octocat")
        #expect(store.loadState() == state)
        // Phần lưu UserDefaults không chứa token.
        let saved = String(decoding: try #require(storage.data(forKey: GitHubAccountStore.stateKey)), as: UTF8.self)
        #expect(saved.contains("thai-congty") && saved.contains("Cong-Ty-ABC"))
        #expect(!saved.contains("gho_"))

        // Đăng nhập lại tài khoản công ty: chỉ thay token của nó.
        state = try store.addAccount(Self.company, token: "gho_congtyMOI", organizations: nil, to: state)
        #expect(tokens.all == ["octocat": "gho_canhan111", "thai-congty": "gho_congtyMOI"])
        #expect(state.profiles.count == 2)

        // Xoá tài khoản mặc định: chỉ token của nó bị xoá, tài khoản còn lại thành mặc định.
        state.assign(owner: "du-an-cu", to: "octocat")
        let removed = store.removeAccount(login: "octocat", from: state)
        #expect(removed.tokenError == nil)
        #expect(tokens.all == ["thai-congty": "gho_congtyMOI"])
        #expect(removed.state.defaultLogin == "thai-congty")
        #expect(removed.state.ownerAssignments.isEmpty)
        #expect(store.loadState() == removed.state)

        // Không xoá được token (Keychain từ chối): tài khoản vẫn được bỏ khỏi danh sách, lỗi được báo lại.
        tokens.failDeletes = true
        let failed = store.removeAccount(login: "thai-congty", from: removed.state)
        #expect(failed.tokenError != nil)
        #expect(failed.state.isEmpty)
        #expect(store.loadState().isEmpty)
    }

    @Test func tokenProviderLoadsLazilyAndMatchesGitTable() async throws {
        let tokens = InMemoryTokenStore()
        try tokens.saveToken("gho_canhan111", account: "octocat")
        try tokens.saveToken("gho_congty222", account: "thai-congty")
        let (state, _) = Self.twoAccounts()
        let provider = GitHubTokenProvider(state: state, tokenStore: tokens)

        // Chưa nạp gì: lần hỏi đầu đọc kho token đúng một lần cho mỗi tài khoản.
        #expect(!provider.hasToken(for: "octocat"))
        #expect(provider.token(forOwner: "Cong-Ty-ABC") == "gho_congty222")
        #expect(provider.token(forOwner: "nguoi-la") == "gho_canhan111")
        #expect(provider.token(login: "thai-congty") == "gho_congty222")
        #expect(tokens.reads == 2)
        #expect(provider.credentialSet(helperPath: "/tmp/h") == Self.credentialSet(helperPath: "/tmp/h"))

        // Gọi đồng thời từ nhiều luồng (như tải ảnh đại diện): luôn cùng kết quả, không đọc lại kho token. Dùng luồng GCD
        // thật thay vì 64 task con cùng chờ một NSLock trên pool cooperative (ít luồng trên máy CI).
        let collected = LockedBox([String?]())
        DispatchQueue.concurrentPerform(iterations: 64) { index in
            let token = provider.token(forOwner: index.isMultiple(of: 2) ? "cong-ty-abc" : "octocat")
            collected.withValue { $0.append(token) }
        }
        let results = collected.current
        #expect(results.count == 64)
        #expect(results.filter { $0 == "gho_congty222" }.count == 32)
        #expect(results.filter { $0 == "gho_canhan111" }.count == 32)
        #expect(tokens.reads == 2)

        // Xoá tài khoản công ty: owner của nó rơi về tài khoản mặc định.
        var updated = state
        updated.remove(login: "thai-congty")
        provider.update(state: updated)
        #expect(provider.token(forOwner: "cong-ty-abc") == "gho_canhan111")
        // Đăng xuất hết.
        provider.update(state: GitHubAccountsState())
        #expect(provider.token(forOwner: "octocat") == nil)
        #expect(provider.credentialSet(helperPath: "/tmp/h") == nil)
    }
}

/// Kho token trong bộ nhớ thay cho Keychain khi test.
final class InMemoryTokenStore: GitHubTokenStore {
    private let tokens = LockedBox([String: String]())
    private let readCount = LockedBox(0)
    private let failing = LockedBox(false)

    var all: [String: String] { tokens.current }
    var reads: Int { readCount.current }

    var failDeletes: Bool {
        get { failing.current }
        set { failing.withValue { $0 = newValue } }
    }

    func readToken(account login: String) throws -> String? {
        readCount.withValue { $0 += 1 }
        return tokens.withValue { $0[login] }
    }

    func saveToken(_ token: String, account login: String) throws {
        tokens.withValue { $0[login] = token }
    }

    func deleteToken(account login: String) throws {
        if failDeletes { throw GitHubError.keychain(-25293) }
        tokens.withValue { $0[login] = nil }
    }
}

/// Thay UserDefaults khi test — không ghi file cài đặt nào ra đĩa.
final class InMemorySettingsStorage: GitHubSettingsStorage {
    private let values = LockedBox([String: Data]())

    func data(forKey key: String) -> Data? { values.withValue { $0[key] } }
    func setData(_ data: Data?, forKey key: String) { values.withValue { $0[key] = data } }
}

/// Một lần gọi `git` giả: tham số và vài biến môi trường mang tài khoản GitHub.
private struct FakeGitCall {
    var arguments: [String] = []
    var values: [String: String] = [:]

    init(_ text: String) {
        for line in text.split(separator: "\n", omittingEmptySubsequences: false) {
            if line.hasPrefix("arg:") {
                arguments.append(String(line.dropFirst(4)))
            } else if let colon = line.firstIndex(of: ":") {
                values[String(line[..<colon])] = String(line[line.index(after: colon)...])
            }
        }
    }
}

private func temporaryDirectory() throws -> URL {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent("thaigit-github-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory
}
