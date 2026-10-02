import Foundation
import Testing
@testable import NhanhCore

/// Token GitHub chỉ được đưa cho lệnh git thật sự chạm remote https://github.com của owner tương ứng — hook, filter,
/// helper của host khác… của mọi lệnh khác không thấy token nào. Git thật trong thư mục tạm, không gọi mạng, không đụng
/// Keychain (kho token trong bộ nhớ).
@Suite("Token GitHub chỉ cho đúng remote")
struct GitHubTokenScopeTests {
    static let personal = GitHubAccount(id: 1, login: "alice", name: "Alice", avatarURL: nil)
    static let work = GitHubAccount(id: 2, login: "alice-work", name: "Alice (Work)", avatarURL: nil)

    /// Tài khoản cá nhân (mặc định) và tài khoản công ty (thành viên tổ chức "acme").
    static func twoAccounts() -> (state: GitHubAccountsState, tokens: [String: String]) {
        var state = GitHubAccountsState()
        state.upsert(personal, organizations: [])
        state.upsert(work, organizations: ["acme"])
        return (state, ["alice": "gho_PERSONAL", "alice-work": "gho_WORK"])
    }

    static func credentialSet() -> GitHubCredentialSet {
        let (state, tokens) = twoAccounts()
        return GitHubCredentialSet(helperPath: "/nonexistent/helper.sh", state: state, tokens: tokens)!
    }

    // MARK: - A1: hook / lệnh không chạm github.com không thấy token

    /// Hook của repo ghi tên mình và mọi biến THAIGIT_GITHUB_* nó thấy vào `dump`.
    private func installHook(_ name: String, in test: TestRepo, dump: URL) throws {
        let hook = test.repo.gitDir.appendingPathComponent("hooks/\(name)")
        try FileManager.default.createDirectory(at: hook.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("#!/bin/sh\necho \"hook:\(name)\" >> '\(dump.path)'\nenv | grep '^THAIGIT_GITHUB_' >> '\(dump.path)'\nexit 0\n".utf8)
            .write(to: hook)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: hook.path)
    }

    @Test func hooksOfLocalRemoteSeeNoToken() async throws {
        let test = try await TestRepo.make()
        let remote = FileManager.default.temporaryDirectory.appendingPathComponent("nhanh-remote-\(UUID().uuidString).git")
        defer { test.cleanup(); try? FileManager.default.removeItem(at: remote) }
        try await test.git("init", "--bare", "-q", remote.path)
        try test.write("a.txt", "a\n")
        try await test.commitAll("a")
        try await test.git("branch", "cu")
        try test.write("a.txt", "b\n")
        try await test.commitAll("b")
        try await test.repo.addRemote(name: "origin", url: remote.path)

        let dump = test.url.appendingPathComponent(".git/hook-env.txt")
        try installHook("pre-push", in: test, dump: dump)
        try installHook("reference-transaction", in: test, dump: dump)
        test.store.githubCredentials = Self.credentialSet()

        // Push / fetch --all tới remote là thư mục trên máy, fast-forward bằng `fetch .`: không lệnh nào chạm github.com.
        try await test.repo.push(remote: "origin", localBranch: "main", remoteBranch: "main", setUpstream: true, force: false)
        try await test.repo.fetch(remote: nil, prune: false)
        try await test.repo.fetch(remote: "origin", prune: false)
        try await test.repo.fastForward(branch: "cu", to: "origin/main")

        let seen = try String(contentsOf: dump, encoding: .utf8)
        #expect(seen.contains("hook:pre-push") && seen.contains("hook:reference-transaction"))
        #expect(!seen.contains("THAIGIT_GITHUB_"), "Hook thấy biến token:\n\(seen)")
        #expect(try await test.repo.resolveCommit("cu") == (try await test.repo.resolveCommit("main")))
    }

