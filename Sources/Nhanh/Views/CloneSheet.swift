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
    @State private var showGitHubLogin = false
    /// Clone thất bại vì GitHub từ chối xác thực: hiện nút đăng nhập cạnh lỗi.
    @State private var suggestGitHubLogin = false
    /// Repo vừa chọn trong danh sách của một tài khoản (để clone bằng đúng tài khoản đó).
    @State private var picked: PickedRepository?
    /// Vừa gán owner của repo đã chọn cho tài khoản liệt kê nó (báo cho người dùng biết).
    @State private var assignmentNote: String?
    private let github = GitHubAccountManager.shared

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

            if !github.accounts.isEmpty {
                GitHubRepositoryPicker(url: $url, picked: $picked) { showGitHubLogin = true }
            } else if github.isConfigured {
                HStack(spacing: 10) {
                    Image(systemName: "person.crop.circle.badge.plus")
                        .font(.title3)
                        .foregroundStyle(Brand.blue)
                    Text("Đăng nhập GitHub để chọn nhanh repo của bạn và clone repo riêng tư qua HTTPS.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer()
                    Button("Đăng nhập GitHub…") { showGitHubLogin = true }
                }
                .padding(12)
                .glassSurface(in: RoundedRectangle(cornerRadius: 14), tint: Brand.blue.opacity(0.08))
            }

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
                if suggestGitHubLogin {
                    Button(github.accounts.isEmpty ? "Đăng nhập GitHub…" : "Đăng nhập / thêm tài khoản GitHub…") {
                        showGitHubLogin = true
                    }
                }
            }

            HStack {
                Text(footnote)
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .fixedSize(horizontal: false, vertical: true)
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
        .sheet(isPresented: $showGitHubLogin) {
            GitHubLoginSheet()
        }
    }

    /// Repo HTTPS trên github.com: cho biết tài khoản nào sẽ được dùng — đúng cách lệnh git chọn (username trong địa chỉ,
    /// rồi bảng owner → tài khoản).
    private var footnote: String {
        let remote = url.trimmingCharacters(in: .whitespacesAndNewlines)
        if let assignmentNote, picked?.cloneURL == remote { return assignmentNote }
        if GitHubRemoteURL.isHTTPS(remote), let owner = GitHubRemoteURL.owner(of: remote) {
            if let user = GitHubRemoteURL.username(of: remote), let profile = github.state.profile(login: user) {
                return "Clone bằng tài khoản @\(profile.login) (username trong địa chỉ)."
            }
            let resolved = github.resolution(forOwner: owner)?.profile.login
            if let picked, picked.cloneURL == remote, picked.owner.caseInsensitiveCompare(owner) == .orderedSame,
               let resolved, picked.login != resolved {
                // Repo chọn trong danh sách của tài khoản khác tài khoản owner đang dùng: khi clone sẽ gán owner cho nó.
                return "Clone bằng tài khoản @\(picked.login): owner \(owner) sẽ được gán cho @\(picked.login) (hiện dùng @\(resolved))."
            }
            if let resolved {
                return "Clone bằng tài khoản @\(resolved) (owner \(owner))."
            }
        }
        return github.accounts.isEmpty
            ? "Repo riêng tư: Thaigit dùng SSH key / Keychain của máy, sẽ hỏi mật khẩu/token nếu cần."
            : "Repo HTTPS trên github.com dùng tài khoản GitHub theo owner; repo khác dùng SSH key / Keychain của máy."
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
        suggestGitHubLogin = false
        isCloning = true
        UserDefaults.standard.set(parentDirectory, forKey: Prefs.lastCloneDirectory)
        let remoteURL = url.trimmingCharacters(in: .whitespacesAndNewlines)
        // Repo chọn từ danh sách của một tài khoản: owner đang dùng tài khoản khác thì gán cho tài khoản đó, để clone
        // (và fetch / push sau này) dùng đúng token.
        if let picked, picked.cloneURL == remoteURL, github.noteCloneSelection(owner: picked.owner, login: picked.login) {
            assignmentNote = "Đã gán owner \(picked.owner) cho @\(picked.login) — đổi lại trong Cài đặt → Tài khoản."
        }
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
                    suggestGitHubLogin = github.isConfigured && (error as? GitError).flatMap(GitHubAuthFailure.detect) != nil
                }
            }
        }
    }
}

/// "Repo GitHub của bạn" trong hộp Clone: lọc theo tên, chọn một repo để điền địa chỉ clone (HTTPS).
/// Repo chọn trong danh sách của một tài khoản GitHub.
struct PickedRepository: Equatable {
    let cloneURL: String
    let owner: String
    let login: String
}

private struct GitHubRepositoryPicker: View {
    @Binding var url: String
    @Binding var picked: PickedRepository?
    var onLogin: () -> Void

