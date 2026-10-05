import AppKit
import NhanhCore
import SwiftUI

/// The SSH tab in Settings: Thaigit's own SSH keys, stored in the Keychain (like 1Password).
struct SSHSettings: View {
    /// github.com, gitlab.com and the hosts of the self-hosted GitLab accounts.
    private var testHosts: [String] {
        var hosts = ["github.com", "gitlab.com"]
        for host in gitlab.accounts.map(\.host) where !hosts.contains(host) { hosts.append(host) }
        return hosts
    }

    @Bindable private var manager = SSHKeyManager.shared
    @Bindable private var github = GitHubAccountManager.shared
    @Bindable private var gitlab = GitLabAccountManager.shared
    @State private var newKeyName = ""
    @State private var creating = false
    @State private var removing: SSHKeyInfo?

    var body: some View {
        Form {
            Section {
                if manager.keys.isEmpty {
                    Text("Tạo một khoá SSH ngay trong Thaigit (hoặc nhập khoá có sẵn) để clone / fetch / push repo SSH (git@github.com:…, git@gitlab.com:…) mà không cần cấu hình ssh-agent hay ~/.ssh.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                ForEach(manager.keys) { key in
                    SSHKeyRow(
                        key: key,
                        githubLogins: github.accounts.map(\.login),
                        gitlabAccounts: gitlab.accounts,
                        onCopy: { manager.copyPublicKey(key) },
                        onGitHub: { manager.addToGitHub(key, login: $0) },
                        onOpenGitHub: {
                            manager.copyPublicKey(key)
                            NSWorkspace.shared.open(SSHKeyManager.githubKeysPage)
                        },
                        onGitLab: { manager.addToGitLab(key, account: $0) },
                        onOpenGitLab: {
                            manager.copyPublicKey(key)
                            NSWorkspace.shared.open(URL(string: "https://gitlab.com/-/user_settings/ssh_keys")!)
                        },
                        onRename: { manager.rename(key, to: $0) },
                        onRemove: { removing = key }
                    )
                }
                HStack {
                    Button("Nhập khoá có sẵn…") { manager.chooseKeyToImport() }
                    Spacer()
                    Button("Tạo khoá mới…") {
                        newKeyName = SSHKeyManager.defaultKeyName
                        creating = true
                    }
                    .keyboardShortcut(.defaultAction)
                }
                .disabled(manager.busy)
                if let notice = manager.notice {
                    Label(notice, systemImage: "checkmark.circle.fill")
                        .font(.callout)
                        .foregroundStyle(.green)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let problem = manager.problem {
                    Label(problem, systemImage: "exclamationmark.triangle.fill")
                        .font(.callout)
                        .foregroundStyle(.orange)
                        .fixedSize(horizontal: false, vertical: true)
                }
            } header: {
                Text("Khoá SSH của Thaigit")
            } footer: {
                Text("Khoá bí mật chỉ nằm trong Keychain của máy này (không đồng bộ iCloud, không ghi ra file). Khi lệnh git cần, Thaigit nạp khoá vào một ssh-agent tạm riêng cho lệnh đó rồi tắt ngay.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if !manager.keys.isEmpty {
                Section("Dùng khoá") {
                    VStack(alignment: .leading, spacing: 4) {
                        Toggle("Dùng khoá của Thaigit cho remote SSH", isOn: $manager.isEnabled)
                        Text("Tắt thì git dùng ssh-agent và khoá trong ~/.ssh như khi chạy ở Terminal.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    ForEach(testHosts, id: \.self) { host in
                        ConnectionRow(host: host, result: manager.connection[host], busy: manager.busy) {
                            manager.testConnection(host: host)
                        }
                    }
                }
            }
        }
        .formStyle(.grouped)
        .alert("Tạo khoá SSH mới", isPresented: $creating) {
            TextField("Tên khoá", text: $newKeyName)
            Button("Tạo khoá") { manager.generate(name: newKeyName) }
            Button("Huỷ", role: .cancel) {}
        } message: {
            Text("Khoá Ed25519 (loại GitHub và GitLab khuyên dùng). Đặt tên theo máy để dễ nhận ra trên GitHub / GitLab.")
        }
        .alert(
            "Xoá khoá “\(removing?.name ?? "")”?",
            isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
            presenting: removing
        ) { key in
            Button("Xoá khoá", role: .destructive) { manager.remove(key) }
            Button("Huỷ", role: .cancel) {}
        } message: { _ in
            Text("Khoá bí mật bị xoá vĩnh viễn khỏi Keychain và không khôi phục được. Repo SSH đang dùng khoá này sẽ không fetch / push được nữa.")
        }
    }
}

private struct SSHKeyRow: View {
    let key: SSHKeyInfo
    let githubLogins: [String]
    let gitlabAccounts: [GitLabAccount]
    var onCopy: () -> Void
    var onGitHub: (String) -> Void
    var onOpenGitHub: () -> Void
    var onGitLab: (GitLabAccount) -> Void
    var onOpenGitLab: () -> Void
    var onRename: (String) -> Void
    var onRemove: () -> Void

    @State private var renaming = false
    @State private var name = ""

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "key.horizontal.fill")
                .font(.title3)
                .foregroundStyle(.orange)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(key.name).font(.headline)
                    Text(verbatim: key.type)
                        .font(.caption2.weight(.semibold))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 1)
                        .background(.quaternary, in: Capsule())
                    if key.encrypted {
                        Image(systemName: "lock.fill")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .help("Khoá có passphrase — Thaigit hỏi passphrase mỗi lần dùng")
                    }
                }
                Text(verbatim: key.fingerprint)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .textSelection(.enabled)
                Text("Tạo \(key.createdAt.formatted(date: .abbreviated, time: .omitted))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button("Sao chép khoá công khai", action: onCopy)
                .controlSize(.small)
            Menu {
                if githubLogins.isEmpty {
                    Button("Thêm lên GitHub (mở trang, dán khoá)…", action: onOpenGitHub)
                } else {
                    ForEach(githubLogins, id: \.self) { login in
                        Button("Thêm lên GitHub @\(login)") { onGitHub(login) }
                    }
                    Button("Mở trang khoá SSH của GitHub…", action: onOpenGitHub)
                }
                ForEach(gitlabAccounts) { account in
                    Button("Thêm lên GitLab @\(account.user.username) (\(account.host))") { onGitLab(account) }
                }
                Button("Thêm lên GitLab (mở trang, dán khoá)…", action: onOpenGitLab)
                Divider()
                Button("Đổi tên…") {
                    name = key.name
                    renaming = true
                }
                Button("Xoá khoá…", role: .destructive, action: onRemove)
            } label: {
                Image(systemName: "ellipsis.circle")
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .fixedSize()
        }
        .padding(.vertical, 2)
        .alert("Đổi tên khoá", isPresented: $renaming) {
            TextField("Tên khoá", text: $name)
            Button("Lưu") { onRename(name) }
            Button("Huỷ", role: .cancel) {}
        }
    }
}

private struct ConnectionRow: View {
    let host: String
    let result: SSHKeyManager.ConnectionResult?
    let busy: Bool
    var onTest: () -> Void

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: host)
                switch result {
                case .success(let text)?:
                    Label(text, systemImage: "checkmark.circle.fill")
                        .font(.caption)
                        .foregroundStyle(.green)
                case .failure(let text)?:
                    Label(text, systemImage: "xmark.circle.fill")
                        .font(.caption)
                        .foregroundStyle(.orange)
                        .fixedSize(horizontal: false, vertical: true)
                case nil:
                    EmptyView()
                }
            }
            Spacer()
            Button("Kiểm tra kết nối", action: onTest)
                .controlSize(.small)
                .disabled(busy)
        }
    }
}
