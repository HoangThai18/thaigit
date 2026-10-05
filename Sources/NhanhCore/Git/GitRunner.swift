import Foundation

/// A git command returned an unexpected exit code.
public struct GitError: LocalizedError, Sendable, CustomStringConvertible {
    public let arguments: [String]
    public let exitCode: Int32
    public let stdout: String
    public let stderr: String

    public init(arguments: [String], exitCode: Int32, stdout: String, stderr: String) {
        self.arguments = arguments
        self.exitCode = exitCode
        self.stdout = stdout
        self.stderr = stderr
    }

    public var message: String {
        let err = stderr.trimmingCharacters(in: .whitespacesAndNewlines)
        let out = stdout.trimmingCharacters(in: .whitespacesAndNewlines)
        if !err.isEmpty && !out.isEmpty && exitCode != 0 && out.count < 2000 {
            return out + "\n" + err
        }
        if !err.isEmpty { return err }
        if !out.isEmpty { return out }
        return String(localized: "Lệnh git \(arguments.first ?? "") thất bại (mã thoát \(exitCode)).")
    }

    public var errorDescription: String? { message }
    public var description: String { message }
    public var commandLine: String { "git " + arguments.joined(separator: " ") }

    /// The complete output, used to recognise familiar errors.
    public var combinedOutput: String { stderr + "\n" + stdout }

    public func contains(_ needle: String) -> Bool {
        combinedOutput.range(of: needle, options: .caseInsensitive) != nil
    }
}

/// One line of the git command log (shown in "Command log").
public struct GitCommandRecord: Sendable, Identifiable, Hashable {
    public let id: UUID
    public let arguments: [String]
    public let startedAt: Date
    public let duration: TimeInterval
    public let exitCode: Int32
    public let stderr: String

    public init(arguments: [String], startedAt: Date, duration: TimeInterval, exitCode: Int32, stderr: String) {
        self.id = UUID()
        self.arguments = arguments
        self.startedAt = startedAt
        self.duration = duration
        self.exitCode = exitCode
        self.stderr = stderr
    }

    public var commandLine: String { "git " + arguments.joined(separator: " ") }
}

public struct GitRunner: Sendable {
    public let environmentStore: GitEnvironmentStore
    public let workingDirectory: URL?
    public let logger: (@Sendable (GitCommandRecord) -> Void)?

    /// Overriding the user's config could break output parsing.
    public static let globalArguments: [String] = [
        "-c", "core.quotepath=false",
        "-c", "color.ui=false",
        "-c", "core.pager=cat",
        "-c", "log.showSignature=false",
        "-c", "diff.noprefix=false",
        "-c", "diff.mnemonicPrefix=false",
        // true would make an empty context line a blank line (losing the " "): the parser skips it and the rebuilt patch gets wrong context.
        "-c", "diff.suppressBlankEmpty=false",
        "-c", "advice.detachedHead=false",
        // An untrusted repo may set core.fsmonitor to an arbitrary command in .git/config; the app runs `git status`
        // automatically when opening / refreshing a repo, so it's disabled outright — opening a repo never runs a command from the repo.
        "-c", "core.fsmonitor=false",
    ]

    public init(environmentStore: GitEnvironmentStore, workingDirectory: URL?, logger: (@Sendable (GitCommandRecord) -> Void)? = nil) {
        self.environmentStore = environmentStore
        self.workingDirectory = workingDirectory
        self.logger = logger
    }

    public func at(_ directory: URL) -> GitRunner {
        GitRunner(environmentStore: environmentStore, workingDirectory: directory, logger: logger)
    }

