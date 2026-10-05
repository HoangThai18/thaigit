import AppKit
import NhanhCore
import SwiftUI

/// The app's GitHub accounts (2–3 "profile" accounts like GitKraken: personal, work…), signed in through the
/// OAuth Device Flow. Each account gets its own token in the Keychain. A git command reaching https://github.com
/// picks the token by the URL's OWNER (see `GitHubAccountsState.resolve`), via the `github-credential.sh`
/// credential helper.
/// A token is never logged nor shown in the UI.
@Observable
final class GitHubAccountManager {
    /// `nonisolated` so background tasks (downloading avatars…) can call `apiToken(forOwner:)`.
    nonisolated static let shared = GitHubAccountManager()

    enum LoginState: Equatable {
        case idle
        case requestingCode
        case waitingForUser(GitHubDeviceCode)
        case finishing
        case succeeded(GitHubAccount)
        case failed(String)

        var isInProgress: Bool {
            switch self {
            case .requestingCode, .waitingForUser, .finishing: return true
            case .idle, .succeeded, .failed: return false
            }
        }
    }

    /// "Not configured (missing the GitHub OAuth App client ID)" — Info.plist leaves `ThaigitGitHubClientID` empty.
    static let notConfiguredMessage = GitHubError.notConfigured(nil).errorDescription ?? String(localized: "Chưa cấu hình")
    /// An OAuth App can't revoke its own tokens (that needs a client secret): the user revokes them on this page.
    static let revokeURL = URL(string: "https://github.com/settings/applications")!

    private(set) var state = GitHubAccountsState()
    private(set) var loginState: LoginState = .idle
    /// Accounts whose token is loaded (without one, Settings shows "Sign in again").
    private(set) var loginsWithToken: Set<String> = []
    /// A login that was just removed: Settings suggests revoking the token on GitHub.
    private(set) var removedLogin: String?
    /// A Keychain / helper-install failure (shown in Settings).
    private(set) var problem: String?
    /// The "Sign in to GitHub…" menu opens Settings and asks for the sign-in dialog to be shown there.
    var settingsLoginRequested = false

    nonisolated let clientID: String?
    nonisolated private let auth: GitHubAuth
    nonisolated private let store: GitHubAccountStore
    /// A thread-safe snapshot (tokens by owner) — the source of `apiToken(forOwner:)` and of the table git commands use.
    nonisolated private let tokens: GitHubTokenProvider
    @ObservationIgnored private var environment: GitEnvironmentStore?
    @ObservationIgnored private var helperPath: String?
    @ObservationIgnored private var loadTask: Task<Void, Never>?
    @ObservationIgnored private var loginTask: Task<Void, Never>?
    /// How many sign-in dialogs are open (Settings, the Clone dialog, a repo window…): they share one sign-in attempt, which is
    /// only cancelled when the last one closes — closing one dialog must not make the others spin forever.
    @ObservationIgnored private var openLoginSheets = 0
    @ObservationIgnored private var organizationsTask: Task<Void, Never>?

    nonisolated private init() {
        auth = GitHubAuth(clientID: Bundle.main.object(forInfoDictionaryKey: "ThaigitGitHubClientID") as? String)
        clientID = auth.clientID
        store = AutomationHarness.isActive ? GitHubAccountStore(tokens: InMemoryGitHubTokenStore()) : GitHubAccountStore()
        // Only UserDefaults is read here; tokens are loaded from the Keychain when needed.
        tokens = GitHubTokenProvider(state: store.loadState(), tokenStore: store.tokens)
    }

    var isConfigured: Bool { clientID != nil }
    var accounts: [GitHubAccountProfile] { state.profiles }
    var defaultAccount: GitHubAccountProfile? { state.defaultProfile }

    /// Thaigit's permissions page on GitHub: grant access to an organisation, revoke tokens.
    var authorizationSettingsURL: URL {
        clientID.flatMap { URL(string: "https://github.com/settings/connections/applications/\($0)") } ?? Self.revokeURL
    }

    /// The GitHub API (api.github.com) token for a repo owned by `owner`, following exactly the owner → account table git
    /// commands use. Callable from any task; an unloaded token is read from the Keychain (thread-safe). nil when not signed in.
    nonisolated func apiToken(forOwner owner: String) -> String? {
        tokens.token(forOwner: owner)
    }

    /// Add an SSH public key to the `login` account on GitHub. With no token it's treated as "missing permission" (paste it manually).
    nonisolated func addSSHKey(login: String, title: String, publicKey: String) async throws -> GitHubAuth.SSHKeyUpload {
        guard let token = tokens.token(forOwner: login) else { return .missingScope }
        return try await auth.addSSHKey(token: token, title: title, publicKey: publicKey)
    }

    /// The account that will be used for an owner (and why) — for display.
    func resolution(forOwner owner: String?) -> GitHubAccountsState.Resolution? {
        state.resolve(owner: owner)
    }

    // MARK: - Launch

    /// Called once at launch: install the credential helper, load the account list, then load the tokens from the Keychain on a
    /// background task (right after an app update macOS may ask for Keychain access) and hand them to every network git command.
    func bind(to environment: GitEnvironmentStore) {
        self.environment = environment
        if let directory = GitHubCredentialHelper.defaultDirectory() {
            do {
                helperPath = try GitHubCredentialHelper.install(in: directory).path
            } catch {
                problem = String(localized: "Không cài được credential helper cho GitHub: \(Self.describe(error))")
            }
        }
        state = store.loadState()
        publish()
        guard !state.isEmpty else { return }
        let tokens = self.tokens
        loadTask = Task {
            let errors = await Task.detached(priority: .userInitiated) { tokens.loadTokens() }.value
            publish()
            if !errors.isEmpty {
                problem = String(localized: "Không đọc được token của ") + errors.keys.sorted().map { "@\($0)" }.joined(separator: ", ")
                    + String(localized: " trong Keychain — hãy đăng nhập lại tài khoản đó.")
            }
        }
    }

