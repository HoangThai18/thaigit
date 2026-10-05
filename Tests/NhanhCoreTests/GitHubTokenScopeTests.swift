import Foundation
import Testing
@testable import NhanhCore

/// A GitHub token may only be handed to a git command that really touches the matching owner's https://github.com
/// remote — hooks, filters and other hosts' helpers of every other command see no token at all. Real git in a
/// temp directory: no network, no real Keychain (the token store is the in-memory one).
@Suite("Token GitHub chỉ cho đúng remote")
struct GitHubTokenScopeTests {
    static let personal = GitHubAccount(id: 1, login: "alice", name: "Alice", avatarURL: nil)
    static let work = GitHubAccount(id: 2, login: "alice-work", name: "Alice (Work)", avatarURL: nil)

    /// A personal account (the default) and a work account (a member of the "acme" organisation).
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

    // MARK: - A1: a hook / a command that doesn't touch github.com sees no token

    /// A repo hook that records its own name and every THAIGIT_GITHUB_* variable it can see into `dump`.
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

        // Pushing / fetch --all to a remote that is a local directory, fast-forwarded with `fetch .`: no command touches github.com.
        try await test.repo.push(remote: "origin", localBranch: "main", remoteBranch: "main", setUpstream: true, force: false)
        try await test.repo.fetch(remote: nil, prune: false)
        try await test.repo.fetch(remote: "origin", prune: false)
        try await test.repo.fastForward(branch: "cu", to: "origin/main")

