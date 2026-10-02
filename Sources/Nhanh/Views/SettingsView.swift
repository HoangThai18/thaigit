import AppKit
import NhanhCore
import SwiftUI

/// Các thẻ trong Cài đặt (lưu thẻ đang chọn để menu "Tài khoản GitHub…" mở đúng thẻ).
enum SettingsTab: String {
    case general, git, account
}

struct SettingsView: View {
    @AppStorage(Prefs.settingsTab) private var tab = SettingsTab.general.rawValue

    var body: some View {
        TabView(selection: $tab) {
            GeneralSettings()
                .tabItem { Label("Chung", systemImage: "gearshape") }
                .tag(SettingsTab.general.rawValue)
            GitSettings()
                .tabItem { Label("Git", systemImage: "arrow.triangle.branch") }
                .tag(SettingsTab.git.rawValue)
            AccountSettings()
                .tabItem { Label("Tài khoản", systemImage: "person.crop.circle") }
                .tag(SettingsTab.account.rawValue)
        }
        .frame(width: 560)
        .padding(.vertical, 8)
    }
}

private struct GeneralSettings: View {
    @AppStorage(Prefs.commitLimit) private var commitLimit = 2000
    @AppStorage(Prefs.logOrder) private var logOrder = LogOrder.date.rawValue
    @AppStorage(Prefs.showRemoteBranches) private var showRemoteBranches = true
    @AppStorage(Prefs.showTags) private var showTags = true
    @AppStorage(Prefs.relativeDates) private var relativeDates = true
    @AppStorage(Prefs.diffContext) private var diffContext = 3
    @AppStorage(Prefs.diffSplit) private var diffSplit = false

    var body: some View {
        Form {
            Section("Graph") {
                Picker("Số commit tải lên graph", selection: $commitLimit) {
                    ForEach([500, 1000, 2000, 5000, 10000, 20000], id: \.self) { value in
                        Text(value.formatted()).tag(value)
                    }
                }
                Picker("Thứ tự commit", selection: $logOrder) {
                    Text("Theo thời gian").tag(LogOrder.date.rawValue)
                    Text("Theo nhánh (topo)").tag(LogOrder.topo.rawValue)
                }
                Toggle("Hiện nhánh remote trên graph", isOn: $showRemoteBranches)
                Toggle("Hiện tag trên graph", isOn: $showTags)
                Toggle("Hiện thời gian tương đối (“3 giờ trước”)", isOn: $relativeDates)
            }
            Section("Diff") {
                Stepper("Số dòng ngữ cảnh quanh thay đổi: \(diffContext)", value: $diffContext, in: 0...20)
                Toggle("Mặc định hiển thị tách đôi (trước | sau)", isOn: $diffSplit)
            }
            UpdateSettingsSection()
        }
        .formStyle(.grouped)
        .onChange(of: commitLimit) { notifyChange() }
        .onChange(of: logOrder) { notifyChange() }
        .onChange(of: showRemoteBranches) { notifyChange() }
        .onChange(of: showTags) { notifyChange() }
        .onChange(of: relativeDates) { notifyChange() }
        .onChange(of: diffContext) { notifyChange() }
    }

    private func notifyChange() {
        NotificationCenter.default.post(name: .nhanhSettingsChanged, object: nil)
    }
}

private struct GitSettings: View {
    @Environment(AppState.self) private var appState
    @AppStorage(Prefs.gitPath) private var gitPath = ""
    @AppStorage(Prefs.pullMode) private var pullMode = PullMode.merge.rawValue
    @AppStorage(Prefs.fetchPrune) private var fetchPrune = true
    @AppStorage(Prefs.autoFetchMinutes) private var autoFetchMinutes = 5

