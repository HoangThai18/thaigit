import Foundation

/// Kết quả chạy một tiến trình con.
public struct ProcessOutput: Sendable {
    public let exitCode: Int32
    public let stdout: Data
    public let stderr: Data

    public init(exitCode: Int32, stdout: Data, stderr: Data) {
        self.exitCode = exitCode
        self.stdout = stdout
        self.stderr = stderr
    }

    public var stdoutString: String { String(decoding: stdout, as: UTF8.self) }
    public var stderrString: String { String(decoding: stderr, as: UTF8.self) }
}

/// Hộp giá trị có khoá, dùng để gom dữ liệu từ nhiều luồng đọc pipe.
final class LockedBox<Value>: @unchecked Sendable {
    private var value: Value
    private let lock = NSLock()

    init(_ value: Value) { self.value = value }

    func withValue<R>(_ body: (inout Value) throws -> R) rethrows -> R {
        lock.lock()
        defer { lock.unlock() }
        return try body(&value)
    }

    var current: Value { withValue { $0 } }
}

/// Gói các đối tượng Foundation (không Sendable) của một tiến trình để dùng trong closure chạy nền.
private final class ProcessHandles: @unchecked Sendable {
    let process = Process()
    let stdout = Pipe()
    let stderr = Pipe()
    let stdin: Pipe?

    init(hasInput: Bool) {
        stdin = hasInput ? Pipe() : nil
    }
}

public enum ProcessRunner {
    /// Ghi vào pipe của tiến trình đã thoát sẽ phát SIGPIPE và giết app — bỏ qua tín hiệu này.
    private static let ignoreSigpipe: Bool = {
        signal(SIGPIPE, SIG_IGN)
        return true
    }()

    /// Chạy tiến trình, đọc stdout/stderr song song (tránh deadlock khi output lớn).
    /// Huỷ Task sẽ gửi SIGTERM cho tiến trình.
    public static func run(
        executable: URL,
        arguments: [String],
        currentDirectory: URL? = nil,
        environment: [String: String]? = nil,
        input: Data? = nil,
        onStderrLine: (@Sendable (String) -> Void)? = nil
    ) async throws -> ProcessOutput {
        _ = ignoreSigpipe
        let handles = ProcessHandles(hasInput: input != nil)
        let process = handles.process
        process.executableURL = executable
        process.arguments = arguments
        if let currentDirectory { process.currentDirectoryURL = currentDirectory }
        if let environment { process.environment = environment }
        process.standardOutput = handles.stdout
        process.standardError = handles.stderr
        process.standardInput = handles.stdin ?? FileHandle.nullDevice

        try Task.checkCancellation()

        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<ProcessOutput, any Error>) in
                let group = DispatchGroup()
                let outBox = LockedBox(Data())
                let errBox = LockedBox(Data())

                group.enter()
                handles.process.terminationHandler = { _ in group.leave() }
                do {
                    try handles.process.run()
                } catch {
                    handles.process.terminationHandler = nil
                    continuation.resume(throwing: ProcessLaunchError(executable: executable.path, underlying: error.localizedDescription))
                    return
                }

                group.enter()
                DispatchQueue.global(qos: .userInitiated).async {
                    let data = handles.stdout.fileHandleForReading.readDataToEndOfFile()
                    outBox.withValue { $0 = data }
                    group.leave()
                }

                group.enter()
                DispatchQueue.global(qos: .userInitiated).async {
                    let handle = handles.stderr.fileHandleForReading
                    if let onStderrLine {
                        var pending = Data()
                        while true {
                            let chunk = handle.availableData
                            if chunk.isEmpty { break }
                            errBox.withValue { $0.append(chunk) }
                            pending.append(chunk)
                            // git dùng \r để cập nhật dòng tiến độ, \n cho dòng mới.
                            while let index = pending.firstIndex(where: { $0 == 0x0A || $0 == 0x0D }) {
                                let lineData = pending[pending.startIndex..<index]
                                pending.removeSubrange(pending.startIndex...index)
                                let line = String(decoding: lineData, as: UTF8.self)
                                    .trimmingCharacters(in: .whitespaces)
                                if !line.isEmpty { onStderrLine(line) }
                            }
                        }
                        if !pending.isEmpty {
                            let line = String(decoding: pending, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
                            if !line.isEmpty { onStderrLine(line) }
                        }
                    } else {
                        let data = handle.readDataToEndOfFile()
                        errBox.withValue { $0 = data }
                    }
                    group.leave()
                }

                if let input, let stdin = handles.stdin {
                    DispatchQueue.global(qos: .userInitiated).async {
                        let writer = stdin.fileHandleForWriting
                        try? writer.write(contentsOf: input)
                        try? writer.close()
                    }
                }

                group.notify(queue: .global(qos: .userInitiated)) {
                    continuation.resume(returning: ProcessOutput(
                        exitCode: handles.process.terminationStatus,
                        stdout: outBox.current,
                        stderr: errBox.current
                    ))
                }
            }
        } onCancel: {
            if handles.process.isRunning { handles.process.terminate() }
        }
    }
}

public struct ProcessLaunchError: LocalizedError, Sendable {
    public let executable: String
    public let underlying: String

    public var errorDescription: String? {
        String(localized: "Không chạy được \(executable): \(underlying)")
    }
}
