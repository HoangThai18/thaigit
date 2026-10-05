import Foundation

/// The git path plus the environment variables used for every git command.
public struct GitEnvironment: Sendable, Equatable {
    public var executable: URL
    public var variables: [String: String]

    public init(executable: URL, variables: [String: String]) {
        self.executable = executable
        self.variables = variables
    }

    /// An app opened from Finder / Dock only has a minimal PATH, so the common directories are added
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

        // Never let git wait for terminal input (the app has no terminal).
        env["GIT_TERMINAL_PROMPT"] = "0"
        // Don't open an editor: merge / revert / rebase --continue use the default message.
        env["GIT_EDITOR"] = "true"
        env["GIT_MERGE_AUTOEDIT"] = "no"
        env["GIT_PAGER"] = "cat"
        env["PAGER"] = "cat"
        // Git's messages stay English so error detection is stable; UTF-8 is still kept.
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

    /// Prefer the git the user pointed at, then Homebrew, and finally /usr/bin/git (Apple's).
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

    /// Read PATH from the user's login shell (like VS Code) so hooks / credential helpers behave.
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

/// Holds the current git environment; every GitRunner reads the latest value on each command run,
/// so once the login-shell PATH has loaded (or after a GitHub sign-in / sign-out) open repos pick it up immediately.
public final class GitEnvironmentStore: @unchecked Sendable {
    private let lock = NSLock()
    private var current: GitEnvironment
    private var github: GitHubCredentialSet?
    private var ssh: SSHKeyring?
    private var gitlab: GitLabGitAccess?

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

    /// The signed-in GitHub accounts plus the owner → account table (nil: not signed in) — used for network commands to
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

    /// Thaigit's SSH keys: a command touching an SSH remote loads these into a temporary ssh-agent (nil: don't use them).
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

    /// GitLab accounts plus the helper path: a command touching an HTTPS remote of a signed-in GitLab host receives the token.
    public var gitlabAccess: GitLabGitAccess? {
        get {
            lock.lock()
            defer { lock.unlock() }
            return gitlab
        }
        set {
            lock.lock()
            gitlab = newValue
            lock.unlock()
        }
    }

    /// The environment plus the GitHub / GitLab accounts and SSH keys read under one lock, for one git command.
    func snapshot() -> (environment: GitEnvironment, github: GitHubCredentialSet?, ssh: SSHKeyring?, gitlab: GitLabGitAccess?) {
        lock.lock()
        defer { lock.unlock() }
        return (current, github, ssh, gitlab)
    }
}

/// GitLab accounts for a git command: the account list plus the path of the `gitlab-credential.sh` script.
public struct GitLabGitAccess: Sendable {
    public let accounts: GitLabAccounts
    public let helperPath: String

    public init(accounts: GitLabAccounts, helperPath: String) {
        self.accounts = accounts
        self.helperPath = helperPath
    }
}

/// The askpass script: when git/ssh needs a username, password, token or passphrase,
/// a macOS dialog is shown instead of hanging waiting on a terminal.
public enum AskPass {
    public static var script: String { #"""
    #!/bin/sh
    # Thaigit — auth dialog for git/ssh (GIT_ASKPASS / SSH_ASKPASS).
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

    /// The dialog text, in the app's language. Characters special to the shell / AppleScript are stripped so no
    /// translation can break the command.
    enum Labels {
        static var fallbackPrompt: String { safe(String(localized: "Git cần thông tin xác thực")) }
        static var no: String { safe(String(localized: "Không")) }
        static var yes: String { safe(String(localized: "Đồng ý")) }
        static var cancel: String { safe(String(localized: "Huỷ")) }

        static func safe(_ text: String) -> String {
            String(text.filter { !"\"'\\$`".contains($0) })
        }
    }

    /// Write the script to ~/Library/Application Support/Thaigit/askpass.sh and return its path.
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
