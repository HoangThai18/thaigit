import AppKit
import NhanhCore
import SwiftUI

/// A shared frame: title, content, Cancel / confirm button.
private struct AdvancedSheetFrame<Content: View>: View {
    let title: String
    let systemImage: String
    let confirmTitle: String
    let canConfirm: Bool
    var width: CGFloat = 480
    let onConfirm: () -> Void
    @ViewBuilder let content: Content
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Label(title, systemImage: systemImage)
                .font(.title3.bold())
            content
            HStack {
                Spacer()
                Button("Huỷ") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button(confirmTitle) {
                    onConfirm()
                    dismiss()
                }
                .keyboardShortcut(.defaultAction)
                .disabled(!canConfirm)
            }
        }
        .padding(22)
        .frame(width: width)
    }
}

// MARK: - Ký commit

struct CommitSigningSheet: View {
    @Bindable var model: RepoModel
    @State private var config = CommitSigningConfig(signCommits: false, signTags: false, format: .ssh, key: nil)
    @State private var global = false
    @State private var sshKeys: [URL] = []
    @State private var gpgKeys: [GPGSecretKey] = []
    @State private var loaded = false

    private var keyMissing: Bool {
        (config.signCommits || config.signTags) && (config.key?.trimmingCharacters(in: .whitespaces).isEmpty ?? true)
    }

    var body: some View {
        AdvancedSheetFrame(title: String(localized: "Ký commit"), systemImage: "signature", confirmTitle: String(localized: "Lưu"), canConfirm: loaded && !keyMissing,
                           width: 520) {
            model.saveSigning(config, global: global)
        } content: {
            Form {
                Toggle("Ký mọi commit", isOn: $config.signCommits)
                Toggle("Ký annotated tag", isOn: $config.signTags)
                Picker("Kiểu khoá", selection: $config.format) {
                    Text("SSH").tag(SignatureFormat.ssh)
                    Text("GPG").tag(SignatureFormat.openpgp)
                }
                .pickerStyle(.segmented)
                keyPicker
                Picker("Áp dụng cho", selection: $global) {
                    Text("Chỉ repo này").tag(false)
                    Text("Mọi repo trên máy").tag(true)
                }
            }
            .formStyle(.grouped)
            .scrollDisabled(true)
            .fixedSize(horizontal: false, vertical: true)
            .disabled(!loaded)
            Text(config.format == .ssh
                 ? "GitHub hiện “Verified” khi khoá công khai này được thêm vào Settings → SSH and GPG keys với loại Signing key."
                 : "Cần cài GnuPG (brew install gnupg) và thêm khoá công khai GPG vào GitHub để hiện “Verified”.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .task {
            let repo = model.repository
            config = await repo.signingConfig()
            if config.key == nil { config.format = .ssh }
            sshKeys = GitRepository.sshPublicKeys()
            gpgKeys = await repo.gpgSecretKeys()
            loaded = true
        }
    }

    @ViewBuilder
    private var keyPicker: some View {
        let binding = Binding<String>(get: { config.key ?? "" }, set: { config.key = $0.isEmpty ? nil : $0 })
        if config.format == .ssh {
            Picker("Khoá", selection: binding) {
                Text("Chọn khoá…").tag("")
                ForEach(sshKeys, id: \.path) { url in
                    Text((url.path as NSString).abbreviatingWithTildeInPath).tag(url.path)
                }
                if let key = config.key, !key.isEmpty, !sshKeys.contains(where: { $0.path == key }) {
                    Text(key).tag(key)
                }
            }
            if sshKeys.isEmpty {
                Text("Không thấy khoá trong ~/.ssh — tạo bằng: ssh-keygen -t ed25519").font(.caption).foregroundStyle(.secondary)
            }
        } else {
            Picker("Khoá", selection: binding) {
                Text("Chọn khoá…").tag("")
                ForEach(gpgKeys) { key in
                    Text("\(key.userID) · \(String(key.id.suffix(8)))").tag(key.id)
                }
                if let key = config.key, !key.isEmpty, !gpgKeys.contains(where: { $0.id == key }) {
                    Text(key).tag(key)
                }
            }
            if gpgKeys.isEmpty {
                Text("Không thấy khoá GPG nào (hoặc chưa cài gpg).").font(.caption).foregroundStyle(.secondary)
            }
        }
    }
}

// MARK: - Worktree

struct AddWorktreeSheet: View {
    @Bindable var model: RepoModel
    @State private var createBranch = true
    @State private var newName = ""
    @State private var existing = ""
    @State private var parentFolder: URL?

