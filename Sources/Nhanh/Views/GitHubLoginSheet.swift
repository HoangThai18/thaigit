import AppKit
import NhanhCore
import SwiftUI

/// Hộp "Đăng nhập GitHub" (OAuth Device Flow): hiện mã để người dùng nhập trên github.com, chờ xác nhận rồi báo kết quả.
/// Thaigit không bao giờ thấy mật khẩu GitHub; token nhận về được cất trong Keychain.
struct GitHubLoginSheet: View {
    @Environment(\.dismiss) private var dismiss
    private let github = GitHubAccountManager.shared
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Label("Đăng nhập GitHub", systemImage: "person.crop.circle.badge.checkmark")
                .font(.title2.bold())

            if github.isConfigured {
                content
            } else {
                notice(icon: "exclamationmark.triangle.fill", tint: .orange, title: GitHubAccountManager.notConfiguredMessage,
                       detail: String(localized: "Người duy trì cần tạo GitHub OAuth App (bật Device Flow) rồi điền Client ID vào ThaigitGitHubClientID trong Info.plist."))
            }

            HStack {
                Spacer()
                buttons
            }
        }
        .padding(24)
        .frame(width: 480)
        // Hộp khác đang đăng nhập dở (Cài đặt, hộp Clone…) thì xem tiếp, không xin mã mới; chỉ huỷ khi hộp cuối cùng đóng.
        .onAppear { github.loginSheetAppeared() }
        .onDisappear { github.loginSheetDisappeared() }
    }

    @ViewBuilder
    private var content: some View {
        switch github.loginState {
        case .idle, .requestingCode:
            progress(String(localized: "Đang lấy mã xác nhận từ GitHub…"))
        case .waitingForUser(let code):
            waiting(code)
        case .finishing:
            progress(String(localized: "Đã xác nhận — đang lấy thông tin tài khoản…"))
        case .succeeded(let account):
            HStack(spacing: 12) {
                GitHubAvatar(account: account, size: 44)
                VStack(alignment: .leading, spacing: 2) {
                    Label("Đã đăng nhập", systemImage: "checkmark.seal.fill")
                        .foregroundStyle(.green)
                        .font(.callout.weight(.semibold))
                    Text("\(account.displayName) (@\(account.login))").font(.headline)
                }
            }
            Text(successDetail(account))
                .font(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        case .failed(let message):
            notice(icon: "xmark.octagon.fill", tint: .red, title: String(localized: "Chưa đăng nhập được"), detail: message)
        }
    }

    private func successDetail(_ account: GitHubAccount) -> String {
        let organizations = github.state.profile(login: account.login)?.organizations ?? []
        var text = String(localized: "Fetch / pull / push / clone tới github.com/\(account.login)/…")
        if !organizations.isEmpty { text += String(localized: " và repo của ") + organizations.joined(separator: ", ") }
        text += String(localized: " dùng tài khoản này.")
        if github.accounts.count > 1 {
            text += String(localized: " Owner khác dùng tài khoản mặc định (@\(github.defaultAccount?.login ?? account.login)) — đổi trong Cài đặt → Tài khoản.")
        }
        return text
    }

    private func waiting(_ code: GitHubDeviceCode) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Nhập mã này trên GitHub rồi bấm Authorize để cho phép Thaigit fetch, pull, push và clone repo của bạn.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            if !github.accounts.isEmpty {
                // Device Flow xác nhận bằng tài khoản đang đăng nhập trên trình duyệt.
                Label(String(localized: "Đã có ") + github.accounts.map { "@\($0.login)" }.joined(separator: ", ")
                      + String(localized: ". Muốn thêm tài khoản khác, hãy chuyển sang tài khoản đó trên github.com (trình duyệt) trước khi nhập mã."),
                      systemImage: "person.2")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack(spacing: 12) {
                Text(code.userCode)
                    .font(.system(size: 34, weight: .bold, design: .monospaced))
                    .tracking(2)
                    .textSelection(.enabled)
                Spacer(minLength: 0)
                Button {
                    copy(code.userCode)
                } label: {
                    Label(copied ? String(localized: "Đã sao chép") : String(localized: "Sao chép"), systemImage: copied ? "checkmark" : "doc.on.doc")
                }
                .glassButtonStyle()
                .help("Sao chép mã")
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
            .glassSurface(in: RoundedRectangle(cornerRadius: 16), tint: Brand.blue.opacity(0.12))

            Button {
                copy(code.userCode)
                NSWorkspace.shared.open(code.verificationURL)
            } label: {
                Label("Mở GitHub để xác nhận", systemImage: "safari")
                    .frame(maxWidth: .infinity)
            }
            .glassButtonStyle(prominent: true)
            .controlSize(.large)
            .keyboardShortcut(.defaultAction)

            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text("Đang chờ bạn xác nhận trên GitHub… Mã hết hạn sau \(max(1, code.expiresIn / 60)) phút.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private var buttons: some View {
        if !github.isConfigured {
            Button("Đóng") { dismiss() }
                .keyboardShortcut(.defaultAction)
        } else {
            switch github.loginState {
            case .succeeded:
                Button("Xong") { dismiss() }
                    .keyboardShortcut(.defaultAction)
            case .failed:
                Button("Đóng") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button("Thử lại") { github.startLogin() }
                    .keyboardShortcut(.defaultAction)
            case .idle, .requestingCode, .waitingForUser, .finishing:
                // Đóng hộp: lần đăng nhập bị huỷ khi không còn hộp nào khác đang xem nó.
                Button("Huỷ") { dismiss() }
                    .keyboardShortcut(.cancelAction)
            }
        }
    }

    private func progress(_ text: String) -> some View {
        HStack(spacing: 10) {
            ProgressView().controlSize(.small)
            Text(text).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, minHeight: 60, alignment: .leading)
    }

    private func notice(icon: String, tint: Color, title: String, detail: String?) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon)
                .font(.title2)
                .foregroundStyle(tint)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.callout.weight(.semibold))
                if let detail, !detail.isEmpty {
                    Text(detail)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    private func copy(_ code: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(code, forType: .string)
        copied = true
        Task {
            try? await Task.sleep(for: .seconds(2))
            copied = false
        }
    }
}

/// Ảnh đại diện GitHub (tải từ avatar_url); chưa tải xong hoặc lỗi thì hiện chữ cái đầu như trên graph.
struct GitHubAvatar: View {
    let account: GitHubAccount
    var size: CGFloat = 32

    var body: some View {
        AsyncImage(url: account.avatarURL) { phase in
            if let image = phase.image {
                image.resizable().scaledToFill()
            } else {
                AvatarView(name: account.displayName, size: size)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
    }
}
