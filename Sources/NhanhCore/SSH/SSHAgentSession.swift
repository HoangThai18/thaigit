import Foundation

/// A temporary ssh-agent for ONE git command touching an SSH remote (like 1Password's agent): the secret key
/// goes straight from the Keychain into the agent over the stdin of `ssh-add -` — nothing is written to a
/// file. The socket lives in its own 0700 directory under /tmp (a Unix socket path has to be short); when
/// the command finishes the agent is stopped and the directory removed. Keys in the agent expire after
/// `lifetime` seconds, in case the app is force-quit while a command is running.
public final class SSHAgentSession: @unchecked Sendable {
    public static let agentPath = "/usr/bin/ssh-agent"
    public static let addPath = "/usr/bin/ssh-add"
    public static let lifetime = 900

    public let socketPath: String
    private let process: Process
    private let directory: URL

    private init(socketPath: String, process: Process, directory: URL) {
        self.socketPath = socketPath
        self.process = process
        self.directory = directory
    }

    /// Build the agent and load `keys`. `environment`: the git command's environment (so ssh-add can ask for
    /// a passphrase through the app's askpass).
    /// A key that fails to load (wrong passphrase, cancelled dialog…) is skipped — ssh still tries the rest.
    public static func start(keys: [Data], environment: [String: String]) async throws -> SSHAgentSession {
        let fileManager = FileManager.default
        guard fileManager.isExecutableFile(atPath: agentPath), fileManager.isExecutableFile(atPath: addPath) else {
            throw SSHKeyError.agentUnavailable
        }
        var template = Array("/tmp/thaigit-ssh.XXXXXX".utf8CString)
        guard let created = mkdtemp(&template) else { throw SSHKeyError.agentUnavailable }
        let directory = URL(fileURLWithPath: String(cString: created), isDirectory: true)
        let socketPath = directory.appendingPathComponent("agent").path

        let process = Process()
        process.executableURL = URL(fileURLWithPath: agentPath)
        process.arguments = ["-D", "-a", socketPath]
        process.environment = environment.filter { $0.key != "SSH_AUTH_SOCK" && $0.key != "SSH_AGENT_PID" }
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        do {
            try process.run()
        } catch {
            try? fileManager.removeItem(at: directory)
            throw SSHKeyError.agentUnavailable
        }
        let session = SSHAgentSession(socketPath: socketPath, process: process, directory: directory)

        // Wait for the agent to open its socket (usually a few ms).
        var waited = 0
        while !fileManager.fileExists(atPath: socketPath) {
            guard process.isRunning, waited < 3000 else {
                session.stop()
                throw SSHKeyError.agentUnavailable
            }
            try? await Task.sleep(nanoseconds: 10_000_000)
            waited += 10
        }

        var addEnvironment = environment
        addEnvironment["SSH_AUTH_SOCK"] = socketPath
        for key in keys {
            _ = try? await ProcessRunner.run(
                executable: URL(fileURLWithPath: addPath),
                arguments: ["-q", "-t", String(lifetime), "-"],
                environment: addEnvironment,
                input: key
            )
        }
        return session
    }

    /// Stop the agent and remove the socket. Safe to call repeatedly.
    public func stop() {
        if process.isRunning { process.terminate() }
        try? FileManager.default.removeItem(at: directory)
    }

    deinit { stop() }
}
