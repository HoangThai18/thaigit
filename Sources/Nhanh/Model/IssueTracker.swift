import AppKit
import NhanhCore
import SwiftUI

/// The app's Jira Cloud connection (shared by every repo): the site address and email in UserDefaults, the API token in
/// the Keychain (its own service `com.phanthai.thaigit.jira`). The token only ever goes to the configured site (see `JiraClient`).
@Observable
final class JiraConnection {
    static let shared = JiraConnection()

    private static let siteKey = "jira.site"
    private static let emailKey = "jira.email"
    nonisolated private static let tokens: any GitHubTokenStore = AutomationHarness.isActive
        ? InMemoryGitHubTokenStore() : KeychainTokenStore(service: "com.phanthai.thaigit.jira")

    private(set) var site: String = UserDefaults.standard.string(forKey: JiraConnection.siteKey) ?? ""
    private(set) var email: String = UserDefaults.standard.string(forKey: JiraConnection.emailKey) ?? ""
    private(set) var displayName: String?

    var isConfigured: Bool { !site.isEmpty && !email.isEmpty }

    private var account: String { "\(email)@\(site)" }

    /// Validate the email + token against Jira, then store them.
    func connect(site: String, email: String, token: String) async throws {
        let client = try JiraClient(site: site, email: email, token: token)
        let name = try await client.myself()
        let normalized = client.site.absoluteString
        let cleanEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)
        try Self.tokens.saveToken(token.trimmingCharacters(in: .whitespacesAndNewlines), account: "\(cleanEmail)@\(normalized)")
        self.site = normalized
        self.email = cleanEmail
        displayName = name
        UserDefaults.standard.set(normalized, forKey: Self.siteKey)
        UserDefaults.standard.set(cleanEmail, forKey: Self.emailKey)
    }

    func disconnect() {
        try? Self.tokens.deleteToken(account: account)
        site = ""
        email = ""
        displayName = nil
        UserDefaults.standard.removeObject(forKey: Self.siteKey)
        UserDefaults.standard.removeObject(forKey: Self.emailKey)
    }

    func client() async throws -> JiraClient {
        let account = account
        let site = site
        let email = email
        // The Keychain may ask for permission: read it off the main actor.
        guard let token = try await Task.detached(operation: { try Self.tokens.readToken(account: account) }).value else {
            throw JiraError.unauthorized
        }
        return try JiraClient(site: site, email: email, token: token)
    }
}

extension RepoModel {
    // MARK: - Issue → nhánh / commit

    func loadGitHubIssues() async throws -> [GitHubIssue] {
        guard let repo = githubRemote?.repo else { return [] }
        // Screenshot run: sample data, no GitHub call.
        if AutomationHarness.isActive {
            return [GitHubIssue(number: 42, title: String(localized: "Đăng nhập bị lỗi khi mật khẩu có dấu"), author: "ngoc-anh", labels: ["bug"]),
                    GitHubIssue(number: 38, title: String(localized: "Thêm mã giảm giá vào giỏ hàng"), author: "tuan-bui", labels: [String(localized: "tính năng")])]
        }
        let token = await Task.detached { GitHubAccountManager.shared.apiToken(forOwner: repo.owner) }.value
        do {
            return try await GitHubRepoAPI().openIssues(in: repo, token: token)
        } catch GitHubRepoAPIError.notFound where token == nil {
            throw IssueLoadError.needsGitHubLogin
        }
    }

    /// Create a branch from an issue (name suggested from the number / key and the title) at the current commit, then check it out.
    func createBranch(forIssue key: String, title: String) {
        let name = BranchNameSuggester.branchName(key: key, title: title)
        if localBranches.contains(where: { $0.name == name }), let ref = localBranches.first(where: { $0.name == name }) {
            checkout(ref)
            return
        }
        createBranch(name: name, startPoint: headOID ?? "HEAD", checkout: true)
    }

    /// Attach the issue to the commit message being composed: GitHub appends "(#12)" to the summary line, Jira prepends "WEB-12 ".
    func attachIssueToCommit(_ reference: String, isJira: Bool) {
        let summary = commitSummary.trimmingCharacters(in: .whitespaces)
        guard !summary.contains(reference) else { return }
        if isJira {
            commitSummary = summary.isEmpty ? "\(reference) " : "\(reference) \(summary)"
        } else {
            commitSummary = summary.isEmpty ? "(\(reference))" : "\(summary) (\(reference))"
        }
        selectWorkingTree()
        toast(.success, String(localized: "Đã gắn \(reference) vào commit message"), tag: "issue")
    }
}

enum IssueLoadError: LocalizedError, UserFacingError {
    case needsGitHubLogin

    var userMessage: String { errorDescription ?? FriendlyError.unexpected }

    var errorDescription: String? {
        switch self {
        case .needsGitHubLogin: return String(localized: "Repo riêng tư — đăng nhập GitHub để xem issue.")
        }
    }
}
