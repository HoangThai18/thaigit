import AppKit
import NhanhCore
import SwiftUI

/// Mục "Tài khoản GitLab" trong thẻ Tài khoản: gitlab.com (đăng nhập bằng mã hoặc token) và GitLab tự host (token).
struct GitLabAccountsSection: View {
    @Bindable private var gitlab = GitLabAccountManager.shared
    @State private var removing: GitLabAccount?

    var body: some View {
        Section {
            if gitlab.accounts.isEmpty {
                Text("Kết nối GitLab để fetch / pull / push repo HTTPS trên gitlab.com hoặc máy chủ GitLab của công ty, và thêm khoá SSH lên GitLab một bước.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            ForEach(gitlab.accounts) { account in
                HStack(spacing: 12) {
                    Image(systemName: "person.crop.circle.fill")
                        .font(.title)
                        .foregroundStyle(.orange)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(account.displayName).font(.headline)
                        Text(verbatim: "@\(account.user.username) · \(account.host)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("Xoá…") { removing = account }
                        .controlSize(.small)
                }
            }
            HStack {
                Button("Dùng token…") { gitlab.tokenSheetPresented = true }
                    .help("Dán personal access token — dùng cho gitlab.com hoặc GitLab tự host")
                Spacer()
                if gitlab.supportsDeviceLogin {
                    Button("Đăng nhập GitLab.com…") {
                        gitlab.loginSheetPresented = true
                        gitlab.startDeviceLogin()
                    }
                }
            }
            if let problem = gitlab.problem {
                Label(problem, systemImage: "exclamationmark.triangle.fill")
                    .font(.callout)
                    .foregroundStyle(.orange)
            }
        } header: {
            Text("Tài khoản GitLab")
        }
        .sheet(isPresented: $gitlab.loginSheetPresented, onDismiss: { gitlab.cancelLogin() }) {
            GitLabLoginSheet()
        }
        .sheet(isPresented: $gitlab.tokenSheetPresented) {
            GitLabTokenSheet()
        }
        .alert(
            "Xoá tài khoản GitLab @\(removing?.user.username ?? "")?",
            isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
            presenting: removing
        ) { account in
            Button("Xoá tài khoản", role: .destructive) { gitlab.remove(account) }
            Button("Huỷ", role: .cancel) {}
        } message: { account in
            Text("Token bị xoá khỏi Keychain. Token vẫn còn hiệu lực trên \(account.host) cho tới khi bạn thu hồi trong trang cài đặt GitLab.")
        }
    }
}

/// Hộp đăng nhập gitlab.com bằng mã: hiện mã, mở trang xác nhận, chờ người dùng bấm Authorize.
private struct GitLabLoginSheet: View {
    @Bindable private var gitlab = GitLabAccountManager.shared
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 16) {
            Text("Đăng nhập GitLab.com").font(.title2.weight(.semibold))
            switch gitlab.loginState {
            case .idle, .requestingCode:
                ProgressView("Đang lấy mã đăng nhập…")
            case .waitingForUser(let code):
                Text("Nhập mã này ở trang GitLab vừa mở, rồi bấm Authorize:")
                    .multilineTextAlignment(.center)
                Text(verbatim: code.userCode)
                    .font(.system(size: 30, weight: .bold, design: .monospaced))
                    .textSelection(.enabled)
                HStack {
                    Button("Sao chép mã") {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(code.userCode, forType: .string)
                    }
                    Button("Mở lại trang GitLab") { NSWorkspace.shared.open(code.verificationURL) }
                }
                ProgressView().controlSize(.small)
            case .finishing:
                ProgressView("Đang hoàn tất…")
            case .failed(let message):
                Label(message, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
                    .fixedSize(horizontal: false, vertical: true)
                Button("Thử lại") { gitlab.startDeviceLogin() }
            }
            HStack {
                Spacer()
                Button("Huỷ") { dismiss() }
                    .keyboardShortcut(.cancelAction)
            }
        }
        .padding(24)
        .frame(width: 420)
    }
}

/// Hộp thêm tài khoản GitLab bằng personal access token (gitlab.com hoặc máy chủ tự host).
private struct GitLabTokenSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var host = GitLabAccountManager.defaultHost
    @State private var token = ""
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Thêm tài khoản GitLab bằng token").font(.title3.weight(.semibold))
            Text("Tạo personal access token với quyền api, read_user, read_repository, write_repository rồi dán vào đây. Token chỉ lưu trong Keychain của máy này.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Form {
                TextField("Máy chủ", text: $host, prompt: Text(verbatim: "gitlab.com"))
                SecureField("Token", text: $token, prompt: Text(verbatim: "glpat-…"))
            }
            .formStyle(.columns)
            if let page = GitLabAPI.normalizedHost(host).flatMap(GitLabAccountManager.tokenPage) {
                Link("Tạo token trên \(GitLabAPI.normalizedHost(host) ?? host)…", destination: page)
                    .font(.callout)
            }
            if let error {
                Label(error, systemImage: "exclamationmark.triangle.fill")
                    .font(.callout)
                    .foregroundStyle(.orange)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack {
                Spacer()
                Button("Huỷ") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button("Thêm tài khoản") {
                    busy = true
                    error = nil
                    Task {
                        let message = await GitLabAccountManager.shared.addToken(host: host, token: token)
                        busy = false
                        if let message { error = message } else { dismiss() }
                    }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(busy || token.isEmpty || host.isEmpty)
            }
        }
        .padding(24)
        .frame(width: 460)
    }
}
