import AppKit
import NhanhCore
import SwiftUI

/// The app's GitLab accounts: device-code sign-in for gitlab.com (OAuth Device Flow, needs a client ID in
/// Info.plist) or pasting a personal access token for any server (gitlab.com, a company's self-hosted GitLab).
/// Tokens live only in the Keychain; an HTTPS git command to the account's host receives the token through
/// `gitlab-credential.sh` (see `GitLabCredentialInjection`).
@Observable
final class GitLabAccountManager {
    static let shared = GitLabAccountManager()
    nonisolated static let defaultHost = "gitlab.com"

    enum LoginState: Equatable {
        case idle
        case requestingCode
        case waitingForUser(GitLabDeviceCode)
        case finishing
        case failed(String)

        var isInProgress: Bool {
            switch self {
            case .requestingCode, .waitingForUser, .finishing: return true
            case .idle, .failed: return false
            }
        }
    }

    private(set) var accounts: [GitLabAccount] = []
    private(set) var loginState: LoginState = .idle
    var problem: String?
    var loginSheetPresented = false
    var tokenSheetPresented = false

    @ObservationIgnored let clientID: String?
    @ObservationIgnored let store: GitLabAccounts
    @ObservationIgnored private let api = GitLabAPI()
    @ObservationIgnored private var loginTask: Task<Void, Never>?

    private init() {
        let raw = (Bundle.main.object(forInfoDictionaryKey: "ThaigitGitLabClientID") as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let clientID = raw.isEmpty ? nil : raw
        self.clientID = clientID
        store = GitLabAccounts(tokens: AutomationHarness.isActive ? InMemoryGitLabTokenStore() : KeychainGitLabTokenStore(), clientIDs: { host in host == GitLabAccountManager.defaultHost ? clientID : nil })
        accounts = store.accounts
    }

    /// Whether device-code sign-in for gitlab.com is possible (the build has a client ID).
    var supportsDeviceLogin: Bool { clientID != nil }

    func bind(to environment: GitEnvironmentStore) {
        guard let directory = GitHubCredentialHelper.defaultDirectory() else { return }
        do {
            let helper = try GitLabCredentialHelper.install(in: directory)
            environment.gitlabAccess = GitLabGitAccess(accounts: store, helperPath: helper.path)
        } catch {
            problem = String(localized: "Không cài được credential helper cho GitLab.")
        }
    }

    // MARK: - Device-code sign-in (gitlab.com)

    func startDeviceLogin() {
        guard let clientID else {
            loginState = .failed(GitLabError.notConfigured.errorDescription ?? "")
            return
        }
        loginTask?.cancel()
        loginState = .requestingCode
        let api = self.api
        let host = Self.defaultHost
        loginTask = Task {
            do {
                let code = try await api.requestDeviceCode(host: host, clientID: clientID)
                try Task.checkCancellation()
                loginState = .waitingForUser(code)
                NSWorkspace.shared.open(code.verificationURL)
                let token = try await api.pollForToken(host: host, clientID: clientID, code: code)
                try Task.checkCancellation()
                loginState = .finishing
                let user = try await api.fetchUser(host: host, token: token.accessToken)
                _ = try store.add(host: host, user: user, token: token)
                accounts = store.accounts
                loginState = .idle
                loginSheetPresented = false
            } catch is CancellationError {
                loginState = .idle
            } catch {
                loginState = .failed(FriendlyError.message(for: error))
            }
        }
    }

    func cancelLogin() {
        loginTask?.cancel()
        loginTask = nil
        loginState = .idle
    }

    // MARK: - Pasting a token (any server)

    /// The personal access token creation page, with the name and scopes pre-filled.
    static func tokenPage(host: String) -> URL? {
        URL(string: "https://\(host)/-/user_settings/personal_access_tokens?name=Thaigit&scopes=api,read_user,read_repository,write_repository")
    }

    /// Validate the token with the server, then store it. Returns a friendly error message (nil on success).
    func addToken(host rawHost: String, token rawToken: String) async -> String? {
        guard let host = GitLabAPI.normalizedHost(rawHost) else { return GitLabError.invalidHost.errorDescription }
        let token = rawToken.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !token.isEmpty, !token.contains(where: { $0.isWhitespace }) else { return GitLabError.unauthorized.errorDescription }
        do {
            let user = try await api.fetchUser(host: host, token: token)
            _ = try store.add(host: host, user: user, token: GitLabToken(accessToken: token, refreshToken: nil, expiresAt: nil))
            accounts = store.accounts
            return nil
        } catch {
            return FriendlyError.message(for: error)
        }
    }

    func remove(_ account: GitLabAccount) {
        do {
            try store.remove(key: account.key)
            accounts = store.accounts
        } catch {
            problem = FriendlyError.message(for: error)
        }
    }

    /// Upload an SSH public key to the account. With no valid token it's treated as "missing permission" (paste it manually).
    func addSSHKey(account: GitLabAccount, title: String, publicKey: String) async throws -> GitLabAPI.SSHKeyUpload {
        guard let token = await store.validToken(for: account) else { return .missingScope }
        return try await api.addSSHKey(host: account.host, token: token.accessToken, title: title, publicKey: publicKey)
    }

    static func sshKeysPage(host: String) -> URL {
        URL(string: "https://\(host)/-/user_settings/ssh_keys") ?? URL(string: "https://gitlab.com/-/user_settings/ssh_keys")!
    }
}