    private var usedBranches: Set<String> { Set(model.extras.worktrees.compactMap(\.branch)) }
    private var availableBranches: [GitRef] { model.localBranches.filter { !usedBranches.contains($0.name) } }
    private var branch: String { createBranch ? RefNameRules.sanitize(newName) : existing }
    private var problem: String? {
        guard createBranch else { return nil }
        if model.localBranches.contains(where: { $0.name == branch }) { return String(localized: "Đã có nhánh tên này") }
        return RefNameRules.problem(branch)
    }
    private var folder: URL {
        let parent = parentFolder ?? model.repository.root.deletingLastPathComponent()
        let suffix = branch.isEmpty ? "worktree" : branch.replacingOccurrences(of: "/", with: "-")
        return parent.appendingPathComponent("\(model.name)-\(suffix)")
    }
    private var folderExists: Bool { FileManager.default.fileExists(atPath: folder.path) }

    var body: some View {
        AdvancedSheetFrame(title: String(localized: "Thêm worktree"), systemImage: "square.on.square", confirmTitle: String(localized: "Tạo worktree"),
                           canConfirm: !branch.isEmpty && problem == nil && !folderExists) {
            model.addWorktree(path: folder.path, branch: branch, createBranch: createBranch,
                              startPoint: createBranch ? model.currentBranch : nil)
        } content: {
            Text("Worktree là một thư mục làm việc thứ hai của cùng repo — làm song song trên nhánh khác mà không phải stash hay checkout qua lại.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Picker("", selection: $createBranch) {
                Text("Nhánh mới").tag(true)
                Text("Nhánh có sẵn").tag(false)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            if createBranch {
                TextField("Tên nhánh mới (từ \(model.currentBranch ?? "HEAD"))", text: $newName)
                    .textFieldStyle(.roundedBorder)
                if let problem, !newName.isEmpty {
                    Text(problem).font(.caption).foregroundStyle(.red)
                }
            } else {
                Picker("Nhánh", selection: $existing) {
                    Text("Chọn nhánh…").tag("")
                    ForEach(availableBranches) { ref in Text(ref.name).tag(ref.name) }
                }
            }
            HStack {
                Text((folder.path as NSString).abbreviatingWithTildeInPath)
                    .font(.caption.monospaced())
                    .foregroundStyle(folderExists ? .red : .secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer()
                Button("Đổi thư mục…") { chooseParent() }
            }
            if folderExists {
                Text("Thư mục này đã có — chọn chỗ khác.").font(.caption).foregroundStyle(.red)
            }
        }
    }

    private func chooseParent() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.prompt = String(localized: "Chọn")
        panel.message = String(localized: "Chọn thư mục sẽ chứa worktree")
        if panel.runModal() == .OK { parentFolder = panel.url }
    }
}

// MARK: - Git Flow

struct GitFlowInitSheet: View {
    @Bindable var model: RepoModel
    @State private var config = GitFlowConfig()

