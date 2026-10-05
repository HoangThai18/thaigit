import AppKit
import NhanhCore
import SwiftUI

/// Các tài khoản GitHub của app (2–3 tài khoản kiểu "profile" như GitKraken: cá nhân, công ty…), đăng nhập bằng
/// OAuth Device Flow. Mỗi tài khoản một token riêng trong Keychain. Lệnh git mạng tới https://github.com chọn token
/// theo OWNER của URL (xem `GitHubAccountsState.resolve`), qua credential helper `github-credential.sh`.
/// Token không bao giờ được ghi log hay hiện ra giao diện.
@Observable
final class GitHubAccountManager {
    /// `nonisolated` để luồng nền (tải ảnh đại diện…) gọi được `apiToken(forOwner:)`.
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

    /// "Chưa cấu hình (thiếu Client ID của GitHub OAuth App)" — Info.plist để trống `ThaigitGitHubClientID`.
    static let notConfiguredMessage = GitHubError.notConfigured(nil).errorDescription ?? String(localized: "Chưa cấu hình")
    /// OAuth App không tự thu hồi token được (cần client secret): người dùng thu hồi ở trang này.
    static let revokeURL = URL(string: "https://github.com/settings/applications")!

    private(set) var state = GitHubAccountsState()
    private(set) var loginState: LoginState = .idle
    /// Tài khoản đã nạp được token (thiếu thì Cài đặt hiện "Cần đăng nhập lại").
    private(set) var loginsWithToken: Set<String> = []
    /// Login vừa xoá: Cài đặt nhắc thu hồi token trên GitHub.
    private(set) var removedLogin: String?
    /// Lỗi Keychain / cài helper (hiện trong Cài đặt).
    private(set) var problem: String?
    /// Menu "Đăng nhập GitHub…" mở Cài đặt và yêu cầu hiện hộp đăng nhập ở đó.
    var settingsLoginRequested = false

    nonisolated let clientID: String?
    nonisolated private let auth: GitHubAuth
    nonisolated private let store: GitHubAccountStore
    /// Bản chụp an toàn đa luồng (token theo owner) — nguồn của `apiToken(forOwner:)` và bảng cho lệnh git.
    nonisolated private let tokens: GitHubTokenProvider
    @ObservationIgnored private var environment: GitEnvironmentStore?
    @ObservationIgnored private var helperPath: String?
    @ObservationIgnored private var loadTask: Task<Void, Never>?
    @ObservationIgnored private var loginTask: Task<Void, Never>?
    /// Số hộp đăng nhập đang mở (Cài đặt, hộp Clone, cửa sổ repo…): cùng xem một lần đăng nhập, chỉ huỷ khi hộp cuối
    /// cùng đóng — đóng một hộp không làm hộp kia quay vòng mãi.
    @ObservationIgnored private var openLoginSheets = 0
    @ObservationIgnored private var organizationsTask: Task<Void, Never>?

    nonisolated private init() {
        auth = GitHubAuth(clientID: Bundle.main.object(forInfoDictionaryKey: "ThaigitGitHubClientID") as? String)
        clientID = auth.clientID
        store = AutomationHarness.isActive ? GitHubAccountStore(tokens: InMemoryGitHubTokenStore()) : GitHubAccountStore()
        // Chỉ đọc UserDefaults ở đây; token được nạp từ Keychain khi cần.
        tokens = GitHubTokenProvider(state: store.loadState(), tokenStore: store.tokens)
    }

    var isConfigured: Bool { clientID != nil }
    var accounts: [GitHubAccountProfile] { state.profiles }
    var defaultAccount: GitHubAccountProfile? { state.defaultProfile }

    /// Trang quyền của Thaigit trên GitHub: cấp quyền cho tổ chức, thu hồi token.
    var authorizationSettingsURL: URL {
        clientID.flatMap { URL(string: "https://github.com/settings/connections/applications/\($0)") } ?? Self.revokeURL
    }

    /// Token cho API GitHub (api.github.com) của repo thuộc `owner`, theo đúng bảng owner → tài khoản mà lệnh git dùng.
    /// Gọi được từ mọi luồng; token chưa nạp thì đọc Keychain (an toàn đa luồng). nil khi chưa đăng nhập.
    nonisolated func apiToken(forOwner owner: String) -> String? {
        tokens.token(forOwner: owner)
    }

    /// Thêm khoá SSH công khai vào tài khoản `login` trên GitHub. Chưa có token thì coi như thiếu quyền (tự dán).
    nonisolated func addSSHKey(login: String, title: String, publicKey: String) async throws -> GitHubAuth.SSHKeyUpload {
        guard let token = tokens.token(forOwner: login) else { return .missingScope }
        return try await auth.addSSHKey(token: token, title: title, publicKey: publicKey)
    }

    /// Tài khoản sẽ dùng cho owner (và lý do) — để hiển thị.
    func resolution(forOwner owner: String?) -> GitHubAccountsState.Resolution? {
        state.resolve(owner: owner)
    }

    // MARK: - Khởi động