    /// `credentialURLs`: the remote addresses this network command really touches, read by the caller from the
    /// remote config (see `GitRepository.remoteURLs`) — never guessed from the arguments. The credential helper
    /// and the tokens of exactly the accounts used for those addresses are added only when there is a
    /// https://github.com address and the user is signed in.
    @discardableResult
    public func run(
        _ arguments: [String],
        input: Data? = nil,
        acceptExitCodes: Set<Int32> = [0],
        environment extra: [String: String] = [:],
        credentialURLs: [String] = [],
        onProgress: (@Sendable (String) -> Void)? = nil
    ) async throws -> ProcessOutput {
        let (environment, github, ssh, gitlab) = environmentStore.snapshot()
        // The command touches an HTTPS remote on github.com: add a credential helper that picks the token by
        // owner, with tokens read from environment variables of this process alone. The command log and GitError
        // keep only the caller's `arguments` — never a token.
        var credentials = GitCredentialInjection.additions(forURLs: credentialURLs, credentials: github)
        // HTTPS remote on a signed-in GitLab host (gitlab.com, self-hosted GitLab): token via its own helper, and an
        // OAuth token about to expire is renewed first.
        if let gitlab, !credentialURLs.isEmpty {
            let credential = await gitlab.accounts.credential(forURLs: credentialURLs)
            let extra = GitLabCredentialInjection.additions(for: credential, helperPath: gitlab.helperPath)
            credentials.arguments += extra.arguments
            for (key, value) in extra.environment { credentials.environment[key] = value }
        }
        var variables = environment.variables
        for (key, value) in credentials.environment { variables[key] = value }
        for (key, value) in extra { variables[key] = value }
        // The command touches an SSH remote and Thaigit has SSH keys: a temporary ssh-agent for this command only
        // (keys go from the Keychain into the agent, nothing is written to a file). If the agent fails, the
        // command runs as usual with the user's own agent / ~/.ssh keys.
        var agent: SSHAgentSession?
        if let ssh, credentialURLs.contains(where: SSHRemoteURL.isSSH) {
            let keys = ssh.privateKeys()
            if !keys.isEmpty, let session = try? await SSHAgentSession.start(keys: keys, environment: variables) {
                agent = session
                variables["SSH_AUTH_SOCK"] = session.socketPath
            }
        }
        defer { agent?.stop() }
        let start = Date()
        let output = try await ProcessRunner.run(
            executable: environment.executable,
            arguments: Self.globalArguments + credentials.arguments + arguments,
            currentDirectory: workingDirectory,
            environment: variables,
            input: input,
            onStderrLine: onProgress
        )
        // The command was stopped because the Task was cancelled: report cancellation instead of a git error (exit code 15).
        try Task.checkCancellation()
        logger?(GitCommandRecord(
            arguments: arguments.map(Self.maskingUserInfo),
            startedAt: start,
            duration: Date().timeIntervalSince(start),
            exitCode: output.exitCode,
            stderr: String(output.stderrString.prefix(4000))
        ))
        guard acceptExitCodes.contains(output.exitCode) else {
            throw GitError(arguments: arguments, exitCode: output.exitCode, stdout: output.stdoutString, stderr: output.stderrString)
        }
        return output
    }

    public func output(_ arguments: [String], input: Data? = nil, acceptExitCodes: Set<Int32> = [0], environment extra: [String: String] = [:],
                       credentialURLs: [String] = []) async throws -> String {
        try await run(arguments, input: input, acceptExitCodes: acceptExitCodes, environment: extra, credentialURLs: credentialURLs).stdoutString
    }

    /// Hides the "user:password@" (or a token placed as the username) of every URL in an argument before it reaches the command log:
    /// "https://ten:mk@git.vd.vn/a.git" → "https://***@git.vd.vn/a.git".
    static func maskingUserInfo(_ argument: String) -> String {
        guard argument.contains("://") else { return argument }
        var result = ""
        var rest = Substring(argument)
        while let scheme = rest.range(of: "://") {
            result += rest[..<scheme.upperBound]
            let authority = rest[scheme.upperBound...]
            let authorityEnd = authority.firstIndex { $0 == "/" || $0.isWhitespace } ?? authority.endIndex
            if let at = authority[..<authorityEnd].lastIndex(of: "@") {
                result += "***"
                rest = authority[at...]
            } else {
                rest = authority
            }
        }
        return result + rest
    }
}

extension Array where Element == String {
    /// A NUL-separated path list, used with --pathspec-from-file=- --pathspec-file-nul.
    var nulSeparatedData: Data {
        var data = Data()
        for path in self {
            data.append(contentsOf: [UInt8](path.utf8))
            data.append(0)
        }
        return data
    }
}