    var body: some View {
        Form {
            Section("Chương trình git") {
                HStack {
                    TextField("Đường dẫn git", text: $gitPath, prompt: Text("Tự động"))
                    Button("Chọn…") {
                        let panel = NSOpenPanel()
                        panel.canChooseFiles = true
                        panel.canChooseDirectories = false
                        panel.directoryURL = URL(fileURLWithPath: "/usr/local/bin")
                        if panel.runModal() == .OK, let url = panel.url { gitPath = url.path }
                    }
                    if !gitPath.isEmpty {
                        Button("Tự động") { gitPath = "" }
                    }
                }
                LabeledContent("Đang dùng") {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(appState.gitExecutablePath).font(.callout.monospaced())
                        Text(appState.gitVersion ?? "—").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            Section("Đồng bộ") {
                Picker("Khi bấm Pull", selection: $pullMode) {
                    Text("Merge nếu cần (mặc định)").tag(PullMode.merge.rawValue)
                    Text("Rebase").tag(PullMode.rebase.rawValue)
                    Text("Chỉ fast-forward").tag(PullMode.fastForwardOnly.rawValue)
                }
                Toggle("Xoá nhánh remote đã bị xoá khi fetch (prune)", isOn: $fetchPrune)
                Picker("Tự động fetch", selection: $autoFetchMinutes) {
                    Text("Tắt").tag(0)
                    Text("Mỗi 1 phút").tag(1)
                    Text("Mỗi 5 phút").tag(5)
                    Text("Mỗi 15 phút").tag(15)
                    Text("Mỗi 30 phút").tag(30)
                }
            }
            Section {
                Text("Xác thực: Thaigit dùng SSH key, ssh-agent và Keychain sẵn có trên máy (giống terminal). Đã đăng nhập GitHub (thẻ Tài khoản) thì repo HTTPS trên github.com dùng tài khoản đó. Nếu cần mật khẩu, token hoặc passphrase, một hộp thoại sẽ hiện ra.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
        .onChange(of: gitPath) { appState.rebuildEnvironment() }
    }
}

/// Thẻ "Tài khoản": các tài khoản GitHub (thêm, xoá, đặt mặc định, danh tính commit) và owner đã gán.
private struct AccountSettings: View {
    @Bindable private var github = GitHubAccountManager.shared
    @State private var removing: GitHubAccountProfile?
    @State private var newOwner = ""
    @State private var newOwnerLogin = ""

    var body: some View {
        Form {
            if !github.isConfigured {
                Section("GitHub") {
                    LabeledContent("Đăng nhập GitHub") {
                        Text(GitHubAccountManager.notConfiguredMessage)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.trailing)
                    }
                    Button("Đăng nhập GitHub…") {}
                        .disabled(true)
                }
            } else {
                accountsSection
                if !github.accounts.isEmpty { ownersSection }
            }
        }
        .formStyle(.grouped)
        .sheet(isPresented: $github.settingsLoginRequested) {
            GitHubLoginSheet()
        }
        .alert(
            "Xoá tài khoản @\(removing?.login ?? "")?",
            isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
            presenting: removing
        ) { profile in
            Button("Xoá tài khoản", role: .destructive) { github.removeAccount(login: profile.login) }
            Button("Huỷ", role: .cancel) {}
        } message: { _ in
            Text("Chỉ token của tài khoản này bị xoá khỏi Keychain, các tài khoản khác giữ nguyên. Token vẫn còn hiệu lực trên GitHub tới khi bạn thu hồi.")
        }
        // Làm mới danh sách tổ chức mỗi lần mở thẻ (để chọn đúng tài khoản cho repo của tổ chức).
        .task { github.refreshOrganizations() }
    }

    private var accountsSection: some View {
        Section {
            if github.accounts.isEmpty {
                Text("Đăng nhập để fetch / pull / push repo HTTPS trên github.com và chọn nhanh repo khi clone — không cần tự tạo token. Có thể thêm nhiều tài khoản (cá nhân, công ty…).")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            ForEach(github.accounts) { profile in
                GitHubAccountRow(
                    profile: profile,
                    isDefault: profile.login == github.defaultAccount?.login,
                    hasToken: github.loginsWithToken.contains(profile.login),
                    onSetDefault: { github.setDefault(login: profile.login) },
                    onSaveIdentity: { name, email in github.setCommitIdentity(login: profile.login, name: name, email: email) },
                    onRelogin: { github.settingsLoginRequested = true },
                    onRemove: { removing = profile }
                )
            }
            HStack {
                if !github.accounts.isEmpty {
                    Link("Quản lý quyền của Thaigit trên GitHub", destination: github.authorizationSettingsURL)
                        .font(.callout)
                }
                Spacer()
                Button(github.accounts.isEmpty ? "Đăng nhập GitHub…" : "Thêm tài khoản…") { github.settingsLoginRequested = true }
            }
            if let removed = github.removedLogin {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Đã xoá @\(removed) và token của nó khỏi máy. Token vẫn còn hiệu lực trên GitHub cho tới khi bạn thu hồi quyền của Thaigit.")
                        .font(.callout)
                        .fixedSize(horizontal: false, vertical: true)
                    Link("Thu hồi trên GitHub (github.com/settings/applications)", destination: GitHubAccountManager.revokeURL)
                        .font(.callout)
                }
            }
            if let problem = github.problem {
                Label(problem, systemImage: "exclamationmark.triangle.fill")
                    .font(.callout)
                    .foregroundStyle(.orange)
                    .fixedSize(horizontal: false, vertical: true)
            }
        } header: {
            Text("Tài khoản GitHub")
        } footer: {
            if github.accounts.count > 1 {
                Text("Lệnh git tới https://github.com/<owner>/… chọn tài khoản theo owner: owner bạn tự gán → owner là chính tài khoản → tổ chức mà tài khoản là thành viên → tài khoản mặc định.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var ownersSection: some View {
        Section {
            let assignments = github.state.ownerAssignments.sorted { $0.key < $1.key }
            if assignments.isEmpty {
                Text("Chưa gán owner nào. Dùng menu Repository → “Tài khoản GitHub cho repo này…”, hoặc gán ở đây.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
            ForEach(assignments, id: \.key) { owner, login in
                HStack {
                    Text(owner).font(.body.monospaced())
                    Spacer()
                    Picker("", selection: Binding(get: { login }, set: { github.assign(owner: owner, to: $0) })) {
                        ForEach(github.accounts) { Text("@\($0.login)").tag($0.login) }
                    }
                    .labelsHidden()
                    .fixedSize()
                    Button {
                        github.assign(owner: owner, to: nil)
                    } label: {
                        Image(systemName: "minus.circle")
                    }
                    .buttonStyle(.borderless)
                    .help("Bỏ gán — owner này dùng tài khoản theo quy tắc tự động")
                }
            }
            HStack {
                TextField("", text: $newOwner, prompt: Text("owner hoặc tổ chức, ví dụ cong-ty-abc"))
                    .textFieldStyle(.roundedBorder)
                Picker("", selection: $newOwnerLogin) {
                    ForEach(github.accounts) { Text("@\($0.login)").tag($0.login) }
                }
                .labelsHidden()
                .fixedSize()
                Button("Gán") {
                    github.assign(owner: newOwner, to: newOwnerLogin)
                    newOwner = ""
                }
                .disabled(GitHubAccountsState.normalizedOwner(newOwner) == nil || github.state.profile(login: newOwnerLogin) == nil)
            }
        } header: {
            Text("Owner đã gán")
        }
        .onAppear {
            if github.state.profile(login: newOwnerLogin) == nil { newOwnerLogin = github.defaultAccount?.login ?? "" }
        }
    }
}

/// Một tài khoản trong Cài đặt: ảnh, tên, tổ chức, mặc định / cần đăng nhập lại, sửa tên & email commit.
private struct GitHubAccountRow: View {
    let profile: GitHubAccountProfile
    let isDefault: Bool
    let hasToken: Bool
    var onSetDefault: () -> Void
    var onSaveIdentity: (String, String) -> Void
    var onRelogin: () -> Void
    var onRemove: () -> Void

    @State private var editing = false
    @State private var name = ""
    @State private var email = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                GitHubAvatar(account: profile.account, size: 36)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(profile.account.displayName).font(.headline)
                        if isDefault {
                            Text("Mặc định")
                                .font(.caption2.weight(.semibold))
                                .padding(.horizontal, 6)
                                .padding(.vertical, 1)
                                .background(Brand.blue.opacity(0.18), in: Capsule())
                        }
                    }
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                    Text("Commit: \(profile.commitName) <\(profile.commitEmail)>")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    if !hasToken {
                        Label("Cần đăng nhập lại (không có token trong Keychain)", systemImage: "exclamationmark.triangle.fill")
                            .font(.caption)
                            .foregroundStyle(.orange)
                    }
                }
                Spacer()
                Menu {
                    Button("Đặt làm mặc định", action: onSetDefault)
                        .disabled(isDefault)
                    Button("Sửa tên & email commit…") {
                        name = profile.commitName
                        email = profile.commitEmail
                        editing = true
                    }
                    Button("Đăng nhập lại…", action: onRelogin)
                    Divider()
                    Button("Xoá tài khoản…", role: .destructive, action: onRemove)
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                .menuStyle(.borderlessButton)
                .fixedSize()
            }
            if editing {
                TextField("Tên commit", text: $name)
                    .textFieldStyle(.roundedBorder)
                TextField("Email commit", text: $email)
                    .textFieldStyle(.roundedBorder)
                HStack {
                    Text("Ghi vào config local của repo khi gán tài khoản cho repo. Để trống: dùng tên GitHub và email noreply.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer()
                    Button("Huỷ") { editing = false }
                    Button("Lưu") {
                        onSaveIdentity(name, email)
                        editing = false
                    }
                }
            }
        }
        .padding(.vertical, 2)
    }

    private var subtitle: String {
        var text = "@\(profile.login)"
        if !profile.organizations.isEmpty { text += " · tổ chức: " + profile.organizations.joined(separator: ", ") }
        return text
    }
}
