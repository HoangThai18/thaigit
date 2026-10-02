import AppKit
import NhanhCore
import SwiftUI

@Observable
final class CloneProgress {
    var line = ""
    var fraction: Double?
}

struct CloneSheet: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss
    var onCloned: (String) -> Void

    @State private var url = ""
    @State private var parentDirectory = UserDefaults.standard.string(forKey: Prefs.lastCloneDirectory)
        ?? (NSHomeDirectory() as NSString).appendingPathComponent("Documents")
    @State private var folderName = ""
    @State private var folderNameEdited = false
    @State private var isCloning = false
    @State private var progress = CloneProgress()
    @State private var errorMessage: String?
    @State private var task: Task<Void, Never>?

    private var destination: URL {
        URL(fileURLWithPath: (parentDirectory as NSString).expandingTildeInPath).appendingPathComponent(folderName)
    }

    private var canClone: Bool {
        !url.trimmingCharacters(in: .whitespaces).isEmpty && !folderName.isEmpty && !isCloning
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Label("Clone repository", systemImage: "arrow.down.circle.fill")
                .font(.title2.bold())

            VStack(alignment: .leading, spacing: 6) {
                Text("Địa chỉ repository").font(.subheadline.weight(.medium))
                TextField("", text: $url, prompt: Text("https://github.com/ten/du-an.git hoặc git@github.com:ten/du-an.git"))
                    .textFieldStyle(.roundedBorder)
                    .onChange(of: url) {
                        if !folderNameEdited { folderName = GitRepository.defaultDirectoryName(forCloneURL: url) }
                    }
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("Lưu vào thư mục").font(.subheadline.weight(.medium))
                HStack {
                    TextField("", text: $parentDirectory)
                        .textFieldStyle(.roundedBorder)
                    Button("Chọn…", action: chooseDirectory)
                }
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("Tên thư mục").font(.subheadline.weight(.medium))
                TextField("", text: Binding(get: { folderName }, set: { folderName = $0; folderNameEdited = true }))
                    .textFieldStyle(.roundedBorder)
                Text("Sẽ tạo: \((destination.path as NSString).abbreviatingWithTildeInPath)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if isCloning {
                VStack(alignment: .leading, spacing: 6) {
                    if let fraction = progress.fraction {
                        ProgressView(value: fraction)
                    } else {
                        ProgressView().progressViewStyle(.linear)
                    }
                    Text(progress.line.isEmpty ? "Đang kết nối…" : progress.line)
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }

            if let errorMessage {
                ScrollView {
                    Text(errorMessage)
                        .font(.caption.monospaced())
                        .foregroundStyle(.red)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxHeight: 90)
            }

            HStack {
                Text("Repo riêng tư: Thaigit dùng SSH key / Keychain của máy, sẽ hỏi mật khẩu/token nếu cần.")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                Spacer()
                Button("Huỷ") {
                    task?.cancel()
                    dismiss()
                }
                .keyboardShortcut(.cancelAction)
                Button("Clone", action: startClone)
                    .keyboardShortcut(.defaultAction)
                    .disabled(!canClone)
            }
        }
        .padding(24)
        .frame(width: 600)
        .onAppear(perform: prefillFromClipboard)
    }

    private func prefillFromClipboard() {
        guard url.isEmpty, let text = NSPasteboard.general.string(forType: .string)?.trimmingCharacters(in: .whitespacesAndNewlines) else { return }
        let looksLikeGit = text.hasPrefix("git@") || text.hasSuffix(".git")
            || ((text.hasPrefix("https://") || text.hasPrefix("ssh://")) && !text.contains(" ") && text.count < 300)
        if looksLikeGit { url = text }
    }

    private func chooseDirectory() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.prompt = "Chọn"
        if panel.runModal() == .OK, let chosen = panel.url {
            parentDirectory = chosen.path
        }
    }

    private func startClone() {
        let target = destination
        if FileManager.default.fileExists(atPath: target.path),
           let contents = try? FileManager.default.contentsOfDirectory(atPath: target.path), !contents.isEmpty {
            errorMessage = "Thư mục “\(target.lastPathComponent)” đã tồn tại và không trống. Hãy đổi tên thư mục."
            return
        }
        errorMessage = nil
        isCloning = true
        UserDefaults.standard.set(parentDirectory, forKey: Prefs.lastCloneDirectory)
        let remoteURL = url.trimmingCharacters(in: .whitespacesAndNewlines)
        let environment = appState.environment
        let progress = progress
        task = Task {
            do {
                try await GitRepository.clone(url: remoteURL, to: target, environment: environment) { line in
                    Task { @MainActor in
                        progress.line = line
                        if let fraction = GitParsers.progressFraction(line) { progress.fraction = fraction }
                    }
                }
                isCloning = false
                dismiss()
                onCloned(target.path)
            } catch {
                isCloning = false
                if !Task.isCancelled {
                    errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                }
            }
        }
    }
}
