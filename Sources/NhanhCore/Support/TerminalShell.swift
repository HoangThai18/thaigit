import Foundation

/// Runs each shell command for the app's simple terminal: every command is a separate non-interactive zsh
/// process (empty stdin), output is returned line by line when there is any, and the working directory
/// after a `cd` is remembered. This is not an emulated terminal: programs needing a keyboard (vim, less,
/// a password prompt) won't work — set PAGER=cat and GIT_TERMINAL_PROMPT=0 so commands don't wait for input.
public enum TerminalShell {
    public struct Result: Sendable, Equatable {
        public let exitCode: Int32
        /// The directory after running (changes when the command contains a `cd`).
        public let directory: URL
    }

    /// Marker that flags the directory line (character 0x1E never appears in normal output).
    static let marker = "\u{1E}THAIGIT_PWD:"

    static let script = """
    cd -- "$THAIGIT_CWD" || exit 1
    eval "$THAIGIT_COMMAND"
    __thaigit_status=$?
    printf '\\036THAIGIT_PWD:%s\\n' "$PWD"
    exit $__thaigit_status
    """

    /// Environment variables for the command: no colour, no pager, no password prompts on the terminal.
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

    /// Runs `command` in `directory`. `onLine(line, isError)` is called per output line (ANSI colour codes removed).
    /// Cancelling the Task stops the command (SIGTERM to the child processes, then to the shell).
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
                            // The directory marker can stick to the last line of output when it has no trailing newline ("abc\u{1E}THAIGIT_PWD:/x").
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
            // The shell runs the command in a child process: kill the child first (pkill -P), then the shell.
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

/// Splits bytes into UTF-8 lines (keeping a trailing part without "\n" for the next round).
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

    /// Strips ANSI colour / control codes; a line containing "\r" (a progress bar redrawing) keeps only the part after the last "\r".
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