    /// Gọi một lần khi mở app: cài credential helper, nạp danh sách tài khoản, rồi nạp token từ Keychain ở luồng nền
    /// (lần đầu sau khi cập nhật app, macOS có thể hỏi quyền truy cập Keychain) và giao cho mọi lệnh git mạng.
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

    // MARK: - Đăng nhập / xoá tài khoản

    /// Đăng nhập (thêm tài khoản, hoặc đăng nhập lại tài khoản đã có). Không đụng token của tài khoản khác.
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
                // Không lấy được danh sách tổ chức thì vẫn đăng nhập (giữ danh sách cũ).
                let organizations = try? await auth.listOrganizations(token: token)
                try Task.checkCancellation()
                state = try store.addAccount(account, token: token, organizations: organizations, to: state)
                tokens.setToken(token, for: account.login)
                publish()
                removedLogin = nil
                loginState = .succeeded(account)
            } catch {
                // Đã huỷ (đóng hộp thoại hoặc bắt đầu lần đăng nhập khác): không ghi đè trạng thái mới.
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

    /// Hộp đăng nhập vừa hiện: hộp khác đang đăng nhập dở thì xem tiếp, không xin mã mới.
    func loginSheetAppeared() {
        openLoginSheets += 1
        if isConfigured, !loginState.isInProgress { startLogin() }
    }

    /// Hộp đăng nhập vừa đóng: chỉ huỷ lần đăng nhập đang chạy khi không còn hộp nào xem nó.
    func loginSheetDisappeared() {
        openLoginSheets = max(0, openLoginSheets - 1)
        if openLoginSheets == 0 { cancelLogin() }
    }

    /// Xoá một tài khoản: chỉ token của tài khoản đó bị xoá khỏi Keychain. Token vẫn còn hiệu lực trên GitHub tới khi
    /// người dùng thu hồi.
    func removeAccount(login: String) {
        let result = store.removeAccount(login: login, from: state)
        state = result.state
        tokens.setToken(nil, for: login)
        publish()
        // Chỉ báo "đã xoá token khỏi máy" khi Keychain thật sự xoá được.
        removedLogin = result.tokenError == nil ? login : nil
        problem = result.tokenError.map { String(localized: "Không xoá được token của @\(login) khỏi Keychain: \(Self.describe($0))") }
    }

    func setDefault(login: String) {
        mutate { $0.setDefault(login: login) }
    }

    /// Gán owner (người dùng / tổ chức trên github.com) cho tài khoản; `login` nil để bỏ gán.
    func assign(owner: String, to login: String?) {
        mutate { $0.assign(owner: owner, to: login) }
    }

    func setCommitIdentity(login: String, name: String, email: String) {
        mutate { $0.setCommitIdentity(login: login, name: name, email: email) }
    }

    /// Chọn repo trong danh sách của tài khoản `login` để clone: owner đang dùng tài khoản khác (kể cả do quy tắc tổ chức /
    /// mặc định) thì gán owner đó cho `login`, để clone / fetch sau này dùng đúng tài khoản đã liệt kê repo. Trả về true
    /// nếu vừa gán (hộp Clone báo cho người dùng biết).
    @discardableResult
    func noteCloneSelection(owner: String, login: String) -> Bool {
        var assigned = false
        mutate { assigned = $0.assignOwnerForPickedRepository(owner: owner, login: login) }
        return assigned
    }

    /// Làm mới danh sách tổ chức của mọi tài khoản (khi mở Cài đặt). Lỗi mạng bỏ qua, giữ danh sách cũ.
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

    /// Menu "Đăng nhập GitHub…" / "Tài khoản GitHub…": chọn thẻ Tài khoản trong Cài đặt (chưa có tài khoản thì mở luôn
    /// hộp đăng nhập ở đó).
    func prepareSettings() {
        UserDefaults.standard.set(SettingsTab.account.rawValue, forKey: Prefs.settingsTab)
        if state.isEmpty, isConfigured { settingsLoginRequested = true }
    }

    // MARK: - API

    /// Repo của một tài khoản cho hộp Clone (mới cập nhật trước).
    func repositories(for login: String) async throws -> [GitHubRepository] {
        await loadTask?.value
        let tokens = self.tokens
        guard let token = await Task.detached(operation: { tokens.token(login: login) }).value else {
            throw GitHubError.unauthorized
        }
        return try await auth.listRepositories(token: token)
    }

    // MARK: - Nội bộ

    private func mutate(_ change: (inout GitHubAccountsState) -> Void) {
        var updated = state
        change(&updated)
        guard updated != state else { return }
        state = updated
        store.saveState(updated)
        publish()
    }

    /// Đưa danh sách tài khoản mới cho bản chụp đa luồng và cho mọi lệnh git (repo đang mở dùng ngay lệnh kế tiếp).
    private func publish() {
        tokens.update(state: state)
        environment?.githubCredentials = helperPath.flatMap { tokens.credentialSet(helperPath: $0) }
        loginsWithToken = Set(state.profiles.map(\.login).filter { tokens.hasToken(for: $0) })
    }

    static func describe(_ error: any Error) -> String {
        FriendlyError.message(for: error)
    }
}