    // MARK: - Signing in / removing accounts

    /// Sign in (adding an account, or signing an existing one in again). Other accounts' tokens are untouched.
    func startLogin() {
        guard isConfigured else {
            loginState = .failed(Self.notConfiguredMessage)
            return
        }
        loginTask?.cancel()
        loginState = .requestingCode
        let auth = self.auth
        loginTask = Task {
            do {
                let code = try await auth.requestDeviceCode()
                try Task.checkCancellation()
                loginState = .waitingForUser(code)
                let token = try await auth.pollForToken(code)
                try Task.checkCancellation()
                loginState = .finishing
                let account = try await auth.fetchUser(token: token)
                // If the organisation list can't be fetched, still complete the sign-in (keeping the old list).
                let organizations = try? await auth.listOrganizations(token: token)
                try Task.checkCancellation()
                state = try store.addAccount(account, token: token, organizations: organizations, to: state)
                tokens.setToken(token, for: account.login)
                publish()
                removedLogin = nil
                loginState = .succeeded(account)
            } catch {
                // Cancelled (the dialog was closed or another sign-in started): don't overwrite the newer state.
                guard !Task.isCancelled, !(error is CancellationError) else { return }
                loginState = .failed(Self.describe(error))
            }
        }
    }

    func cancelLogin() {
        loginTask?.cancel()
        loginTask = nil
        if loginState.isInProgress { loginState = .idle }
    }

    /// The sign-in dialog just opened: another dialog mid-sign-in keeps watching it, no new code is requested.
    func loginSheetAppeared() {
        openLoginSheets += 1
        if isConfigured, !loginState.isInProgress { startLogin() }
    }

    /// The sign-in dialog just closed: only cancel the running sign-in when no dialog watches it any more.
    func loginSheetDisappeared() {
        openLoginSheets = max(0, openLoginSheets - 1)
        if openLoginSheets == 0 { cancelLogin() }
    }

    /// Remove an account: only that account's token is deleted from the Keychain. The token stays valid on GitHub until the
    /// user revokes it.
    func removeAccount(login: String) {
        let result = store.removeAccount(login: login, from: state)
        state = result.state
        tokens.setToken(nil, for: login)
        publish()
        // Only report "token deleted from this machine" when the Keychain actually removed it.
        removedLogin = result.tokenError == nil ? login : nil
        problem = result.tokenError.map { String(localized: "Không xoá được token của @\(login) khỏi Keychain: \(Self.describe($0))") }
    }

    func setDefault(login: String) {
        mutate { $0.setDefault(login: login) }
    }

    /// Assign an owner (a user / organisation on github.com) to an account; a nil `login` clears the assignment.
    func assign(owner: String, to login: String?) {
        mutate { $0.assign(owner: owner, to: login) }
    }

    func setCommitIdentity(login: String, name: String, email: String) {
        mutate { $0.setCommitIdentity(login: login, name: name, email: email) }
    }

    /// Pick a repo from account `login`'s list to clone: when the owner in use is a different account (by the organisation /
    /// default rule), assign that owner to `login` so that clone and every fetch afterwards use the very account that
    /// listed the repo. Returns true when it just assigned (the Clone dialog tells the user).
    @discardableResult
    func noteCloneSelection(owner: String, login: String) -> Bool {
        var assigned = false
        mutate { assigned = $0.assignOwnerForPickedRepository(owner: owner, login: login) }
        return assigned
    }

    /// Refresh every account's organisation list (when Settings opens). Network errors are ignored and the old list kept.
    func refreshOrganizations() {
        guard organizationsTask == nil else { return }
        let logins = state.profiles.map(\.login)
        let auth = self.auth
        let tokens = self.tokens
        organizationsTask = Task {
            for login in logins {
                guard let token = await Task.detached(operation: { tokens.token(login: login) }).value,
                      let organizations = try? await auth.listOrganizations(token: token) else { continue }
                mutate { $0.setOrganizations(login: login, organizations) }
            }
            organizationsTask = nil
        }
    }

    /// The "Sign in to GitHub…" / "GitHub accounts…" menu: pick the Accounts tab in Settings (with no account yet it
    /// opens the sign-in dialog there directly).
    func prepareSettings() {
        UserDefaults.standard.set(SettingsTab.account.rawValue, forKey: Prefs.settingsTab)
        if state.isEmpty, isConfigured { settingsLoginRequested = true }
    }

    // MARK: - API

    /// An account's repositories for the Clone dialog (most recently updated first).
    func repositories(for login: String) async throws -> [GitHubRepository] {
        await loadTask?.value
        let tokens = self.tokens
        guard let token = await Task.detached(operation: { tokens.token(login: login) }).value else {
            throw GitHubError.unauthorized
        }
        return try await auth.listRepositories(token: token)
    }

    // MARK: - Internal

    private func mutate(_ change: (inout GitHubAccountsState) -> Void) {
        var updated = state
        change(&updated)
        guard updated != state else { return }
        state = updated
        store.saveState(updated)
        publish()
    }

    /// Hand the new account list to the thread-safe snapshot and to every git command (open repos use it from the next command on).
    private func publish() {
        tokens.update(state: state)
        environment?.githubCredentials = helperPath.flatMap { tokens.credentialSet(helperPath: $0) }
        loginsWithToken = Set(state.profiles.map(\.login).filter { tokens.hasToken(for: $0) })
    }

    static func describe(_ error: any Error) -> String {
        FriendlyError.message(for: error)
    }
}
