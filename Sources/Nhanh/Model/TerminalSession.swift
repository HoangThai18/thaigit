import AppKit
import NhanhCore
import SwiftUI

/// Terminal đơn giản dưới graph (như terminal tích hợp của GitKraken, bản rút gọn): gõ một lệnh, chạy trong thư mục
/// repo, xem output. Mỗi lệnh là một tiến trình riêng không tương tác — chỉ chạy lệnh người dùng tự gõ.
@Observable
final class TerminalSession {
    enum Kind {
        case command
        case output
        case error
        case info
    }

    struct Line: Identifiable {
        let id: Int
        let text: String
        let kind: Kind
    }

    static let maxLines = 5000

    let root: URL
    private(set) var lines: [Line] = []
    private(set) var directory: URL
    private(set) var isRunning = false
    var input = ""
    var isVisible = false
    var height: CGFloat = 240
    /// Gọi sau mỗi lệnh (làm mới repo: lệnh có thể đã commit, checkout…).
    @ObservationIgnored var onFinish: (() -> Void)?
    @ObservationIgnored private var history: [String] = []
    @ObservationIgnored private var historyIndex: Int?
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var nextID = 0

    init(root: URL) {
        self.root = root
        directory = root
    }

    /// "repo/thư-mục-con" — thư mục hiện tại tính từ thư mục cha của repo.
    var promptPath: String {
        let base = root.deletingLastPathComponent().path
        let path = directory.path
        if path.hasPrefix(base + "/") { return String(path.dropFirst(base.count + 1)) }
        return (path as NSString).abbreviatingWithTildeInPath
    }

    func run() {
        let command = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !command.isEmpty, !isRunning else { return }
        input = ""
        historyIndex = nil
        if history.last != command { history.append(command) }
        if command == "clear" || command == "cls" {
            lines = []
            return
        }
        append(.command, "\(promptPath) ❯ \(command)")
        isRunning = true
        let buffer = TerminalOutputBuffer()
        let directory = directory
        let environment = TerminalShell.environment(base: ProcessInfo.processInfo.environment)
        task = Task { [weak self] in
            let flusher = Task { [weak self] in
                while !Task.isCancelled {
                    try? await Task.sleep(for: .milliseconds(60))
                    self?.appendOutput(buffer.take())
                }
            }
            var finalDirectory = directory
            do {
                let result = try await TerminalShell.run(command, in: directory, environment: environment) { line, isError in
                    buffer.add(line, isError: isError)
                }
                flusher.cancel()
                self?.appendOutput(buffer.take())
                finalDirectory = result.directory
                if Task.isCancelled {
                    self?.append(.info, "Đã dừng lệnh")
                } else if result.exitCode != 0 {
                    self?.append(.info, "↳ thoát với mã \(result.exitCode)")
                }
            } catch {
                flusher.cancel()
                self?.appendOutput(buffer.take())
                self?.append(.error, FriendlyError.message(for: error))
            }
            guard let self else { return }
            if FileManager.default.fileExists(atPath: finalDirectory.path) { self.directory = finalDirectory }
            isRunning = false
            task = nil
            onFinish?()
        }
    }

    func stop() {
        task?.cancel()
    }

    func clear() {
        lines = []
    }

    /// ↑ / ↓ trong ô lệnh: lệnh đã gõ trước đó.
    func recall(_ step: Int) {
        guard !history.isEmpty else { return }
        let current = historyIndex ?? history.count
        let next = min(max(current + step, 0), history.count)
        historyIndex = next
        input = next == history.count ? "" : history[next]
    }

    private func appendOutput(_ items: [(String, Bool)]) {
        guard !items.isEmpty else { return }
        for (text, isError) in items { appendLine(isError ? .error : .output, text) }
        trim()
    }

    private func append(_ kind: Kind, _ text: String) {
        appendLine(kind, text)
        trim()
    }

    private func appendLine(_ kind: Kind, _ text: String) {
        lines.append(Line(id: nextID, text: text, kind: kind))
        nextID += 1
    }

    private func trim() {
        if lines.count > Self.maxLines { lines.removeFirst(lines.count - Self.maxLines) }
    }
}

/// Output gom từ luồng đọc của tiến trình, giao cho luồng chính theo từng đợt (giữ đúng thứ tự, không vẽ lại từng dòng).
nonisolated final class TerminalOutputBuffer: @unchecked Sendable {
    private let lock = NSLock()
    private var items: [(String, Bool)] = []

    func add(_ line: String, isError: Bool) {
        lock.lock()
        items.append((line, isError))
        lock.unlock()
    }

    func take() -> [(String, Bool)] {
        lock.lock()
        defer { lock.unlock() }
        let taken = items
        items = []
        return taken
    }
}

extension RepoModel {
    /// Bật / tắt terminal trong app (tạo ở thư mục repo lần đầu).
    func toggleTerminal() {
        if terminal == nil {
            let session = TerminalSession(root: repository.root)
            session.onFinish = { [weak self] in self?.requestRefresh(.all) }
            terminal = session
        }
        withAnimation(.snappy(duration: 0.2)) { terminal?.isVisible.toggle() }
    }
}