    private let github = GitHubAccountManager.shared
    @State private var login = ""
    @State private var loadedLogin = ""
    @State private var repositories: [GitHubRepository] = []
    @State private var query = ""
    @State private var selection: GitHubRepository.ID?
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var tokenRejected = false
    /// Lần tải lại bằng tay đang chạy (nút ↻ / "Thử lại"): huỷ khi tải lại lần nữa hoặc đổi tài khoản.
    @State private var reloadTask: Task<Void, Never>?

    private var filtered: [GitHubRepository] {
        let text = query.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return repositories }
        return repositories.filter { $0.name.localizedStandardContains(text) || $0.fullName.localizedStandardContains(text) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Text("Repo GitHub của bạn").font(.subheadline.weight(.medium))
                Spacer()
                if let profile = github.state.profile(login: login) {
                    GitHubAvatar(account: profile.account, size: 18)
                }
                if github.accounts.count > 1 {
                    // Nhiều tài khoản (cá nhân, công ty…): chọn tài khoản để xem repo của nó.
                    Picker("Tài khoản", selection: $login) {
                        ForEach(github.accounts) { Text("@\($0.login)").tag($0.login) }
                    }
                    .labelsHidden()
                    .fixedSize()
                } else {
                    Text("@\(login)").font(.caption).foregroundStyle(.secondary)
                }
                Button(action: reload) {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(.borderless)
                .disabled(isLoading)
                .help("Tải lại danh sách repo")
            }
            TextField("", text: $query, prompt: Text("Lọc theo tên repo…"))
                .textFieldStyle(.roundedBorder)
            list
                .frame(height: 180)
        }
        .onAppear {
            if github.state.profile(login: login) == nil { login = github.defaultAccount?.login ?? "" }
        }
        .task(id: login) {
            reloadTask?.cancel()
            await load()
        }
        .onChange(of: selection) { _, id in
            guard let repository = repositories.first(where: { $0.id == id }) else { return }
            url = repository.cloneURL
            let owner = repository.fullName.split(separator: "/").first.map(String.init) ?? ""
            picked = PickedRepository(cloneURL: repository.cloneURL, owner: owner, login: login)
        }
    }

    @ViewBuilder
    private var list: some View {
        if isLoading && repositories.isEmpty {
            ProgressView("Đang tải danh sách repo…")
                .controlSize(.small)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let errorMessage {
            VStack(spacing: 8) {
                Text(errorMessage)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                if tokenRejected {
                    Button("Đăng nhập lại…", action: onLogin)
                } else {
                    Button("Thử lại", action: reload)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if filtered.isEmpty {
            Text(repositories.isEmpty ? "Tài khoản này chưa có repo nào." : "Không có repo nào khớp “\(query)”.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            List(filtered, selection: $selection) { repository in
                GitHubRepositoryRow(repository: repository)
                    .tag(repository.id)
            }
            .listStyle(.inset)
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
    }

    private func reload() {
        reloadTask?.cancel()
        reloadTask = Task { await load() }
    }

    private func load() async {
        guard !login.isEmpty else { return }
        let account = login
        if loadedLogin != account {
            // Đổi tài khoản: không để danh sách của tài khoản trước hiện trong lúc tải.
            repositories = []
            loadedLogin = account
        }
        isLoading = true
        selection = nil
        let result: Result<[GitHubRepository], any Error>
        do {
            result = .success(try await github.repositories(for: account))
        } catch {
            result = .failure(error)
        }
        // Đã đổi tài khoản hoặc tải lại trong lúc chờ: đây là kết quả cũ (có thể của tài khoản trước) — bỏ đi.
        guard login == account, !Task.isCancelled else { return }
        isLoading = false
        switch result {
        case .success(let list):
            repositories = list
            errorMessage = nil
            tokenRejected = false
        case .failure(let error):
            guard !(error is CancellationError) else { return }
            tokenRejected = error as? GitHubError == .unauthorized
            errorMessage = tokenRejected
                ? "Token GitHub của @\(account) không còn hợp lệ — đăng nhập lại."
                : "Không tải được danh sách repo: " + GitHubAccountManager.describe(error)
        }
    }
}

private struct GitHubRepositoryRow: View {
    let repository: GitHubRepository

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: repository.isPrivate ? "lock.fill" : "book.closed")
                .foregroundStyle(.secondary)
                .frame(width: 16)
                .help(repository.isPrivate ? "Repo riêng tư" : "Repo công khai")
            VStack(alignment: .leading, spacing: 1) {
                Text(repository.fullName)
                    .lineLimit(1)
                    .truncationMode(.middle)
                if let description = repository.description, !description.isEmpty {
                    Text(description)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            Spacer()
            if let updated = repository.updatedAt {
                Text(VietnameseDate.relative(updated))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
}
