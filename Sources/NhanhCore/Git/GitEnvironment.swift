import Foundation

/// Đường dẫn git + biến môi trường dùng cho mọi lệnh git.
public struct GitEnvironment: Sendable, Equatable {
    public var executable: URL
    public var variables: [String: String]

    public init(executable: URL, variables: [String: String]) {
        self.executable = executable
        self.variables = variables
    }

    /// App mở từ Finder/Dock chỉ có PATH tối thiểu, nên bổ sung các thư mục hay gặp
    /// (Homebrew, git-lfs, gh credential helper, gpg...).
    public static let fallbackPaths = [
        "/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin",
        "/usr/bin", "/bin", "/usr/sbin", "/sbin",
    ]

    public static func make(customGitPath: String?, loginShellPath: String?, askPassScript: String?) -> GitEnvironment {
        var env = ProcessInfo.processInfo.environment

        var components: [String] = []
        for source in [loginShellPath, env["PATH"]] {
            if let source { components += source.split(separator: ":").map(String.init) }
        }
        components += fallbackPaths
        var seen = Set<String>()
        let path = components.filter { !$0.isEmpty && seen.insert($0).inserted }.joined(separator: ":")
        env["PATH"] = path

        // Không bao giờ để git chờ nhập từ terminal (app không có terminal).
        env["GIT_TERMINAL_PROMPT"] = "0"
        // Không mở trình soạn thảo: merge/revert/rebase --continue dùng message mặc định.
        env["GIT_EDITOR"] = "true"
        env["GIT_MERGE_AUTOEDIT"] = "no"
        env["GIT_PAGER"] = "cat"
        env["PAGER"] = "cat"
        // Thông báo của git luôn bằng tiếng Anh để nhận diện lỗi ổn định; vẫn giữ UTF-8.
        env.removeValue(forKey: "LC_ALL")
        if env["LANG"] == nil { env["LANG"] = "en_US.UTF-8" }
        env["LC_MESSAGES"] = "C"
        env["LANGUAGE"] = "en"

        if let askPassScript {
            env["GIT_ASKPASS"] = askPassScript
            env["SSH_ASKPASS"] = askPassScript
            env["SSH_ASKPASS_REQUIRE"] = "force"
            if env["DISPLAY"] == nil { env["DISPLAY"] = ":0" }
        }

        return GitEnvironment(executable: resolveGit(custom: customGitPath, searchPath: path), variables: env)
    }

    /// Ưu tiên git do người dùng chỉ định, sau đó Homebrew, cuối cùng /usr/bin/git (Apple).
    public static func resolveGit(custom: String?, searchPath: String) -> URL {
        let fm = FileManager.default
        if let custom, !custom.isEmpty, fm.isExecutableFile(atPath: custom) {
            return URL(fileURLWithPath: custom)
        }
        let dirs = ["/opt/homebrew/bin", "/usr/local/bin"] + searchPath.split(separator: ":").map(String.init) + ["/usr/bin"]
        for dir in dirs {
            let candidate = (dir as NSString).appendingPathComponent("git")
            if fm.isExecutableFile(atPath: candidate) { return URL(fileURLWithPath: candidate) }
        }
        return URL(fileURLWithPath: "/usr/bin/git")
    }

    /// Lấy PATH từ login shell của người dùng (giống VS Code) để hooks/credential helper chạy đúng.
    public static func loginShellPATH(timeout: TimeInterval = 5) async -> String? {
        let shell = ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh"
        let marker = "__NHANH_ENV_BEGIN__"
        let result: ProcessOutput?
        do {
            result = try await withThrowingTaskGroup(of: ProcessOutput?.self) { group in
                group.addTask {
                    try await ProcessRunner.run(
                        executable: URL(fileURLWithPath: shell),
                        arguments: ["-l", "-i", "-c", "echo \(marker); /usr/bin/env"],
                        environment: ProcessInfo.processInfo.environment
                    )
                }
                group.addTask {
                    try await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
                    return nil
                }
                let first = try await group.next() ?? nil
                group.cancelAll()
                return first
            }
        } catch {
            return nil
        }
        guard let result else { return nil }
        let text = result.stdoutString
        guard let range = text.range(of: marker) else { return nil }
        for line in text[range.upperBound...].split(separator: "\n") where line.hasPrefix("PATH=") {
            let value = String(line.dropFirst(5))
            return value.isEmpty ? nil : value
        }
        return nil
    }
}

/// Lưu môi trường git hiện tại; mọi GitRunner đọc giá trị mới nhất mỗi lần chạy lệnh,
/// nên khi PATH từ login shell được nạp xong (hay khi đăng nhập / đăng xuất GitHub) thì các repo đang mở dùng ngay.
public final class GitEnvironmentStore: @unchecked Sendable {
    private let lock = NSLock()
    private var current: GitEnvironment
    private var github: GitHubCredentialSet?
    private var ssh: SSHKeyring?