        let seen = try String(contentsOf: dump, encoding: .utf8)
        #expect(seen.contains("hook:pre-push") && seen.contains("hook:reference-transaction"))
        #expect(!seen.contains("THAIGIT_GITHUB_"), "The hook saw a token variable:\n\(seen)")
        #expect(try await test.repo.resolveCommit("cu") == (try await test.repo.resolveCommit("main")))
    }

    /// A fake `git`: records the arguments + THAIGIT_GITHUB_* variables of network commands (fetch / push / pull…) then
    /// exits; every other command (`remote -v`, `config`…) is handed to real git — the app reads the remote
    /// addresses with real git, and the network commands never hit the network.
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

    /// The last network command the fake git recorded: arguments + environment variables.
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

        // fetch the acme owner's remote (the work account's organisation): only the work token.
        try await repo.fetch(remote: "origin", prune: false)
        var call = try lastCall(log)
        #expect(tokens(call.variables) == ["gho_WORK"])
        #expect(call.variables["THAIGIT_GITHUB_ACCOUNTS"] == "1")
        #expect(call.variables["THAIGIT_GITHUB_USER_0"] == "alice-work")
        #expect(call.arguments.contains("credential.https://github.com.useHttpPath=true"))

        // pull: the current branch's remote (origin).
        try await repo.pull(mode: .merge)
        call = try lastCall(log)
        #expect(tokens(call.variables) == ["gho_WORK"])

        // Push to the personal account's own fork: only the personal token.
        try await repo.push(remote: "fork", localBranch: "main", remoteBranch: "main", setUpstream: false, force: false)
        call = try lastCall(log)
        #expect(tokens(call.variables) == ["gho_PERSONAL"])

        // A remote that isn't github.com, or a local directory: no token variables, no credential helper replaced.
        for remote in ["backup", "local"] {
            try await repo.fetch(remote: remote, prune: false)
            call = try lastCall(log)
            #expect(call.variables.isEmpty, "\(remote): \(call.variables.keys.sorted())")
            #expect(!call.arguments.contains { $0.hasPrefix("credential.") }, "\(remote)")
        }

        // fetch --all: exactly the accounts of the github.com remotes (acme → work, Alice → personal).
        try await repo.fetch(remote: nil, prune: false)
        call = try lastCall(log)
        #expect(tokens(call.variables) == ["gho_WORK", "gho_PERSONAL"])

        // Only the acme owner's github.com remote is left: fetch --all carries no personal token.
        try await test.git("remote", "remove", "fork")
        try await repo.fetch(remote: nil, prune: false)
        call = try lastCall(log)
        #expect(tokens(call.variables) == ["gho_WORK"])

        // A pushurl different from url: push uses the pushurl (owner Alice), fetch still uses url (acme).
        try await test.git("config", "remote.origin.pushurl", "https://github.com/alice/mirror.git")
        try await repo.push(remote: "origin", localBranch: "main", remoteBranch: "main", setUpstream: false, force: false)
        call = try lastCall(log)
        #expect(tokens(call.variables) == ["gho_PERSONAL"])
        try await repo.fetch(remote: "origin", prune: false)
        call = try lastCall(log)
        #expect(tokens(call.variables) == ["gho_WORK"])
    }

    // MARK: - A2: an account without a token isn't substituted with another one

    @Test func ownerOfAccountWithoutTokenNeverGetsAnotherAccountsToken() {
        var (state, tokens) = Self.twoAccounts()
        state.assign(owner: "client-x", to: "alice-work")
        tokens["alice-work"] = nil // the Keychain read fails / the user clicks "Deny"
        let store = InMemoryTokenStore()
        for (login, token) in tokens { try? store.saveToken(token, account: login) }
        let provider = GitHubTokenProvider(state: state, tokenStore: store)

        // The work account's manually assigned owner / organisation: no token (git errors and the app suggests signing in again as @alice-work).
        #expect(provider.token(forOwner: "client-x") == nil)
        #expect(provider.token(forOwner: "acme") == nil)
        #expect(provider.token(forOwner: "alice") == "gho_PERSONAL")
        #expect(provider.token(forOwner: "nguoi-la") == "gho_PERSONAL")

        // The default account has no token: it isn't promoted from the remaining account.
        state.setDefault(login: "alice-work")
        provider.update(state: state)
        #expect(provider.token(forOwner: "nguoi-la") == nil)
        #expect(provider.token(forOwner: "alice") == "gho_PERSONAL")
    }

    // MARK: - A3: the owner comes from the error line, not from another remote's "From …" line

    @Test func authFailureOwnerComesFromTheFailingRemote() {
        func fetchAll(_ stderr: String) -> GitError {
            GitError(arguments: ["fetch", "--progress", "--all"], exitCode: 1, stdout: "", stderr: stderr)
        }
        // fetch --all: remote "origin" (alice/fork) succeeds first, remote "upstream" (acme/private) is refused.
        #expect(GitHubAuthFailure.detect(in: fetchAll("""
            Fetching origin
            From https://github.com/alice/fork
             * [new branch]      main       -> origin/main
            Fetching upstream
            remote: Repository not found.
            fatal: repository 'https://github.com/acme/private.git/' not found
            error: could not fetch upstream
            """)) == GitHubAuthFailure(kind: .notFound, owner: "acme"))
        // The broken remote is GitLab: not a GitHub account problem even though the output contains a github.com URL.
        #expect(GitHubAuthFailure.detect(in: fetchAll("""
            Fetching origin
            From https://github.com/alice/fork
             * [new branch]      main       -> origin/main
            Fetching backup
            remote: HTTP Basic: Access denied
            fatal: Authentication failed for 'https://gitlab.com/team/x.git/'
            error: could not fetch backup
            """)) == nil)
        // GitHub Enterprise (github.cong-ty.com) is not github.com.
        #expect(GitHubAuthFailure.detect(in: fetchAll("""
            fatal: Authentication failed for 'https://github.cong-ty.com/team/x.git/'
            """)) == nil)
        #expect(GitHubAuthFailure.detect(in: fetchAll("""
            fatal: unable to access 'https://github.com.evil.vn/acme/x.git/': The requested URL returned error: 401
            """)) == nil)
        // The push is refused with 403 on the second remote; the first remote's "To …" line doesn't count.
        #expect(GitHubAuthFailure.detect(in: fetchAll("""
            To https://github.com/alice/fork.git
               1111111..2222222  main -> main
            remote: Permission to acme/app.git denied to alice.
            fatal: unable to access 'https://github.com/acme/app.git/': The requested URL returned error: 403
            """)) == GitHubAuthFailure(kind: .forbidden, owner: "acme"))
        // The username in the URL (git prints it when asking for a password).
        #expect(GitHubAuthFailure.detect(in: fetchAll("""
            fatal: could not read Password for 'https://alice@github.com': terminal prompts disabled
            """)) == GitHubAuthFailure(kind: .unauthenticated, owner: nil))
    }

    // MARK: - A4: a repo picked in the Clone dialog uses the very account that listed it

    @Test func pickedRepositoryOwnerFollowsTheListingAccount() {
        var (state, _) = Self.twoAccounts()
        // acme is the work account's organisation, but the user picks acme/app from the personal account's repo list:
        // it used to only assign when the owner fell back to the default account, so the clone silently used the work account.
        #expect(state.resolve(owner: "acme")?.profile.login == "alice-work")
        let assigned = state.assignOwnerForPickedRepository(owner: "Acme", login: "alice")
        #expect(assigned)
        #expect(state.resolve(owner: "acme") == GitHubAccountsState.Resolution(profile: state.profiles[0], match: .assigned))
        // The owner already maps to that account: no extra assignment.
        let again = state.assignOwnerForPickedRepository(owner: "alice", login: "alice")
            || state.assignOwnerForPickedRepository(owner: "acme", login: "alice")
        #expect(!again)
        #expect(state.ownerAssignments == ["acme": "alice"])
    }

    // MARK: - A5a + A2: the real helper script

    /// `git credential fill` with the real helper script and the environment variables supplied (no Keychain / user config involved).
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
        // The owner in the table.
        #expect(try await fill(path: "acme/app.git", variables: variables) == "Alice-Work:gho_WORK")
        // https://alice@github.com/acme/app.git: a username matching an account's login wins (case-insensitively).
        #expect(try await fill(path: "acme/app.git", username: "alice", variables: variables) == "alice:gho_PERSONAL")
        #expect(try await fill(path: "alice/x.git", username: "ALICE-WORK", variables: variables) == "Alice-Work:gho_WORK")
        // An unknown username: by owner as usual (git uses the username the helper returned).
        #expect(try await fill(path: "acme/app.git", username: "nguoi-la", variables: variables) == "Alice-Work:gho_WORK")
        // The owner of an account without a token ("-"): the helper answers nothing.
        #expect(try await fill(path: "client-x/app.git", variables: variables) == nil)
        // An owner outside the table with no default account for this command: no answer (no guessing).
        #expect(try await fill(path: "nguoi-la/x.git", variables: variables) == nil)
        variables["THAIGIT_GITHUB_DEFAULT"] = "0"
        #expect(try await fill(path: "nguoi-la/x.git", variables: variables) == "alice:gho_PERSONAL")
    }

    // MARK: - A5b: the owner table isn't rebuilt on every token lookup

    @Test func tokenForOwnerIsCheapWithManyOrganizations() {
        var state = GitHubAccountsState()
        state.upsert(Self.personal, organizations: (0..<300).map { "org-p-\($0)" })
        state.upsert(Self.work, organizations: (0..<300).map { "org-w-\($0)" })
        let store = InMemoryTokenStore()
        try? store.saveToken("gho_PERSONAL", account: "alice")
        try? store.saveToken("gho_WORK", account: "alice-work")
        let provider = GitHubTokenProvider(state: state, tokenStore: store)
        #expect(provider.token(forOwner: "org-w-299") == "gho_WORK")
        // Not compared against a fixed number of seconds (a busy CI machine is slow): compare against the time to build the
        // table once on the same machine. Rebuilding it on every lookup would make 200 lookups ≈ 200 builds;
        // with the cache it costs essentially nothing.
        provider.update(state: state)
        let buildStart = Date()
        _ = provider.token(forOwner: "owner-dau")
        let oneBuild = Date().timeIntervalSince(buildStart)
        let start = Date()
        for index in 0..<200 { _ = provider.token(forOwner: "owner-\(index)") }
        let elapsed = Date().timeIntervalSince(start)
        #expect(elapsed < oneBuild * 50, "200 token(forOwner:) lookups took \(elapsed)s, building the table once took \(oneBuild)s")
        #expect(provider.token(forOwner: "org-p-7") == "gho_PERSONAL")
        // Table changed: the new result is immediate.
        state.assign(owner: "org-p-7", to: "alice-work")
        provider.update(state: state)
        #expect(provider.token(forOwner: "org-p-7") == "gho_WORK")
        provider.setToken(nil, for: "alice-work")
        #expect(provider.token(forOwner: "org-p-7") == nil)
        provider.setToken("gho_WORK_MOI", for: "alice-work")
        #expect(provider.token(forOwner: "org-p-7") == "gho_WORK_MOI")
    }

    // MARK: - A5f: orphaned tokens when a login changes

    @Test func loginChangeDoesNotOrphanOldToken() throws {
        let tokens = InMemoryTokenStore()
        let store = GitHubAccountStore(storage: InMemorySettingsStorage(), tokens: tokens)
        var state = try store.addAccount(GitHubAccount(id: 7, login: "Alice", name: nil, avatarURL: nil), token: "gho_OLD",
                                         organizations: [], to: GitHubAccountsState())
        state.assign(owner: "acme", to: "Alice")
        // The GitHub login changed case, then signed in again.
        state = try store.addAccount(GitHubAccount(id: 7, login: "alice", name: nil, avatarURL: nil), token: "gho_NEW",
                                     organizations: [], to: state)
        #expect(state.profiles.map(\.login) == ["alice"])
        #expect(tokens.all == ["alice": "gho_NEW"])
        // A real rename (same id): one account, the assigned owner and the default follow it, and the old login's token is deleted.
        state = try store.addAccount(GitHubAccount(id: 7, login: "alice-moi", name: nil, avatarURL: nil), token: "gho_RENAMED",
                                     organizations: nil, to: state)
        #expect(state.profiles.map(\.login) == ["alice-moi"])
        #expect(state.ownerAssignments == ["acme": "alice-moi"])
        #expect(state.defaultLogin == "alice-moi")
        #expect(tokens.all == ["alice-moi": "gho_RENAMED"])
        #expect(store.removeAccount(login: "alice-moi", from: state).state.isEmpty)
        #expect(tokens.all.isEmpty)
    }

    // MARK: - A5g: reading the Keychain outside the lock

    /// No timing: the fake token store KEEPS every read blocked until the test calls `release()`. The other
    /// operations (the ones published on the main actor: `hasToken`, `credentialSet`, `update`) must complete
    /// WHILE the read is still blocked — if the main lock were held during the read they'd only finish after
    /// the read is released, i.e. after the checkpoint. The 30 second timeout only stops the test hanging on a
    /// failure; it is not a pass/fail condition. A dedicated `Thread` (not the shared GCD queue) keeps a busy CI
    /// machine from delaying the start of the read.
    @Test func readingKeychainDoesNotBlockOtherCallers() {
        let (state, tokens) = Self.twoAccounts()
        let store = SlowTokenStore(tokens)
        let provider = GitHubTokenProvider(state: state, tokenStore: store)
        let readerFinished = DispatchSemaphore(value: 0)
        let result = LockedBox<String?>(nil)
        Thread {
            // Ask for the token OUTSIDE `result`'s lock (the test reads `result` while this task is still blocked).
            let token = provider.token(forOwner: "acme")
            result.withValue { $0 = token }
            readerFinished.signal()
        }.start()
        // The reading task has entered the token store and is blocked.
        #expect(store.entered.wait(timeout: .now() + 30) == .success)

        let callersFinished = DispatchSemaphore(value: 0)
        Thread {
            _ = provider.hasToken(for: "alice")
            _ = provider.credentialSet(helperPath: "/h")
            provider.update(state: state)
            callersFinished.signal()
        }.start()
        let callersDoneWhileReading = callersFinished.wait(timeout: .now() + 30) == .success
        // The read is still blocked: the reading task hasn't returned a token yet.
        let readerStillBlocked = result.current == nil && !store.isReleased
        store.release()
        #expect(callersDoneWhileReading, "Other operations must not wait for the Keychain read to finish")
        #expect(readerStillBlocked)
        #expect(readerFinished.wait(timeout: .now() + 30) == .success)
        if !callersDoneWhileReading { _ = callersFinished.wait(timeout: .now() + 30) }
        #expect(result.current == "gho_WORK")
        // Already loaded: no second read.
        let reads = store.reads
        #expect(provider.token(forOwner: "alice") == "gho_PERSONAL")
        #expect(store.reads == reads)
    }
}

/// A fake token store that keeps every read blocked until `release()` — like the Keychain waiting for the user to
/// click "Allow". Blocking for at most 60 seconds only stops it hanging forever if a test forgets to release.
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
    var isReleased: Bool { released.current }

    func release() {
        released.withValue { $0 = true }
        for _ in 0..<8 { gate.signal() }
    }

    func readToken(account login: String) throws -> String? {
        readCount.withValue { $0 += 1 }
        entered.signal()
        if !released.current { _ = gate.wait(timeout: .now() + 60) }
        return tokens.withValue { $0[login] }
    }

    func saveToken(_ token: String, account login: String) throws { tokens.withValue { $0[login] = token } }
    func deleteToken(account login: String) throws { tokens.withValue { $0[login] = nil } }
}