    /// `git` giả: ghi tham số + biến THAIGIT_GITHUB_* của lệnh mạng (fetch / push / pull…) rồi thoát, mọi lệnh khác
    /// (`remote -v`, `config`…) chuyển cho git thật — app đọc địa chỉ remote bằng git thật, lệnh mạng không gọi mạng.
    private func wrappedRepository(_ test: TestRepo, log: URL) async throws -> GitRepository {
        let wrapper = test.url.appendingPathComponent(".git/fake-git.sh")
        try Data(#"""
        #!/bin/sh
        sub=""
        skip=0
        for a in "$@"; do
          if [ "$skip" = 1 ]; then skip=0; continue; fi
          case "$a" in
            -c|-C) skip=1 ;;
            -*) ;;
            *) sub=$a; break ;;
          esac
        done
        case "$sub" in
          fetch|push|pull|clone|ls-remote)
            {
              echo "--- $sub"
              for a in "$@"; do printf 'arg:%s\n' "$a"; done
              env | grep '^THAIGIT_GITHUB_' | sort
            } >> "$FAKE_GIT_LOG"
            exit 0 ;;
        esac
        exec "$REAL_GIT" "$@"

        """#.utf8).write(to: wrapper)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: wrapper.path)
        var environment = test.store.value
        environment.variables["FAKE_GIT_LOG"] = log.path
        environment.variables["REAL_GIT"] = environment.executable.path
        environment.executable = wrapper
        let store = GitEnvironmentStore(environment)
        store.githubCredentials = Self.credentialSet()
        return try await GitRepository.open(at: test.url, environment: store)
    }

    /// Lần gọi lệnh mạng cuối cùng mà git giả ghi lại: tham số + biến môi trường.
    private func lastCall(_ log: URL) throws -> (arguments: [String], variables: [String: String]) {
        let text = try String(contentsOf: log, encoding: .utf8)
        let block = text.components(separatedBy: "--- ").last ?? ""
        var arguments: [String] = []
        var variables: [String: String] = [:]
        for line in block.split(separator: "\n").dropFirst() {
            if line.hasPrefix("arg:") {
                arguments.append(String(line.dropFirst(4)))
            } else if let equals = line.firstIndex(of: "=") {
                variables[String(line[..<equals])] = String(line[line.index(after: equals)...])
            }
        }
        return (arguments, variables)
    }

    private func tokens(_ variables: [String: String]) -> Set<String> {
        Set(variables.filter { $0.key.hasPrefix("THAIGIT_GITHUB_TOKEN_") }.values)
    }

    @Test func networkCommandGetsOnlyTokensOfItsGitHubRemotes() async throws {
        let test = try await TestRepo.make()
        defer { test.cleanup() }
        try test.write("a.txt", "a\n")
        try await test.commitAll("a")
        try await test.git("remote", "add", "origin", "https://github.com/acme/app.git")
        try await test.git("remote", "add", "fork", "https://github.com/Alice/fork")
        try await test.git("remote", "add", "backup", "https://gitlab.com/acme/app.git")
        try await test.git("remote", "add", "local", "/tmp/khong-co-that")
        try await test.git("config", "branch.main.remote", "origin")
        try await test.git("config", "branch.main.merge", "refs/heads/main")
        let log = test.url.appendingPathComponent(".git/fake-git.log")
        let repo = try await wrappedRepository(test, log: log)

        // fetch remote của owner acme (tổ chức của tài khoản công ty): chỉ token công ty.
        try await repo.fetch(remote: "origin", prune: false)
        var call = try lastCall(log)
        #expect(tokens(call.variables) == ["gho_WORK"])
        #expect(call.variables["THAIGIT_GITHUB_ACCOUNTS"] == "1")
        #expect(call.variables["THAIGIT_GITHUB_USER_0"] == "alice-work")
        #expect(call.arguments.contains("credential.https://github.com.useHttpPath=true"))

        // pull: remote của nhánh hiện tại (origin).
        try await repo.pull(mode: .merge)
        call = try lastCall(log)
        #expect(tokens(call.variables) == ["gho_WORK"])

        // push lên fork của chính tài khoản cá nhân: chỉ token cá nhân.
        try await repo.push(remote: "fork", localBranch: "main", remoteBranch: "main", setUpstream: false, force: false)
        call = try lastCall(log)
        #expect(tokens(call.variables) == ["gho_PERSONAL"])

        // Remote không phải github.com, hoặc thư mục trên máy: không biến token, không thay credential helper.
        for remote in ["backup", "local"] {
            try await repo.fetch(remote: remote, prune: false)
            call = try lastCall(log)
            #expect(call.variables.isEmpty, "\(remote): \(call.variables.keys.sorted())")
            #expect(!call.arguments.contains { $0.hasPrefix("credential.") }, "\(remote)")
        }

        // fetch --all: đúng các tài khoản của các remote github.com (acme → công ty, Alice → cá nhân).
        try await repo.fetch(remote: nil, prune: false)
        call = try lastCall(log)
        #expect(tokens(call.variables) == ["gho_WORK", "gho_PERSONAL"])

        // Chỉ còn remote github.com của owner acme: fetch --all không mang token cá nhân.
        try await test.git("remote", "remove", "fork")
        try await repo.fetch(remote: nil, prune: false)
        call = try lastCall(log)
        #expect(tokens(call.variables) == ["gho_WORK"])

        // pushurl khác url: push dùng pushurl (owner Alice), fetch vẫn dùng url (acme).
        try await test.git("config", "remote.origin.pushurl", "https://github.com/alice/mirror.git")
        try await repo.push(remote: "origin", localBranch: "main", remoteBranch: "main", setUpstream: false, force: false)
        call = try lastCall(log)
        #expect(tokens(call.variables) == ["gho_PERSONAL"])
        try await repo.fetch(remote: "origin", prune: false)
        call = try lastCall(log)
        #expect(tokens(call.variables) == ["gho_WORK"])
    }

    // MARK: - A2: tài khoản thiếu token không bị thay bằng tài khoản khác

    @Test func ownerOfAccountWithoutTokenNeverGetsAnotherAccountsToken() {
        var (state, tokens) = Self.twoAccounts()
        state.assign(owner: "client-x", to: "alice-work")
        tokens["alice-work"] = nil // Keychain đọc lỗi / người dùng bấm "Từ chối"
        let store = InMemoryTokenStore()
        for (login, token) in tokens { try? store.saveToken(token, account: login) }
        let provider = GitHubTokenProvider(state: state, tokenStore: store)

        // Owner gán tay / tổ chức của tài khoản công ty: không có token (git báo lỗi, app gợi ý đăng nhập lại @alice-work).
        #expect(provider.token(forOwner: "client-x") == nil)
        #expect(provider.token(forOwner: "acme") == nil)
        #expect(provider.token(forOwner: "alice") == "gho_PERSONAL")
        #expect(provider.token(forOwner: "nguoi-la") == "gho_PERSONAL")

        // Tài khoản mặc định thiếu token: không tự nâng tài khoản còn lại lên làm mặc định.
        state.setDefault(login: "alice-work")
        provider.update(state: state)
        #expect(provider.token(forOwner: "nguoi-la") == nil)
        #expect(provider.token(forOwner: "alice") == "gho_PERSONAL")
    }

    // MARK: - A3: owner lấy từ dòng lỗi, không từ dòng "From …" của remote khác

    @Test func authFailureOwnerComesFromTheFailingRemote() {
        func fetchAll(_ stderr: String) -> GitError {
            GitError(arguments: ["fetch", "--progress", "--all"], exitCode: 1, stdout: "", stderr: stderr)
        }
        // fetch --all: remote "origin" (alice/fork) thành công trước, remote "upstream" (acme/private) bị từ chối.
        #expect(GitHubAuthFailure.detect(in: fetchAll("""
            Fetching origin
            From https://github.com/alice/fork
             * [new branch]      main       -> origin/main
            Fetching upstream
            remote: Repository not found.
            fatal: repository 'https://github.com/acme/private.git/' not found
            error: could not fetch upstream
            """)) == GitHubAuthFailure(kind: .notFound, owner: "acme"))
        // Remote hỏng là GitLab: không phải lỗi tài khoản GitHub dù output có URL github.com.
        #expect(GitHubAuthFailure.detect(in: fetchAll("""
            Fetching origin
            From https://github.com/alice/fork
             * [new branch]      main       -> origin/main
            Fetching backup
            remote: HTTP Basic: Access denied
            fatal: Authentication failed for 'https://gitlab.com/team/x.git/'
            error: could not fetch backup
            """)) == nil)
        // GitHub Enterprise (github.cong-ty.com) không phải github.com.
        #expect(GitHubAuthFailure.detect(in: fetchAll("""
            fatal: Authentication failed for 'https://github.cong-ty.com/team/x.git/'
            """)) == nil)
        #expect(GitHubAuthFailure.detect(in: fetchAll("""
            fatal: unable to access 'https://github.com.evil.vn/acme/x.git/': The requested URL returned error: 401
            """)) == nil)
        // Push bị từ chối 403 vào remote thứ hai; dòng "To …" của remote đầu không tính.
        #expect(GitHubAuthFailure.detect(in: fetchAll("""
            To https://github.com/alice/fork.git
               1111111..2222222  main -> main
            remote: Permission to acme/app.git denied to alice.
            fatal: unable to access 'https://github.com/acme/app.git/': The requested URL returned error: 403
            """)) == GitHubAuthFailure(kind: .forbidden, owner: "acme"))
        // Username trong URL (git in ra khi hỏi mật khẩu).
        #expect(GitHubAuthFailure.detect(in: fetchAll("""
            fatal: could not read Password for 'https://alice@github.com': terminal prompts disabled
            """)) == GitHubAuthFailure(kind: .unauthenticated, owner: nil))
    }

    // MARK: - A4: repo chọn trong hộp Clone dùng đúng tài khoản đã liệt kê nó

    @Test func pickedRepositoryOwnerFollowsTheListingAccount() {
        var (state, _) = Self.twoAccounts()
        // acme là tổ chức của tài khoản công ty, nhưng người dùng chọn acme/app trong danh sách repo của tài khoản cá nhân:
        // trước đây chỉ gán khi owner đang rơi về tài khoản mặc định, nên clone âm thầm dùng tài khoản công ty.
        #expect(state.resolve(owner: "acme")?.profile.login == "alice-work")
        let assigned = state.assignOwnerForPickedRepository(owner: "Acme", login: "alice")
        #expect(assigned)
        #expect(state.resolve(owner: "acme") == GitHubAccountsState.Resolution(profile: state.profiles[0], match: .assigned))
        // Owner đã dùng đúng tài khoản đó: không gán thêm.
        let again = state.assignOwnerForPickedRepository(owner: "alice", login: "alice")
            || state.assignOwnerForPickedRepository(owner: "acme", login: "alice")
        #expect(!again)
        #expect(state.ownerAssignments == ["acme": "alice"])
    }

    // MARK: - A5a + A2: script helper thật

    /// `git credential fill` với script helper thật và biến môi trường cho sẵn (không qua Keychain / cấu hình người dùng).
    private func fill(path: String, username: String? = nil, variables: [String: String]) async throws -> String? {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("nhanh-helper-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let helper = try GitHubCredentialHelper.install(in: directory)
        var environment = GitEnvironment.make(customGitPath: nil, loginShellPath: nil, askPassScript: nil)
        environment.variables["GIT_CONFIG_GLOBAL"] = "/dev/null"
        environment.variables["GIT_CONFIG_NOSYSTEM"] = "1"
        for key in environment.variables.keys where key.hasPrefix("THAIGIT_GITHUB_") || key.hasPrefix("GIT_CONFIG_PARAMETERS")
            || key.hasPrefix("GIT_CONFIG_COUNT") || key == "GIT_ASKPASS" || key == "SSH_ASKPASS" {
            environment.variables.removeValue(forKey: key)
        }
        let runner = GitRunner(environmentStore: GitEnvironmentStore(environment), workingDirectory: directory)
        var request = "protocol=https\nhost=github.com\npath=\(path)\n"
        if let username { request += "username=\(username)\n" }
        let output = try await runner.run(
            ["-c", GitCredentialInjection.helperKey + "=",
             "-c", GitCredentialInjection.helperKey + "=" + GitHubCredentialHelper.configValue(path: helper.path),
             "-c", GitCredentialInjection.useHttpPathKey + "=true", "credential", "fill"],
            input: Data((request + "\n").utf8), acceptExitCodes: [0, 128], environment: variables)
        guard output.exitCode == 0 else { return nil }
        var fields: [String: String] = [:]
        for line in output.stdoutString.split(separator: "\n") {
            let parts = line.split(separator: "=", maxSplits: 1).map(String.init)
            if parts.count == 2 { fields[parts[0]] = parts[1] }
        }
        return fields["password"].map { (fields["username"] ?? "") + ":" + $0 }
    }

    @Test func helperScriptHonorsUsernameAndNeverFallsBackSilently() async throws {
        let accounts = [
            "THAIGIT_GITHUB_ACCOUNTS": "2",
            "THAIGIT_GITHUB_USER_0": "alice", "THAIGIT_GITHUB_TOKEN_0": "gho_PERSONAL",
            "THAIGIT_GITHUB_USER_1": "Alice-Work", "THAIGIT_GITHUB_TOKEN_1": "gho_WORK",
        ]
        var variables = accounts
        variables["THAIGIT_GITHUB_OWNERS"] = "acme:1,client-x:-"
        // Owner trong bảng.
        #expect(try await fill(path: "acme/app.git", variables: variables) == "Alice-Work:gho_WORK")
        // https://alice@github.com/acme/app.git: username trùng login một tài khoản thì dùng tài khoản đó (không phân biệt hoa thường).
        #expect(try await fill(path: "acme/app.git", username: "alice", variables: variables) == "alice:gho_PERSONAL")
        #expect(try await fill(path: "alice/x.git", username: "ALICE-WORK", variables: variables) == "Alice-Work:gho_WORK")
        // Username lạ: theo owner như thường (git dùng username helper trả về).
        #expect(try await fill(path: "acme/app.git", username: "nguoi-la", variables: variables) == "Alice-Work:gho_WORK")
        // Owner của tài khoản thiếu token ("-"): helper không trả lời gì.
        #expect(try await fill(path: "client-x/app.git", variables: variables) == nil)
        // Owner ngoài bảng và không có tài khoản mặc định cho lệnh này: không trả lời (không đoán).
        #expect(try await fill(path: "nguoi-la/x.git", variables: variables) == nil)
        variables["THAIGIT_GITHUB_DEFAULT"] = "0"
        #expect(try await fill(path: "nguoi-la/x.git", variables: variables) == "alice:gho_PERSONAL")
    }

    // MARK: - A5b: bảng owner không dựng lại mỗi lần hỏi token

    @Test func tokenForOwnerIsCheapWithManyOrganizations() {
        var state = GitHubAccountsState()
        state.upsert(Self.personal, organizations: (0..<300).map { "org-p-\($0)" })
        state.upsert(Self.work, organizations: (0..<300).map { "org-w-\($0)" })
        let store = InMemoryTokenStore()
        try? store.saveToken("gho_PERSONAL", account: "alice")
        try? store.saveToken("gho_WORK", account: "alice-work")
        let provider = GitHubTokenProvider(state: state, tokenStore: store)
        #expect(provider.token(forOwner: "org-w-299") == "gho_WORK")
        let start = Date()
        for index in 0..<200 { _ = provider.token(forOwner: "owner-\(index)") }
        let elapsed = Date().timeIntervalSince(start)
        #expect(elapsed < 0.5, "200 lần token(forOwner:) mất \(elapsed) giây")
        #expect(provider.token(forOwner: "org-p-7") == "gho_PERSONAL")
        // Đổi bảng: kết quả mới ngay.
        state.assign(owner: "org-p-7", to: "alice-work")
        provider.update(state: state)
        #expect(provider.token(forOwner: "org-p-7") == "gho_WORK")
        provider.setToken(nil, for: "alice-work")
        #expect(provider.token(forOwner: "org-p-7") == nil)
        provider.setToken("gho_WORK_MOI", for: "alice-work")
        #expect(provider.token(forOwner: "org-p-7") == "gho_WORK_MOI")
    }

    // MARK: - A5f: token mồ côi khi login đổi

    @Test func loginChangeDoesNotOrphanOldToken() throws {
        let tokens = InMemoryTokenStore()
        let store = GitHubAccountStore(storage: InMemorySettingsStorage(), tokens: tokens)
        var state = try store.addAccount(GitHubAccount(id: 7, login: "Alice", name: nil, avatarURL: nil), token: "gho_OLD",
                                         organizations: [], to: GitHubAccountsState())
        state.assign(owner: "acme", to: "Alice")
        // Đổi hoa/thường trên GitHub rồi đăng nhập lại.
        state = try store.addAccount(GitHubAccount(id: 7, login: "alice", name: nil, avatarURL: nil), token: "gho_NEW",
                                     organizations: [], to: state)
        #expect(state.profiles.map(\.login) == ["alice"])
        #expect(tokens.all == ["alice": "gho_NEW"])
        // Đổi tên hẳn (cùng id): một tài khoản, owner đã gán và mặc định đi theo, token login cũ bị xoá.
        state = try store.addAccount(GitHubAccount(id: 7, login: "alice-moi", name: nil, avatarURL: nil), token: "gho_RENAMED",
                                     organizations: nil, to: state)
        #expect(state.profiles.map(\.login) == ["alice-moi"])
        #expect(state.ownerAssignments == ["acme": "alice-moi"])
        #expect(state.defaultLogin == "alice-moi")
        #expect(tokens.all == ["alice-moi": "gho_RENAMED"])
        #expect(store.removeAccount(login: "alice-moi", from: state).state.isEmpty)
        #expect(tokens.all.isEmpty)
    }

    // MARK: - A5g: đọc Keychain ngoài khoá

    @Test func readingKeychainDoesNotBlockOtherCallers() {
        let (state, tokens) = Self.twoAccounts()
        let store = SlowTokenStore(tokens)
        let provider = GitHubTokenProvider(state: state, tokenStore: store)
        let finished = DispatchSemaphore(value: 0)
        let result = LockedBox<String?>(nil)
        DispatchQueue.global().async {
            result.withValue { $0 = provider.token(forOwner: "acme") }
            finished.signal()
        }
        // Luồng nền đang đọc Keychain (bị giữ lại): các lệnh khác (publish trên luồng chính) không phải chờ.
        #expect(store.entered.wait(timeout: .now() + 5) == .success)
        let start = Date()
        _ = provider.hasToken(for: "alice")
        _ = provider.credentialSet(helperPath: "/h")
        provider.update(state: state)
        let elapsed = Date().timeIntervalSince(start)
        store.release()
        #expect(finished.wait(timeout: .now() + 10) == .success)
        #expect(elapsed < 1, "Bị chặn \(elapsed) giây trong lúc đọc Keychain")
        #expect(result.current == "gho_WORK")
        // Đã nạp: không đọc lại.
        let reads = store.reads
        #expect(provider.token(forOwner: "alice") == "gho_PERSONAL")
        #expect(store.reads == reads)
    }
}

/// Kho token giả mà mỗi lần đọc bị giữ lại tới khi `release()` (tối đa 3 giây) — như Keychain đang hỏi quyền.
final class SlowTokenStore: GitHubTokenStore, @unchecked Sendable {
    let entered = DispatchSemaphore(value: 0)
    private let gate = DispatchSemaphore(value: 0)
    private let tokens: LockedBox<[String: String]>
    private let readCount = LockedBox(0)
    private let released = LockedBox(false)

    init(_ tokens: [String: String]) {
        self.tokens = LockedBox(tokens)
    }

    var reads: Int { readCount.current }

    func release() {
        released.withValue { $0 = true }
        for _ in 0..<8 { gate.signal() }
    }

    func readToken(account login: String) throws -> String? {
        readCount.withValue { $0 += 1 }
        entered.signal()
        if !released.current { _ = gate.wait(timeout: .now() + 3) }
        return tokens.withValue { $0[login] }
    }

    func saveToken(_ token: String, account login: String) throws { tokens.withValue { $0[login] = token } }
    func deleteToken(account login: String) throws { tokens.withValue { $0[login] = nil } }
}
