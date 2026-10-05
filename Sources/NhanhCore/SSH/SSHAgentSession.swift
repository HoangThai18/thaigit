import Foundation

/// ssh-agent tạm cho MỘT lệnh git chạm remote SSH (như agent của 1Password): khoá bí mật đi thẳng từ Keychain vào agent qua
/// stdin của `ssh-add -` — không ghi ra file nào. Socket nằm trong thư mục riêng quyền 0700 dưới /tmp (đường dẫn socket
/// Unix phải ngắn); lệnh xong thì dừng agent và xoá thư mục. Khoá trong agent tự hết hạn sau `lifetime` giây phòng khi app
/// bị tắt ngang lúc lệnh đang chạy.
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

    /// Dựng agent và nạp `keys`. `environment`: môi trường của lệnh git (để ssh-add hỏi passphrase qua askpass của app).
    /// Khoá nào nạp lỗi (sai passphrase, huỷ hộp thoại…) thì bỏ qua — ssh vẫn thử các khoá khác.
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

        // Chờ agent mở socket (thường vài ms).
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

    /// Dừng agent và xoá socket. Gọi nhiều lần không sao.
    public func stop() {
        if process.isRunning { process.terminate() }
        try? FileManager.default.removeItem(at: directory)
    }

    deinit { stop() }
}
