import AppKit
import NhanhCore
import SwiftUI

/// GitHub issues (for this repo) and Jira issues assigned to you: create a branch from an issue, attach the issue to a commit message, open it on the web.
struct IssuesSheet: View {
    enum Source: String, CaseIterable, Identifiable {
        case github = "GitHub"
        case jira = "Jira"
        var id: String { rawValue }
    }

    @Bindable var model: RepoModel
    @Environment(\.dismiss) private var dismiss
    @State private var source: Source = .github
    @State private var query = ""
    @State private var githubIssues: [GitHubIssue] = []
    @State private var jiraIssues: [JiraIssue] = []
    @State private var loading = false
    @State private var message: String?
    private let jira = JiraConnection.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label("Issues", systemImage: "checklist")
                    .font(.title3.bold())
                Spacer()
                Picker("", selection: $source) {
                    ForEach(Source.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .frame(width: 180)
            }
            if source == .jira && !jira.isConfigured {
                JiraConnectForm { Task { await reload() } }
            } else {
                HStack {
                    TextField("Tìm theo số, mã hoặc tiêu đề", text: $query)
                        .textFieldStyle(.roundedBorder)
                    Button { Task { await reload() } } label: { Image(systemName: "arrow.clockwise") }
                        .help("Tải lại")
                }
                list
            }
            HStack {
                if source == .jira, jira.isConfigured {
                    Text("Jira: \(jira.email) · \(URL(string: jira.site)?.host ?? jira.site)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Button("Ngắt kết nối") {
                        jira.disconnect()
                        jiraIssues = []
                    }
                    .buttonStyle(.link)
                    .font(.caption)
                }
                Spacer()
                Button("Đóng") { dismiss() }
                    .keyboardShortcut(.cancelAction)
            }
        }
        .padding(20)
        .frame(width: 640, height: 520)
        .task(id: source) { await reload() }
        .onAppear { if model.githubRemote == nil, jira.isConfigured { source = .jira } }
    }

    @ViewBuilder
    private var list: some View {
        if loading {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let message {
            ContentUnavailableView {
                Label(message, systemImage: "exclamationmark.bubble")
            } actions: {
                if message == IssueLoadError.needsGitHubLogin.errorDescription, GitHubAccountManager.shared.isConfigured {
                    Button("Đăng nhập GitHub…") { model.sheet = .githubLogin }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            List {
                switch source {
                case .github:
                    ForEach(filteredGitHub) { issue in
                        IssueRow(reference: "#\(issue.number)", title: issue.title,
                                 detail: (["@\(issue.author)"] + issue.labels).joined(separator: " · ")) {
                            model.createBranch(forIssue: "issue-\(issue.number)", title: issue.title)
                            dismiss()
                        } attach: {
                            model.attachIssueToCommit("#\(issue.number)", isJira: false)
                            dismiss()
                        } open: {
                            issue.webURL.map { NSWorkspace.shared.open($0) }
                        }
                    }
                case .jira:
                    ForEach(filteredJira) { issue in
                        IssueRow(reference: issue.key, title: issue.summary, detail: [issue.type, issue.status].filter { !$0.isEmpty }.joined(separator: " · ")) {
                            model.createBranch(forIssue: issue.key, title: issue.summary)
                            dismiss()
                        } attach: {
                            model.attachIssueToCommit(issue.key, isJira: true)
                            dismiss()
                        } open: {
                            Task { if let client = try? await jira.client() { NSWorkspace.shared.open(client.browseURL(issue.key)) } }
                        }
                    }
                }
            }
            .listStyle(.inset)
            .overlay {
                if (source == .github ? filteredGitHub.isEmpty : filteredJira.isEmpty) {
                    Text(query.isEmpty ? String(localized: "Không có issue nào đang mở") : String(localized: "Không có issue khớp")).foregroundStyle(.secondary)
                }
            }
        }
    }

    private var filteredGitHub: [GitHubIssue] {
        let text = PaletteSearch.fold(query.trimmingCharacters(in: .whitespaces))
        guard !text.isEmpty else { return githubIssues }
        return githubIssues.filter { PaletteSearch.fold("#\($0.number) \($0.title)").contains(text) }
    }

    private var filteredJira: [JiraIssue] {
        let text = PaletteSearch.fold(query.trimmingCharacters(in: .whitespaces))
        guard !text.isEmpty else { return jiraIssues }
        return jiraIssues.filter { PaletteSearch.fold("\($0.key) \($0.summary)").contains(text) }
    }

    private func reload() async {
        message = nil
        loading = true
        defer { loading = false }
        do {
            switch source {
            case .github:
                guard model.githubRemote != nil else {
                    message = String(localized: "Repo này không có remote trên GitHub")
                    return
                }
                githubIssues = try await model.loadGitHubIssues()
            case .jira:
                guard jira.isConfigured else { return }
                jiraIssues = try await jira.client().myOpenIssues()
            }
        } catch {
            message = FriendlyError.message(for: error)
        }
    }
}

private struct IssueRow: View {
    let reference: String
    let title: String
    let detail: String
    let createBranch: () -> Void
    let attach: () -> Void
    let open: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Text(reference)
                .font(.callout.monospaced().weight(.semibold))
                .foregroundStyle(Brand.blue)
                .frame(minWidth: 54, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).lineLimit(1)
                if !detail.isEmpty {
                    Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            Spacer(minLength: 6)
            Button(action: createBranch) { Image(systemName: "arrow.triangle.branch") }
                .help("Tạo nhánh từ issue này và checkout")
            Button(action: attach) { Image(systemName: "text.badge.plus") }
                .help("Gắn \(reference) vào commit message đang soạn")
            Button(action: open) { Image(systemName: "safari") }
                .help("Mở trên web")
        }
        .buttonStyle(.borderless)
        .padding(.vertical, 3)
    }
}

/// Connecting to Jira Cloud: site, email, API token. Validated with Jira before being stored.
private struct JiraConnectForm: View {
    let onConnected: () -> Void
    @State private var site = ""
    @State private var email = ""
    @State private var token = ""
    @State private var working = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Kết nối Jira Cloud để xem issue giao cho bạn, tạo nhánh và gắn mã issue vào commit.")
                .foregroundStyle(.secondary)
            Form {
                TextField("Địa chỉ", text: $site, prompt: Text("cong-ty.atlassian.net"))
                TextField("Email", text: $email, prompt: Text("ban@cong-ty.vn"))
                SecureField("API token", text: $token)
            }
            .formStyle(.grouped)
            .scrollDisabled(true)
            .fixedSize(horizontal: false, vertical: true)
            HStack {
                Link("Tạo API token…", destination: URL(string: "https://id.atlassian.com/manage-profile/security/api-tokens")!)
                    .font(.caption)
                Spacer()
                if working { ProgressView().controlSize(.small) }
                Button("Kết nối") {
                    working = true
                    error = nil
                    Task {
                        do {
                            try await JiraConnection.shared.connect(site: site, email: email, token: token)
                            token = ""
                            onConnected()
                        } catch {
                            self.error = FriendlyError.message(for: error)
                        }
                        working = false
                    }
                }
                .disabled(working || site.isEmpty || email.isEmpty || token.isEmpty)
            }
            if let error {
                Text(error).font(.caption).foregroundStyle(.red)
            }
            Text("Email và API token chỉ được gửi tới địa chỉ Jira bạn nhập ở trên; token cất trong Keychain của máy.")
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer(minLength: 0)
        }
    }
}
