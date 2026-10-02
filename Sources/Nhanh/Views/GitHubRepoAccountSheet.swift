import AppKit
import NhanhCore
import SwiftUI

/// "Tài khoản GitHub cho repo này": gán owner (của remote origin, hoặc owner bị GitHub từ chối) cho một tài khoản, và —
/// sau khi người dùng xác nhận ở đây — ghi tên / email commit của tài khoản vào config LOCAL của repo.
struct GitHubRepoAccountSheet: View {
    @Bindable var model: RepoModel
    /// Owner cần gán; nil: owner của remote origin.
    let owner: String?
    @Environment(\.dismiss) private var dismiss
    private let github = GitHubAccountManager.shared
    @State private var selectedLogin = ""
    @State private var writeIdentity = true

    private var targetOwner: String? { owner ?? model.originOwner }

    /// Owner là owner của origin: mới ghi danh tính commit vào repo này.
    private var isRepoOwner: Bool {
        guard let originOwner = model.originOwner else { return targetOwner == nil }
        return targetOwner?.caseInsensitiveCompare(originOwner) == .orderedSame
    }

    private var selected: GitHubAccountProfile? { github.state.profile(login: selectedLogin) }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Label(owner == nil ? "Tài khoản GitHub cho repo này" : "Tài khoản GitHub cho \(owner ?? "")", systemImage: "person.badge.key")
                .font(.title3.bold())

            if !github.isConfigured {
                Text(GitHubAccountManager.notConfiguredMessage)
                    .foregroundStyle(.secondary)
            } else if github.accounts.isEmpty {
                Text("Chưa đăng nhập tài khoản GitHub nào.")
                    .foregroundStyle(.secondary)
                Button("Đăng nhập GitHub…") { model.sheet = .githubLogin }
            } else {
                form
            }

            HStack {
                if github.isConfigured, !github.accounts.isEmpty {
                    Button("Thêm tài khoản…") { model.sheet = .githubLogin }
                }
                Spacer()
                Button("Huỷ") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                if !github.accounts.isEmpty {
                    Button(targetOwner == nil ? "Ghi danh tính" : "Gán tài khoản", action: confirm)
                        .keyboardShortcut(.defaultAction)
                        .disabled(selected == nil || (targetOwner == nil && !writeIdentity))
                }
            }
        }
        .padding(22)
        .frame(width: 500)
        .onAppear {
            selectedLogin = github.resolution(forOwner: targetOwner)?.profile.login ?? github.defaultAccount?.login ?? ""
            writeIdentity = isRepoOwner
        }
    }

    @ViewBuilder
    private var form: some View {
        if let targetOwner {
            Text("Fetch / pull / push / clone tới github.com/\(targetOwner)/… sẽ dùng tài khoản:")
                .font(.callout)
                .fixedSize(horizontal: false, vertical: true)
        } else {
            Text("Remote origin của repo này không ở github.com — chỉ ghi được tên & email commit của một tài khoản.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        Picker("Tài khoản", selection: $selectedLogin) {
            ForEach(github.accounts) { profile in
                Text("\(profile.account.displayName) (@\(profile.login))").tag(profile.login)
            }
        }
        if let current = github.resolution(forOwner: targetOwner), targetOwner != nil {
            Text("Hiện tại: @\(current.profile.login) — \(reason(current.match))")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        if isRepoOwner, let selected {
            Toggle("Ghi tên & email commit của tài khoản vào repo này (git config --local)", isOn: $writeIdentity)
            if writeIdentity {
                VStack(alignment: .leading, spacing: 2) {
                    Text("user.name  = \(selected.commitName)")
                    Text("user.email = \(selected.commitEmail)")
                }
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
                if let current = model.committerIdentity {
                    Text("Đang dùng: \(current.name ?? "—") <\(current.email ?? "chưa đặt")>")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
            }
        }
    }

    private func reason(_ match: GitHubAccountsState.Match) -> String {
        switch match {
        case .assigned: return "bạn đã gán"
        case .login: return "owner là chính tài khoản này"
        case .organization: return "tài khoản là thành viên tổ chức"
        case .fallback: return "tài khoản mặc định"
        }
    }

    private func confirm() {
        guard let selected else { return }
        // Owner chính là login của tài khoản đã chọn: quy tắc tự động đã khớp, không cần gán thêm.
        let current = github.resolution(forOwner: targetOwner)
        if let targetOwner, !(current?.match == .login && current?.profile.login == selected.login) {
            github.assign(owner: targetOwner, to: selected.login)
        }
        if isRepoOwner, writeIdentity {
            model.applyCommitIdentity(name: selected.commitName, email: selected.commitEmail)
        }
        dismiss()
    }
}