    var body: some View {
        AdvancedSheetFrame(title: String(localized: "Khởi tạo Git Flow"), systemImage: "flag", confirmTitle: String(localized: "Khởi tạo"),
                           canConfirm: !config.main.isEmpty && !config.develop.isEmpty && config.main != config.develop) {
            model.initGitFlow(config)
        } content: {
            Form {
                TextField("Nhánh phát hành", text: $config.main)
                TextField("Nhánh phát triển", text: $config.develop)
                TextField("Tiền tố feature", text: $config.featurePrefix)
                TextField("Tiền tố release", text: $config.releasePrefix)
                TextField("Tiền tố hotfix", text: $config.hotfixPrefix)
                TextField("Tiền tố tag phiên bản", text: $config.versionTagPrefix, prompt: Text(String(localized: "ví dụ v")))
            }
            .formStyle(.grouped)
            .scrollDisabled(true)
            .fixedSize(horizontal: false, vertical: true)
            Text("Ghi cấu hình gitflow.* vào repo (dùng chung được với các công cụ git-flow khác). Chưa có nhánh \(config.develop) thì tạo từ \(config.main).")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .onAppear {
            if !model.localBranches.contains(where: { $0.name == "main" }), model.localBranches.contains(where: { $0.name == "master" }) {
                config.main = "master"
            }
        }
    }
}

struct GitFlowStartSheet: View {
    @Bindable var model: RepoModel
    let kind: GitFlowKind
    @State private var name = ""

    private var config: GitFlowConfig { model.extras.gitFlow ?? GitFlowConfig() }
    private var cleaned: String { RefNameRules.sanitize(name) }
    private var problem: String? {
        if model.localBranches.contains(where: { $0.name == config.prefix(kind) + cleaned }) { return String(localized: "Đã có nhánh này") }
        return RefNameRules.problem(config.prefix(kind) + cleaned)
    }

    var body: some View {
        AdvancedSheetFrame(title: String(localized: "Bắt đầu \(kind.title.lowercased())"), systemImage: "flag", confirmTitle: String(localized: "Bắt đầu"),
                           canConfirm: !cleaned.isEmpty && problem == nil) {
            model.startFlow(kind, name: cleaned)
        } content: {
            TextField(kind == .feature ? String(localized: "Tên, ví dụ dang-nhap") : String(localized: "Phiên bản, ví dụ 1.2.0"), text: $name)
                .textFieldStyle(.roundedBorder)
            if let problem, !name.isEmpty {
                Text(problem).font(.caption).foregroundStyle(.red)
            } else {
                Text("Tạo nhánh \(config.prefix(kind))\(cleaned.isEmpty ? "…" : cleaned) từ \(config.base(kind)) rồi checkout.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

// MARK: - Git LFS

struct LFSTrackSheet: View {
    @Bindable var model: RepoModel
    @State private var pattern = ""
    @State private var tracked: [String] = []

    private static let suggestions = ["*.psd", "*.ai", "*.sketch", "*.zip", "*.mp4", "*.mov", "*.wav", "*.pdf"]

    var body: some View {
        AdvancedSheetFrame(title: String(localized: "Git LFS — theo dõi kiểu file"), systemImage: "externaldrive",
                           confirmTitle: String(localized: "Theo dõi"), canConfirm: !pattern.trimmingCharacters(in: .whitespaces).isEmpty) {
            model.lfsTrack(pattern.trimmingCharacters(in: .whitespaces), track: true)
        } content: {
            Text("File khớp mẫu sẽ được lưu bằng Git LFS (file lớn nằm trên máy chủ LFS, repo chỉ giữ con trỏ nhỏ). Ghi vào .gitattributes.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            TextField("Mẫu file, ví dụ *.psd hoặc assets/video/**", text: $pattern)
                .textFieldStyle(.roundedBorder)
            HStack {
                ForEach(Self.suggestions, id: \.self) { item in
                    Button(item) { pattern = item }
                        .buttonStyle(.borderless)
                        .font(.caption.monospaced())
                }
            }
            if !tracked.isEmpty {
                Text("Đang theo dõi").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                ForEach(tracked, id: \.self) { item in
                    HStack {
                        Text(item).font(.callout.monospaced())
                        Spacer()
                        Button("Bỏ theo dõi") {
                            model.lfsTrack(item, track: false)
                            tracked.removeAll { $0 == item }
                        }
                        .buttonStyle(.borderless)
                    }
                }
            }
        }
        .onAppear { tracked = model.repository.lfsTrackedPatterns() }
    }
}
