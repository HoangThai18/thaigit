import Foundation
import Testing
@testable import NhanhCore

@Suite("Pull Request trên GitHub (HTTP giả — không gọi mạng thật)")
struct GitHubRepoAPITests {
    static let repo = GitHubRepoRef(owner: "cong-ty", name: "web.app")

    static func pullJSON(_ number: Int, head: String, headRepo: String? = "cong-ty/web.app", draft: Bool = false) -> String {
        let repoJSON = headRepo.map { #"{"full_name":"\#($0)"}"# } ?? "null"
        return #"""
        {"number":\#(number),"title":"PR \#(number)","body":"Mô tả","draft":\#(draft),
         "html_url":"https://github.com/cong-ty/web.app/pull/\#(number)","user":{"login":"an"},
         "head":{"ref":"\#(head)","sha":"abc\#(number)","repo":\#(repoJSON)},
         "base":{"ref":"main","sha":"def","repo":{"full_name":"cong-ty/web.app"}},
         "updated_at":"2026-10-01T08:00:00Z"}
        """#
    }

    @Test func listsOpenPullRequestsAcrossPages() async throws {
        let page2 = "https://api.github.com/repos/cong-ty/web.app/pulls?state=open&page=2"
        let server = FakeGitHub([
            .json(200, "[\(Self.pullJSON(12, head: "tinh-nang/gio-hang")),\(Self.pullJSON(9, head: "main", headRepo: "ban/web.app", draft: true))]",
                  headers: ["Link": #"<\#(page2)>; rel="next""#]),
            .json(200, "[\(Self.pullJSON(9, head: "main", headRepo: "ban/web.app")),\(Self.pullJSON(3, head: "cu", headRepo: nil))]"),
        ])
        let pulls = try await GitHubRepoAPI(transport: server.transport).openPullRequests(in: Self.repo, token: "gho_thu")

        #expect(pulls.map(\.number) == [12, 9, 3])
        #expect(pulls[0].headBranch == "tinh-nang/gio-hang")
        #expect(pulls[0].headSHA == "abc12")
        #expect(pulls[0].baseBranch == "main")
        #expect(pulls[0].author == "an")
        #expect(pulls[0].webURL?.absoluteString == "https://github.com/cong-ty/web.app/pull/12")
        #expect(pulls[0].updatedAt == ISO8601DateFormatter().date(from: "2026-10-01T08:00:00Z"))
        #expect(pulls[0].isSameRepository(as: Self.repo))
        #expect(pulls[1].isDraft)
        #expect(!pulls[1].isSameRepository(as: Self.repo))
        #expect(pulls[2].headRepository == nil)

        let first = try #require(server.requests.first?.url)
        #expect(first.host == "api.github.com")
        #expect(first.path == "/repos/cong-ty/web.app/pulls")
        let query = URLComponents(url: first, resolvingAgainstBaseURL: false)?.queryItems ?? []
        #expect(Dictionary(uniqueKeysWithValues: query.map { ($0.name, $0.value ?? "") })
                == ["state": "open", "sort": "updated", "direction": "desc", "per_page": "100"])
        #expect(server.requests.map { $0.url?.absoluteString }.last == page2)
        #expect(server.requests.allSatisfy { $0.value(forHTTPHeaderField: "Authorization") == "Bearer gho_thu" })
    }

    @Test func publicRepositoryWithoutTokenAndForeignLinksAreIgnored() async throws {
        // Not signed in: no Authorization header is sent; a next page on another host stops the walk.
        let server = FakeGitHub([.json(200, "[\(Self.pullJSON(1, head: "a"))]",
                                       headers: ["Link": #"<https://evil.example.com/pulls?page=2>; rel="next""#])])
        let pulls = try await GitHubRepoAPI(transport: server.transport).openPullRequests(in: Self.repo, token: nil)
        #expect(pulls.count == 1)
        #expect(server.requests.count == 1)
        #expect(server.requests[0].value(forHTTPHeaderField: "Authorization") == nil)

        // The maximum page.
        let endless = FakeGitHub(Array(repeating: .json(200, "[]", headers: [
            "Link": #"<https://api.github.com/repos/cong-ty/web.app/pulls?page=9>; rel="next""#,
        ]), count: 5))
        _ = try await GitHubRepoAPI(transport: endless.transport).openPullRequests(in: Self.repo, token: nil)
        #expect(endless.requests.count == GitHubRepoAPI.maxPages)
    }

    @Test func createsPullRequestAndExplainsRejections() async throws {
        let server = FakeGitHub([.json(201, Self.pullJSON(42, head: "sua-loi"))])
        let api = GitHubRepoAPI(transport: server.transport)
        let created = try await api.createPullRequest(
            NewPullRequest(title: "Sửa lỗi giỏ hàng", body: "- sửa tổng tiền", head: "sua-loi", base: "main", draft: true),
            in: Self.repo, token: "gho_thu")
        #expect(created.number == 42)
        let request = try #require(server.requests.first)
        #expect(request.httpMethod == "POST")
        #expect(request.url?.absoluteString == "https://api.github.com/repos/cong-ty/web.app/pulls")
        let body = try #require(request.httpBody)
        let fields = try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])
        #expect(fields["title"] as? String == "Sửa lỗi giỏ hàng")
        #expect(fields["head"] as? String == "sua-loi")
        #expect(fields["base"] as? String == "main")
        #expect(fields["draft"] as? Bool == true)

        let exists = FakeGitHub([.json(422, #"{"message":"Validation Failed","errors":[{"resource":"PullRequest","code":"custom","message":"A pull request already exists for cong-ty:sua-loi."}]}"#)])
        await #expect(throws: GitHubRepoAPIError.rejected("Nhánh này đã có một Pull Request đang mở.")) {
            _ = try await GitHubRepoAPI(transport: exists.transport).createPullRequest(
                NewPullRequest(title: "x", body: "", head: "sua-loi", base: "main", draft: false), in: Self.repo, token: "gho_thu")
        }
        let empty = FakeGitHub([.json(422, #"{"message":"Validation Failed","errors":[{"message":"No commits between main and sua-loi"}]}"#)])
        await #expect(throws: GitHubRepoAPIError.rejected("Không có commit nào khác giữa hai nhánh — chưa có gì để tạo Pull Request.")) {
            _ = try await GitHubRepoAPI(transport: empty.transport).createPullRequest(
                NewPullRequest(title: "x", body: "", head: "sua-loi", base: "main", draft: false), in: Self.repo, token: "gho_thu")
        }
    }

    @Test func mapsErrorsAndDefaultBranch() async throws {
        let server = FakeGitHub([
            .json(200, #"{"name":"web.app","default_branch":"develop"}"#),
            .json(404, #"{"message":"Not Found"}"#),
            .json(403, #"{"message":"API rate limit exceeded"}"#, headers: ["x-ratelimit-remaining": "0"]),
            .json(401, #"{"message":"Bad credentials"}"#),
        ])
        let api = GitHubRepoAPI(transport: server.transport)
        #expect(try await api.defaultBranch(of: Self.repo, token: nil) == "develop")
        #expect(server.requests[0].url?.absoluteString == "https://api.github.com/repos/cong-ty/web.app")
        await #expect(throws: GitHubRepoAPIError.notFound) { _ = try await api.openPullRequests(in: Self.repo, token: nil) }
        await #expect(throws: GitHubRepoAPIError.rateLimited) { _ = try await api.openPullRequests(in: Self.repo, token: nil) }
        await #expect(throws: GitHubError.unauthorized) { _ = try await api.openPullRequests(in: Self.repo, token: "gho_cu") }
    }

    @Test func refusesOddRepositoryNamesWithoutCallingGitHub() async throws {
        let server = FakeGitHub([])
        let api = GitHubRepoAPI(transport: server.transport)
        for bad in [GitHubRepoRef(owner: "a/../b", name: "web"), GitHubRepoRef(owner: "an", name: "web?x=1"),
                    GitHubRepoRef(owner: "an", name: ".."), GitHubRepoRef(owner: "an.b", name: "web")] {
            await #expect(throws: GitHubRepoAPIError.invalidRepository) { _ = try await api.openPullRequests(in: bad, token: "gho_thu") }
        }
        #expect(server.requests.isEmpty)
        #expect(GitHubRepoAPI.trustedWebURL("https://evil.example.com/pull/1") == nil)
        #expect(GitHubRepoAPI.trustedWebURL("https://github.com/a/b/pull/1") != nil)
    }
}
