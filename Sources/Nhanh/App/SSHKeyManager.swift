import AppKit
import NhanhCore
import SwiftUI

/// Thaigit's SSH keys (the SSH tab in Settings): generate an Ed25519 key, import an existing key, upload the public key
/// to GitHub / GitLab, and check the connection. Secrets live only in the Keychain; a git command touching an SSH remote
/// receives the keys through a temporary ssh-agent
/// (xem `SSHAgentSession`).
@Observable
final class SSHKeyManager {
    static let shared = SSHKeyManager()

    enum ConnectionResult: Equatable {
        case success(String)
        case failure(String)
    }

    private(set) var keys: [SSHKeyInfo] = []
    /// A short message after an action (copied, added to GitHub…).
    var notice: String?
    /// The friendly error of the most recent action.
    var problem: String?
    private(set) var busy = false
    private(set) var connection: [String: ConnectionResult] = [:]
    var isEnabled: Bool {
        didSet { keyring.isEnabled = isEnabled }
    }

    @ObservationIgnored let keyring = AutomationHarness.isActive ? SSHKeyring(secrets: InMemorySSHKeyStore()) : SSHKeyring()
    @ObservationIgnored private var environment: GitEnvironmentStore?

    private init() {
        isEnabled = keyring.isEnabled
        keys = keyring.keys
    }

    func bind(to environment: GitEnvironmentStore) {
        self.environment = environment
        environment.sshKeyring = keyring
    }

    // MARK: - Create / import / delete

    func generate(name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let title = trimmed.isEmpty ? Self.defaultKeyName : trimmed
        perform(String(localized: "Đã tạo khoá SSH “\(title)”. Thêm khoá công khai lên GitHub / GitLab để dùng.")) {
            try self.keyring.generate(name: title, comment: Self.defaultComment)
        }
    }

