import Foundation

/// Lỗi khi lệnh git trả mã thoát không mong đợi.
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
        return "Lệnh git \(arguments.first ?? "") thất bại (mã thoát \(exitCode))."
    }

    public var errorDescription: String? { message }
    public var description: String { message }
    public var commandLine: String { "git " + arguments.joined(separator: " ") }

    /// Toàn bộ output, dùng để nhận diện các lỗi quen thuộc.
    public var combinedOutput: String { stderr + "\n" + stdout }

    public func contains(_ needle: String) -> Bool {
        combinedOutput.range(of: needle, options: .caseInsensitive) != nil
    }
}

/// Một dòng nhật ký lệnh git đã chạy (để hiển thị trong "Nhật ký lệnh").
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

    /// Ghi đè cấu hình người dùng có thể làm hỏng việc parse output.
    public static let globalArguments: [String] = [
        "-c", "core.quotepath=false",
        "-c", "color.ui=false",
        "-c", "core.pager=cat",
        "-c", "log.showSignature=false",
        "-c", "diff.noprefix=false",
        "-c", "diff.mnemonicPrefix=false",
        // true thì dòng ngữ cảnh rỗng thành dòng trống (thiếu " "): parser bỏ qua nên patch dựng lại sai ngữ cảnh.
        "-c", "diff.suppressBlankEmpty=false",
        "-c", "advice.detachedHead=false",
        // Repo lạ có thể đặt core.fsmonitor thành một lệnh tuỳ ý trong .git/config; app chạy `git status`
        // tự động khi mở/làm mới repo nên tắt hẳn để mở repo không bao giờ chạy lệnh của repo.
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

    /// `credentialURLs`: địa chỉ remote mà lệnh mạng này thật sự chạm, do người gọi đọc từ cấu hình remote (xem
    /// `GitRepository.remoteURLs`) — không đoán từ tham số. Chỉ khi có địa chỉ https://github.com và đã đăng nhập mới
    /// thêm credential helper + token của đúng các tài khoản dùng cho những địa chỉ đó.
    @discardableResult
    public func run(
        _ arguments: [String],
        input: Data? = nil,
        acceptExitCodes: Set<Int32> = [0],
        environment extra: [String: String] = [:],
        credentialURLs: [String] = [],
        onProgress: (@Sendable (String) -> Void)? = nil
    ) async throws -> ProcessOutput {
        let (environment, github) = environmentStore.snapshot()
        // Lệnh chạm remote HTTPS trên github.com: thêm credential helper chọn token theo owner, đọc token từ biến môi
        // trường của riêng tiến trình này. Nhật ký lệnh và GitError chỉ giữ `arguments` của người gọi — không chứa token.
        let credentials = GitCredentialInjection.additions(forURLs: credentialURLs, credentials: github)
        var variables = environment.variables
        for (key, value) in credentials.environment { variables[key] = value }
        for (key, value) in extra { variables[key] = value }
        let start = Date()
        let output = try await ProcessRunner.run(
            executable: environment.executable,
            arguments: Self.globalArguments + credentials.arguments + arguments,
            currentDirectory: workingDirectory,
            environment: variables,
            input: input,
            onStderrLine: onProgress
        )
        // Lệnh bị dừng vì Task bị huỷ: báo huỷ thay vì lỗi git (mã thoát 15).
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

    /// Che "user:mật-khẩu@" (hoặc token đặt làm username) của mọi URL trong một tham số trước khi ghi nhật ký lệnh:
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
    /// Danh sách đường dẫn ngăn cách bằng NUL, dùng với --pathspec-from-file=- --pathspec-file-nul.
    var nulSeparatedData: Data {
        var data = Data()
        for path in self {
            data.append(contentsOf: [UInt8](path.utf8))
            data.append(0)
        }
        return data
    }
}