    public init(_ environment: GitEnvironment) {
        current = environment
    }

    public var value: GitEnvironment {
        lock.lock()
        defer { lock.unlock() }
        return current
    }

    public func update(_ environment: GitEnvironment) {
        lock.lock()
        current = environment
        lock.unlock()
    }

    /// Các tài khoản GitHub đã đăng nhập + bảng owner → tài khoản (nil: chưa đăng nhập) — dùng cho lệnh mạng tới
    /// https://github.com.
    public var githubCredentials: GitHubCredentialSet? {
        get {
            lock.lock()
            defer { lock.unlock() }
            return github
        }
        set {
            lock.lock()
            github = newValue
            lock.unlock()
        }
    }

    /// Khoá SSH của Thaigit: lệnh chạm remote SSH được nạp các khoá này vào một ssh-agent tạm (nil: không dùng).
    public var sshKeyring: SSHKeyring? {
        get {
            lock.lock()
            defer { lock.unlock() }
            return ssh
        }
        set {
            lock.lock()
            ssh = newValue
            lock.unlock()
        }
    }

    /// Môi trường + tài khoản GitHub + khoá SSH đọc trong cùng một lần khoá, cho một lệnh git.
    func snapshot() -> (environment: GitEnvironment, github: GitHubCredentialSet?, ssh: SSHKeyring?) {
        lock.lock()
        defer { lock.unlock() }
        return (current, github, ssh)
    }
}

/// Script askpass: khi git/ssh cần username, password, token hoặc passphrase,
/// hiện hộp thoại macOS thay vì treo chờ terminal.
public enum AskPass {
    public static var script: String { #"""
    #!/bin/sh
    # Thaigit — hộp thoại xác thực cho git/ssh (GIT_ASKPASS / SSH_ASKPASS).
    prompt="$1"
    [ -z "$prompt" ] && prompt="\#(Labels.fallbackPrompt)"
    case "$prompt" in
      *"(yes/no"*)
        exec /usr/bin/osascript \
          -e 'on run argv' \
          -e 'activate' \
          -e 'set r to display dialog (item 1 of argv) buttons {"\#(Labels.no)", "\#(Labels.yes)"} default button "\#(Labels.yes)" with title "Thaigit" with icon caution' \
          -e 'if button returned of r is "\#(Labels.yes)" then return "yes"' \
          -e 'return "no"' \
          -e 'end run' "$prompt" ;;
      *[Pp]assword*|*[Pp]assphrase*|*PIN*|*[Tt]oken*)
        exec /usr/bin/osascript \
          -e 'on run argv' \
          -e 'activate' \
          -e 'set r to display dialog (item 1 of argv) default answer "" with hidden answer buttons {"\#(Labels.cancel)", "OK"} default button "OK" cancel button "\#(Labels.cancel)" with title "Thaigit" with icon note' \
          -e 'return text returned of r' \
          -e 'end run' "$prompt" ;;
      *)
        exec /usr/bin/osascript \
          -e 'on run argv' \
          -e 'activate' \
          -e 'set r to display dialog (item 1 of argv) default answer "" buttons {"\#(Labels.cancel)", "OK"} default button "OK" cancel button "\#(Labels.cancel)" with title "Thaigit" with icon note' \
          -e 'return text returned of r' \
          -e 'end run' "$prompt" ;;
    esac
    """#
    }

    /// Chữ trong hộp thoại, theo ngôn ngữ của app. Bỏ ký tự có nghĩa đặc biệt với shell / AppleScript để bản dịch nào cũng
    /// không phá được lệnh.
    enum Labels {
        static var fallbackPrompt: String { safe(String(localized: "Git cần thông tin xác thực")) }
        static var no: String { safe(String(localized: "Không")) }
        static var yes: String { safe(String(localized: "Đồng ý")) }
        static var cancel: String { safe(String(localized: "Huỷ")) }

        static func safe(_ text: String) -> String {
            String(text.filter { !"\"'\\$`".contains($0) })
        }
    }

    /// Ghi script vào ~/Library/Application Support/Thaigit/askpass.sh và trả về đường dẫn.
    public static func install() -> String? {
        let fm = FileManager.default
        guard let support = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return nil }
        let dir = support.appendingPathComponent("Thaigit", isDirectory: true)
        do {
            try fm.createDirectory(at: dir, withIntermediateDirectories: true)
            let url = dir.appendingPathComponent("askpass.sh")
            let data = Data(script.utf8)
            if (try? Data(contentsOf: url)) != data {
                try data.write(to: url, options: .atomic)
            }
            try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: url.path)
            return url.path
        } catch {
            return nil
        }
    }
}