    /// The private key file picker (opened at ~/.ssh).
    func chooseKeyToImport() {
        let panel = NSOpenPanel()
        panel.title = String(localized: "Chọn khoá SSH bí mật")
        panel.message = String(localized: "Chọn file khoá bí mật (vd. id_ed25519), không phải file .pub. Khoá được chép vào Keychain; file gốc giữ nguyên.")
        panel.prompt = String(localized: "Nhập khoá")
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.showsHiddenFiles = true
        panel.directoryURL = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".ssh", isDirectory: true)
        guard panel.runModal() == .OK, let url = panel.url else { return }
        importKey(at: url)
    }

    func importKey(at url: URL) {
        let name = url.deletingPathExtension().lastPathComponent
        busy = true
        problem = nil
        Task {
            defer { busy = false }
            do {
                let data = try Data(contentsOf: url)
                let publicKey = await Self.publicKey(forPrivateKeyAt: url, data: data)
                try keyring.importKey(name: name, privateKey: data, publicKey: publicKey)
                keys = keyring.keys
                notice = String(localized: "Đã nhập khoá “\(name)” vào Keychain.")
            } catch {
                problem = FriendlyError.message(for: error)
            }
        }
    }

    /// The public key of a key that isn't in OpenSSH format: the accompanying .pub file, or `ssh-keygen -y` reading the key over stdin.
    private static func publicKey(forPrivateKeyAt url: URL, data: Data) async -> SSHPublicKey? {
        if SSHKeyFormat.inspectOpenSSH(data) != nil { return nil }
        let sibling = url.appendingPathExtension("pub")
        if let text = try? String(contentsOf: sibling, encoding: .utf8), let key = SSHPublicKey(line: text) { return key }
        let output = try? await ProcessRunner.run(
            executable: URL(fileURLWithPath: "/usr/bin/ssh-keygen"), arguments: ["-y", "-f", "/dev/stdin"],
            environment: ["PATH": "/usr/bin:/bin"], input: data
        )
        return output.flatMap { $0.exitCode == 0 ? SSHPublicKey(line: $0.stdoutString) : nil }
    }

    func rename(_ key: SSHKeyInfo, to name: String) {
        keyring.rename(id: key.id, to: name)
        keys = keyring.keys
    }

    func remove(_ key: SSHKeyInfo) {
        perform(String(localized: "Đã xoá khoá “\(key.name)” khỏi Keychain. Nhớ gỡ khoá công khai trên GitHub / GitLab nếu không dùng nữa.")) {
            try self.keyring.remove(id: key.id)
        }
    }

    // MARK: - Public key

    func copyPublicKey(_ key: SSHKeyInfo) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(key.publicKey, forType: .string)
        notice = String(localized: "Đã sao chép khoá công khai “\(key.name)”.")
    }

    static let githubKeysPage = URL(string: "https://github.com/settings/ssh/new")!

    /// Add the public key to the GitHub account `login`. When the token lacks permission the key is copied and the add-key page opened.
    func addToGitHub(_ key: SSHKeyInfo, login: String) {
        busy = true
        problem = nil
        Task {
            defer { busy = false }
            do {
                switch try await GitHubAccountManager.shared.addSSHKey(login: login, title: Self.uploadTitle(key), publicKey: key.publicKey) {
                case .added:
                    notice = String(localized: "Đã thêm khoá “\(key.name)” lên GitHub @\(login).")
                case .alreadyExists:
                    notice = String(localized: "Khoá “\(key.name)” đã có trên GitHub.")
                case .missingScope:
                    copyPublicKey(key)
                    NSWorkspace.shared.open(Self.githubKeysPage)
                    notice = String(localized: "Tài khoản @\(login) chưa cấp quyền thêm khoá SSH cho Thaigit (đăng nhập lại để cấp). Đã sao chép khoá và mở trang GitHub — dán vào ô Key rồi bấm Add SSH key.")
                }
            } catch {
                problem = FriendlyError.message(for: error)
            }
        }
    }

    /// Add the public key to a GitLab account. When the token lacks the `api` scope the key is copied and the add-key page opened.
    func addToGitLab(_ key: SSHKeyInfo, account: GitLabAccount) {
        busy = true
        problem = nil
        Task {
            defer { busy = false }
            do {
                switch try await GitLabAccountManager.shared.addSSHKey(account: account, title: Self.uploadTitle(key), publicKey: key.publicKey) {
                case .added:
                    notice = String(localized: "Đã thêm khoá “\(key.name)” lên \(account.host) @\(account.user.username).")
                case .alreadyExists:
                    notice = String(localized: "Khoá “\(key.name)” đã có trên \(account.host).")
                case .missingScope:
                    copyPublicKey(key)
                    NSWorkspace.shared.open(GitLabAccountManager.sshKeysPage(host: account.host))
                    notice = String(localized: "Token GitLab thiếu quyền api nên chưa thêm khoá tự động được. Đã sao chép khoá và mở trang GitLab — dán vào ô Key rồi bấm Add key.")
                }
            } catch {
                problem = FriendlyError.message(for: error)
            }
        }
    }

    // MARK: - Connection check

    /// `ssh -T git@<host>` using exactly Thaigit's keys (temporary agent), asking nothing (BatchMode). A host seen for the
    /// first time is added to known_hosts (accept-new) — just like a first clone.
    func testConnection(host: String) {
        connection[host] = nil
        busy = true
        let keys = keyring.privateKeys()
        let environment = environment?.value.variables ?? ProcessInfo.processInfo.environment
        Task {
            defer { busy = false }
            guard !keys.isEmpty else {
                connection[host] = .failure(String(localized: "Chưa có khoá SSH nào đang bật."))
                return
            }
            do {
                let agent = try await SSHAgentSession.start(keys: keys, environment: environment)
                defer { agent.stop() }
                var variables = environment
                variables["SSH_AUTH_SOCK"] = agent.socketPath
                let output = try await ProcessRunner.run(
                    executable: URL(fileURLWithPath: "/usr/bin/ssh"),
                    arguments: ["-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=15",
                                "git@\(host)"],
                    environment: variables
                )
                connection[host] = Self.connectionResult(output.stdoutString + "\n" + output.stderrString, host: host)
            } catch {
                connection[host] = .failure(FriendlyError.message(for: error))
            }
        }
    }

    /// Read the greeting from GitHub ("Hi alice! You've successfully authenticated…") / GitLab ("Welcome to GitLab, @alice!").
    static func connectionResult(_ text: String, host: String) -> ConnectionResult {
        for line in text.split(whereSeparator: \.isNewline) {
            let line = String(line)
            if let range = line.range(of: "Hi "), let end = line.range(of: "! You've successfully authenticated") {
                return .success(String(localized: "Đã kết nối \(host) với tài khoản @\(String(line[range.upperBound..<end.lowerBound]))."))
            }
            if let range = line.range(of: "Welcome to GitLab, ") {
                let user = line[range.upperBound...].trimmingCharacters(in: CharacterSet(charactersIn: "@! "))
                return .success(String(localized: "Đã kết nối \(host) với tài khoản @\(user)."))
            }
            if line.contains("successfully authenticated") || line.contains("logged in as") {
                return .success(String(localized: "Đã kết nối \(host)."))
            }
        }
        if text.contains("Permission denied") {
            return .failure(String(localized: "\(host) chưa nhận khoá nào của Thaigit — hãy thêm khoá công khai lên tài khoản trước."))
        }
        if text.contains("Host key verification failed") || text.contains("REMOTE HOST IDENTIFICATION HAS CHANGED") {
            return .failure(String(localized: "Khoá của máy chủ \(host) không khớp với lần trước (known_hosts). Kiểm tra lại mạng trước khi tiếp tục."))
        }
        return .failure(String(localized: "Không kết nối được tới \(host) qua SSH. Kiểm tra mạng hoặc tường lửa (cổng 22)."))
    }

    // MARK: - Internal

    private func perform(_ success: String, _ action: @escaping () throws -> Void) {
        problem = nil
        do {
            try action()
            keys = keyring.keys
            notice = success
        } catch {
            problem = FriendlyError.message(for: error)
        }
    }

    static var defaultKeyName: String {
        Host.current().localizedName ?? "Mac"
    }

    /// The comment in the public key: "thaigit@<machine name>".
    static var defaultComment: String {
        let host = (Host.current().localizedName ?? "mac").replacingOccurrences(of: " ", with: "-")
        return "thaigit@\(host)"
    }

    static func uploadTitle(_ key: SSHKeyInfo) -> String {
        "Thaigit — \(key.name)"
    }
}
