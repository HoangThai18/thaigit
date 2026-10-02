import Foundation

/// Chạy từng lệnh shell cho terminal đơn giản trong app: mỗi lệnh một tiến trình zsh không tương tác (stdin trống),
/// output trả về theo dòng khi có, nhớ thư mục sau `cd`. Không giả lập terminal: chương trình cần bàn phím (vim, less,
/// hỏi mật khẩu) sẽ không dùng được — đặt PAGER=cat, GIT_TERMINAL_PROMPT=0 để lệnh không chờ nhập.
public enum TerminalShell {
    public struct Result: Sendable, Equatable {
        public let exitCode: Int32
        /// Thư mục sau khi chạy (đổi khi lệnh có `cd`).
        public let directory: URL
    }

    /// Dấu đánh dấu dòng báo thư mục cuối (ký tự 0x1E không xuất hiện trong output thường).
    static let marker = "\u{1E}THAIGIT_PWD:"

    static let script = """
    cd -- "$THAIGIT_CWD" || exit 1
    eval "$THAIGIT_COMMAND"
    __thaigit_status=$?
    printf '\\036THAIGIT_PWD:%s\\n' "$PWD"
    exit $__thaigit_status
    """

    /// Biến môi trường cho lệnh: không màu, không pager, không hỏi mật khẩu trên terminal.
    public static func environment(base: [String: String]) -> [String: String] {
        var environment = base
        environment["TERM"] = "dumb"
        environment["PAGER"] = "cat"
        environment["GIT_PAGER"] = "cat"
        environment["GIT_TERMINAL_PROMPT"] = "0"
        environment["NO_COLOR"] = "1"
        environment["CLICOLOR"] = "0"
        return environment
    }

    /// Chạy `command` trong `directory`. `onLine(dòng, làLỗi)` được gọi cho từng dòng output (đã bỏ mã màu ANSI).
    /// Huỷ Task thì dừng lệnh (SIGTERM cho các tiến trình con rồi cho shell).
    public static func run(
        _ command: String,
        in directory: URL,
        environment: [String: String],
        loginShell: Bool = true,
        shell: URL = URL(fileURLWithPath: "/bin/zsh"),
        onLine: @escaping @Sendable (String, Bool) -> Void
    ) async throws -> Result {
        let process = Process()
        process.executableURL = shell
        process.arguments = (loginShell ? ["-l"] : []) + ["-c", script]
        var env = environment
        env["THAIGIT_CWD"] = directory.path
        env["THAIGIT_COMMAND"] = command
        process.environment = env
        process.currentDirectoryURL = directory
        let stdout = Pipe()
        let stderr = Pipe()
        process.standardOutput = stdout
        process.standardError = stderr
        process.standardInput = FileHandle.nullDevice
        let finalDirectory = LockedBox<String?>(nil)

        try Task.checkCancellation()
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Result, any Error>) in
                let group = DispatchGroup()
                group.enter()
                process.terminationHandler = { _ in group.leave() }
                do {
                    try process.run()
                } catch {
                    process.terminationHandler = nil
                    continuation.resume(throwing: ProcessLaunchError(executable: shell.path, underlying: error.localizedDescription))
                    return
                }
                for (pipe, isError) in [(stdout, false), (stderr, true)] {
                    group.enter()
                    DispatchQueue.global(qos: .userInitiated).async {
                        var splitter = LineSplitter()
                        let handle = pipe.fileHandleForReading
                        func emit(_ line: String) {
                            // Dấu thư mục có thể dính sau dòng cuối chưa xuống dòng của lệnh ("abc\u{1E}THAIGIT_PWD:/x").
                            if !isError, let range = line.range(of: marker) {
                                let before = String(line[..<range.lowerBound])
                                if !before.isEmpty { onLine(TerminalText.clean(before), false) }
                                finalDirectory.withValue { $0 = String(line[range.upperBound...]) }
                            } else {
                                onLine(TerminalText.clean(line), isError)
                            }
                        }
                        while true {
                            let chunk = handle.availableData
                            if chunk.isEmpty { break }
                            splitter.append(chunk).forEach(emit)
                        }
                        splitter.finish().forEach(emit)
                        group.leave()
                    }
                }
                group.notify(queue: .global(qos: .userInitiated)) {
                    let path = finalDirectory.current
                    continuation.resume(returning: Result(
                        exitCode: process.terminationStatus,
                        directory: path.map { URL(fileURLWithPath: $0) } ?? directory))
                }
            }
        } onCancel: {
            guard process.isRunning else { return }
            // Shell chạy lệnh trong tiến trình con: dừng con trước (pkill -P), rồi tới shell.
            let pid = process.processIdentifier
            let killer = Process()
            killer.executableURL = URL(fileURLWithPath: "/usr/bin/pkill")
            killer.arguments = ["-TERM", "-P", String(pid)]
            try? killer.run()
            killer.waitUntilExit()
            process.terminate()
        }
    }
}

/// Tách byte thành dòng UTF-8 (giữ phần cuối chưa có "\n" cho lần sau).
struct LineSplitter {
    private var pending = Data()

    mutating func append(_ data: Data) -> [String] {
        pending.append(data)
        var lines: [String] = []
        while let index = pending.firstIndex(of: 0x0A) {
            lines.append(String(decoding: pending[pending.startIndex..<index], as: UTF8.self))
            pending.removeSubrange(pending.startIndex...index)
        }
        return lines
    }

    mutating func finish() -> [String] {
        defer { pending = Data() }
        return pending.isEmpty ? [] : [String(decoding: pending, as: UTF8.self)]
    }
}

public enum TerminalText {
    private static let ansi = try! NSRegularExpression(pattern: "\u{1B}\\[[0-9;?]*[ -/]*[@-~]|\u{1B}\\][^\u{07}\u{1B}]*(\u{07}|\u{1B}\\\\)|\u{1B}[@-Z\\\\-_]")

    /// Bỏ mã màu / điều khiển ANSI; dòng có "\r" (thanh tiến độ ghi đè) chỉ giữ phần sau "\r" cuối cùng.
    public static func clean(_ line: String) -> String {
        var text = line
        if text.contains("\u{1B}") {
            text = ansi.stringByReplacingMatches(in: text, range: NSRange(text.startIndex..., in: text), withTemplate: "")
        }
        if let last = text.split(separator: "\r", omittingEmptySubsequences: true).last, text.contains("\r") {
            text = String(last)
        }
        return text
    }
}
