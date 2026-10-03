import Foundation
import Testing
@testable import NhanhCore

@Suite("Issues (GitHub, Jira) và AI viết commit message")
struct IssueIntegrationTests {
    @Test func listsGitHubIssuesWithoutPullRequests() async throws {
        let server = FakeGitHub([.json(200, #"""
        [{"number":7,"title":"Lỗi đăng nhập","html_url":"https://github.com/an/web/issues/7","user":{"login":"an"},"labels":[{"name":"bug"}]},
         {"number":8,"title":"PR thôi","user":{"login":"binh"},"pull_request":{"url":"https://api.github.com/x","merged_at":null}},
         {"number":9,"title":"Thêm giỏ hàng","html_url":"https://evil.example.com/9","user":null,"labels":[]}]
        """#)])
        let issues = try await GitHubRepoAPI(transport: server.transport).openIssues(in: GitHubRepoRef(owner: "an", name: "web"), token: "gho_x")
        #expect(issues.map(\.number) == [7, 9])
        #expect(issues[0].labels == ["bug"])
        #expect(issues[0].webURL?.absoluteString == "https://github.com/an/web/issues/7")
        #expect(issues[1].webURL == nil)
        #expect(server.requests.first?.url?.path == "/repos/an/web/issues")
    }

    @Test func suggestsBranchNames() {
        #expect(BranchNameSuggester.slug("Sửa lỗi Đăng nhập khi mất mạng!") == "sua-loi-dang-nhap-khi-mat-mang")
        #expect(BranchNameSuggester.branchName(key: "WEB-12", title: "Giỏ hàng: tính tổng tiền") == "WEB-12-gio-hang-tinh-tong-tien")
        #expect(BranchNameSuggester.branchName(key: "issue-3", title: "!!!") == "issue-3")
        let long = BranchNameSuggester.slug("một tiêu đề rất rất dài để thử cắt bớt tên nhánh cho gọn gàng")
        #expect(long.count <= 40 && !long.hasSuffix("-"))
    }

    @Test func jiraSendsTokenOnlyToConfiguredHTTPSSite() async throws {
        #expect(JiraClient.normalizedSite("cong-ty.atlassian.net")?.absoluteString == "https://cong-ty.atlassian.net")
        #expect(JiraClient.normalizedSite("https://cong-ty.atlassian.net/jira/software/projects")?.absoluteString == "https://cong-ty.atlassian.net")
        #expect(JiraClient.normalizedSite("http://cong-ty.atlassian.net") == nil)
        #expect(JiraClient.normalizedSite("https://user@evil.com") == nil)
        #expect(throws: JiraError.invalidSite) { _ = try JiraClient(site: "ftp://x.y", email: "a@b.c", token: "t") }

        let server = FakeGitHub([
            .json(200, #"{"displayName":"Phan Thái"}"#),
            .json(200, #"{"issues":[{"key":"WEB-12","fields":{"summary":"Giỏ hàng","status":{"name":"In Progress"},"issuetype":{"name":"Task"}}}]}"#),
            .json(401, #"{}"#),
        ])
        let client = try JiraClient(site: "cong-ty.atlassian.net", email: " an@cty.vn ", token: "tok123", transport: server.transport)
        #expect(try await client.myself() == "Phan Thái")
        let issues = try await client.myOpenIssues()
        #expect(issues == [JiraIssue(key: "WEB-12", summary: "Giỏ hàng", status: "In Progress", type: "Task")])
        await #expect(throws: JiraError.unauthorized) { _ = try await client.myself() }
        #expect(server.requests.allSatisfy { $0.url?.host == "cong-ty.atlassian.net" && $0.url?.scheme == "https" })
        #expect(server.requests[0].value(forHTTPHeaderField: "Authorization") == "Basic " + Data("an@cty.vn:tok123".utf8).base64EncodedString())
        let query = URLComponents(url: try #require(server.requests[1].url), resolvingAgainstBaseURL: false)?.queryItems ?? []
        #expect(query.first { $0.name == "jql" }?.value?.contains("assignee = currentUser()") == true)
        #expect(client.browseURL("WEB-12").absoluteString == "https://cong-ty.atlassian.net/browse/WEB-12")
    }

    @Test func buildsAndParsesCommitPrompt() async throws {
        let prompt = CommitPrompt.build(stat: " a.txt | 2 +-\n", patch: String(repeating: "+x\n", count: 4000),
                                        recentSubjects: ["Thêm giỏ hàng", "sửa typo"])
        #expect(prompt.hasPrefix("Viết commit message bằng tiếng Việt"))
        #expect(prompt.contains("- Thêm giỏ hàng"))
        #expect(prompt.contains("đã cắt bớt"))
        #expect(prompt.count < CommitPrompt.maxPatchCharacters + 1500)
        #expect(CommitPrompt.build(stat: "", patch: "", recentSubjects: ["Add cart"]).hasPrefix("Write a git commit message"))
        #expect(CommitPrompt.build(stat: "", patch: "", recentSubjects: ["Corrige la sélection"]).hasPrefix("Write a git commit message"))
        #expect(CommitPrompt.build(stat: "", patch: "", recentSubjects: ["sửa lỗi"]).hasPrefix("Viết commit message"))

        let parsed = CommitPrompt.parse("```\nCommit message: Thêm kiểm tra mật khẩu.\n\n- kiểm tra độ dài\n- báo lỗi rõ ràng\n```")
        #expect(parsed.summary == "Thêm kiểm tra mật khẩu")
        #expect(parsed.body == "- kiểm tra độ dài\n- báo lỗi rõ ràng")

        let t = try await TestRepo.make()
        defer { t.cleanup() }
        try t.write("a.txt", "1\n")
        try await t.commitAll("gốc")
        try t.write("a.txt", "2\n")
        try await t.repo.stageAll()
        let staged = try await t.repo.stagedChangesForPrompt()
        #expect(staged.stat.contains("a.txt"))
        #expect(staged.patch.contains("+2"))
        #expect(await t.repo.recentSubjects() == ["gốc"])
    }
}
