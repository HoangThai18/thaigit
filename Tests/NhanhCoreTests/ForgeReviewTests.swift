import Foundation
import Testing
@testable import NhanhCore

/// Returns the queued responses for GitLab in order and records every request — no real network connection anywhere.
private final class ReviewGitLab: @unchecked Sendable {
    struct Reply {
        var status: Int
        var body: String
        var headers: [String: String] = [:]
    }

    private let lock = NSLock()
    private var replies: [Reply]
    private(set) var requests: [URLRequest] = []

    init(_ replies: [Reply]) {
        self.replies = replies
    }

    func transport() -> GitLabAPI.Transport {
        { request in
            let reply: Reply = self.lock.withLock {
                self.requests.append(request)
                return self.replies.isEmpty ? Reply(status: 500, body: "{}") : self.replies.removeFirst()
            }
            let response = HTTPURLResponse(url: request.url!, statusCode: reply.status, httpVersion: nil, headerFields: reply.headers)!
            return (Data(reply.body.utf8), response)
        }
    }

    func json(_ index: Int) -> [String: [Int]] {
        let data = lock.withLock { requests[index].httpBody ?? Data() }
        return (try? JSONSerialization.jsonObject(with: data) as? [String: [Int]]) ?? [:]
    }
}

@Suite("Review Pull Request / Merge Request: refspec, danh sách người, gán người (HTTP giả — không gọi mạng thật)")
struct ForgeReviewTests {
    static let repo = GitHubRepoRef(owner: "cong-ty", name: "web.app")
    private let project = GitLabProjectRef(host: "gitlab.com", path: "nhom/du-an")

    private func github(number: Int = 12, target: String = "main") -> ForgeRequest {
        ForgeRequest(kind: .github, number: number, title: "PR", body: "", author: "an", isDraft: false, webURL: nil,
                     sourceBranch: "tinh-nang", targetBranch: target, headSHA: "abc", updatedAt: nil)
    }

    private func gitlab(number: Int = 7, target: String = "main") -> ForgeRequest {
        ForgeRequest(kind: .gitlab, number: number, title: "MR", body: "", author: "an", isDraft: false, webURL: nil,
                     sourceBranch: "tinh-nang", targetBranch: target, headSHA: nil, updatedAt: nil)
    }

    // MARK: - Refspecs for review

    @Test func buildsRefspecsForGitHubAndGitLab() throws {
        let hub = try #require(github().reviewRefs(remote: "origin"))
        #expect(hub.refspecs == ["+refs/pull/12/head:refs/thaigit/review/origin/pr/12", "+refs/heads/main:refs/remotes/origin/main"])
        #expect(hub.headRef == "refs/thaigit/review/origin/pr/12")
        #expect(hub.baseRef == "refs/remotes/origin/main")

        let lab = try #require(gitlab(target: "release/1.0").reviewRefs(remote: "upstream"))
        #expect(lab.refspecs == ["+refs/merge-requests/7/head:refs/thaigit/review/upstream/mr/7",
                                 "+refs/heads/release/1.0:refs/remotes/upstream/release/1.0"])
        #expect(lab.headRef == "refs/thaigit/review/upstream/mr/7")
        #expect(lab.baseRef == "refs/remotes/upstream/release/1.0")
    }

    @Test func refusesUnsafeBranchAndRemoteNames() {
        for bad in ["", "-x", "a:b", "a b", "x..y", "a^b", "a\\b", "a~1", "a?b", "a*b", "a[b", "/a", "a/", "a//b", "a.", "a.lock", "a@{b", "a\u{7f}b"] {
            #expect(github(target: bad).reviewRefs(remote: "origin") == nil, "branch \(bad.debugDescription) must be refused")
        }
        #expect(github().reviewRefs(remote: "-evil") == nil)
        #expect(github().reviewRefs(remote: "a b") == nil)
        #expect(ForgeRequest.isSafeBranchName("feature/giỏ-hàng_2"))
    }

    @Test func referenceAndNames() {
        #expect(github().reference == "#12")
        #expect(gitlab().reference == "!7")
        #expect(github().kindName == "Pull Request")
        #expect(gitlab().kindName == "Merge Request")
    }

    @Test func peopleCompareByUsernameIgnoringCaseAndName() {
        let a = ForgePerson(username: "An-Nguyen")
        let b = ForgePerson(username: "an-nguyen", name: "An Nguyễn", gitlabID: 5)
        #expect(a == b)
        #expect(Set([a, b]).count == 1)
        #expect(b.displayName == "An Nguyễn")
        #expect(a.displayName == "An-Nguyen")
        #expect(ForgePerson(username: "x", name: "").displayName == "x")
    }

    // MARK: - GitHub

    @Test func readsAssigneesAndRequestedReviewersFromPullRequests() async throws {
        let body = #"""
        [{"number":12,"title":"PR 12","body":"Mô tả","draft":false,
          "html_url":"https://github.com/cong-ty/web.app/pull/12","user":{"login":"an"},
          "head":{"ref":"tinh-nang","sha":"abc12","repo":{"full_name":"cong-ty/web.app"}},
          "base":{"ref":"main","sha":"def","repo":{"full_name":"cong-ty/web.app"}},
          "updated_at":"2026-10-01T08:00:00Z",
          "assignees":[{"login":"binh"}],
          "requested_reviewers":[{"login":"chi"},{"login":"dung"}]},
         {"number":3,"title":"PR 3","body":null,"draft":true,
          "html_url":"https://github.com/cong-ty/web.app/pull/3","user":{"login":"an"},
          "head":{"ref":"cu","sha":"abc3","repo":null},
          "base":{"ref":"main","sha":"def","repo":{"full_name":"cong-ty/web.app"}}}]
        """#
        let server = FakeGitHub([.json(200, body)])
        let pulls = try await GitHubRepoAPI(transport: server.transport).openPullRequests(in: Self.repo, token: "gho_thu")
        #expect(pulls[0].assignees == ["binh"])
        #expect(pulls[0].reviewers == ["chi", "dung"])
        #expect(pulls[1].assignees.isEmpty)
        #expect(pulls[1].reviewers.isEmpty)

        let request = pulls[0].forgeRequest
        #expect(request.kind == .github)
        #expect(request.number == 12)
        #expect(request.body == "Mô tả")
        #expect(request.sourceBranch == "tinh-nang")
        #expect(request.targetBranch == "main")
        #expect(request.headSHA == "abc12")
        #expect(request.assignees.map(\.username) == ["binh"])
        #expect(request.reviewers.map(\.username) == ["chi", "dung"])
        #expect(pulls[1].forgeRequest.body == "")
        #expect(pulls[1].forgeRequest.isDraft)
    }

    @Test func listsAssignableUsersAcrossPagesWithoutDuplicates() async throws {
        let page2 = "https://api.github.com/repos/cong-ty/web.app/assignees?per_page=100&page=2"
        let server = FakeGitHub([
            .json(200, #"[{"login":"an"},{"login":"binh"}]"#, headers: ["Link": #"<\#(page2)>; rel="next""#]),
            .json(200, #"[{"login":"BINH"},{"login":"chi"}]"#),
        ])
        let users = try await GitHubRepoAPI(transport: server.transport).assignableUsers(in: Self.repo, token: "gho_thu")
        #expect(users.map(\.username) == ["an", "binh", "chi"])
        let first = try #require(server.requests.first?.url)
        #expect(first.path == "/repos/cong-ty/web.app/assignees")
        #expect(server.requests.last?.url?.absoluteString == page2)
        #expect(server.requests.allSatisfy { $0.value(forHTTPHeaderField: "Authorization") == "Bearer gho_thu" })
    }

    @Test func replacesAssigneesWithOnePatch() async throws {
        let server = FakeGitHub([.json(200, #"{"assignees":[{"login":"an"},{"login":"BINH"}]}"#)])
        try await GitHubRepoAPI(transport: server.transport).setAssignees(["an", "binh"], number: 12, in: Self.repo, token: "gho_thu")
        let request = try #require(server.requests.first)
        #expect(request.httpMethod == "PATCH")
        #expect(request.url?.path == "/repos/cong-ty/web.app/issues/12")
        let object = try JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: [String]]
        #expect(object == ["assignees": ["an", "binh"]])
    }

    @Test func detectsAssigneesThatGitHubSilentlyDropped() async throws {
        // No push permission (or the person can't be assigned): GitHub answers 200 but drops that part — the returned list is shorter.
        let dropped = FakeGitHub([.json(200, #"{"assignees":[{"login":"an"}]}"#)])
        await #expect(throws: ForgeReviewError.rejected) {
            try await GitHubRepoAPI(transport: dropped.transport).setAssignees(["an", "binh"], number: 12, in: Self.repo, token: "t")
        }
        // Removing everyone: an empty response is correct.
        let cleared = FakeGitHub([.json(200, #"{"assignees":[]}"#)])
        try await GitHubRepoAPI(transport: cleared.transport).setAssignees([], number: 12, in: Self.repo, token: "t")
        // A response with no `assignees` field (an older GitHub Enterprise…): draw no conclusion, treat it as success.
        let silent = FakeGitHub([.json(200, "{}")])
        try await GitHubRepoAPI(transport: silent.transport).setAssignees(["an"], number: 12, in: Self.repo, token: "t")
    }

    @Test func rateLimitIsNotReportedAsMissingPermission() async {
        let server = FakeGitHub([.json(403, "{}", headers: ["x-ratelimit-remaining": "0"])])
        await #expect(throws: GitHubRepoAPIError.rateLimited) {
            try await GitHubRepoAPI(transport: server.transport).setAssignees(["an"], number: 1, in: Self.repo, token: "t")
        }
    }

    @Test func removesThenAddsReviewersAndSkipsEmptyGroups() async throws {
        let server = FakeGitHub([.json(200, "{}"), .json(201, "{}")])
        try await GitHubRepoAPI(transport: server.transport)
            .updateReviewers(add: ["chi"], remove: ["dung"], number: 12, in: Self.repo, token: "gho_thu")
        #expect(server.requests.map { $0.httpMethod } == ["DELETE", "POST"])
        #expect(server.requests.allSatisfy { $0.url?.path == "/repos/cong-ty/web.app/pulls/12/requested_reviewers" })
        let removed = try JSONSerialization.jsonObject(with: server.requests[0].httpBody ?? Data()) as? [String: [String]]
        let added = try JSONSerialization.jsonObject(with: server.requests[1].httpBody ?? Data()) as? [String: [String]]
        #expect(removed == ["reviewers": ["dung"]])
        #expect(added == ["reviewers": ["chi"]])

        let none = FakeGitHub([])
        try await GitHubRepoAPI(transport: none.transport).updateReviewers(add: [], remove: [], number: 12, in: Self.repo, token: "gho_thu")
        #expect(none.requests.isEmpty)
    }

    @Test func mapsAssignmentFailuresToFriendlyReasons() async {
        func failure(_ status: Int, _ body: String) async -> ForgeReviewError? {
            let server = FakeGitHub([.json(status, body)])
            do {
                try await GitHubRepoAPI(transport: server.transport).setAssignees(["an"], number: 1, in: Self.repo, token: "t")
                return nil
            } catch {
                return error as? ForgeReviewError
            }
        }
        #expect(await failure(403, "{}") == .noPermission)
        #expect(await failure(404, "{}") == .noPermission)
        #expect(await failure(422, #"{"message":"Review cannot be requested from pull request author."}"#) == .authorCannotReview)
        #expect(await failure(422, #"{"message":"Reviews may only be requested from collaborators."}"#) == .notCollaborator)
        #expect(await failure(422, #"{"message":"khac"}"#) == .rejected)
        #expect(await failure(200, "{}") == nil)
    }

    // MARK: - GitLab

    @Test func listsOpenMergeRequestsWithPeople() async throws {
        let body = #"""
        [{"iid":7,"title":"Draft: Thêm giỏ hàng","description":"Mô tả MR","draft":true,
          "web_url":"https://gitlab.com/nhom/du-an/-/merge_requests/7",
          "author":{"id":1,"username":"an","name":"An"},
          "source_branch":"gio-hang","target_branch":"main","sha":"abc123",
          "updated_at":"2026-10-01T08:00:00.123Z",
          "assignees":[{"id":2,"username":"binh","name":"Bình"}],
          "reviewers":[{"id":3,"username":"chi","name":"Chi"},{"id":4,"username":"dung","name":null}]},
         {"iid":5,"title":"Cũ","description":null,"work_in_progress":true,
          "web_url":"https://evil.example/x","author":null,
          "source_branch":"cu","target_branch":"main"},
         {"iid":7,"title":"Trùng","source_branch":"x","target_branch":"main"}]
        """#
        let fake = ReviewGitLab([.init(status: 200, body: body)])
        let list = try await GitLabAPI(transport: fake.transport()).openMergeRequests(in: project, token: "tk")

        #expect(list.map(\.number) == [7, 5])
        let first = list[0]
        #expect(first.kind == .gitlab)
        #expect(first.reference == "!7")
        #expect(first.isDraft)
        #expect(first.body == "Mô tả MR")
        #expect(first.author == "an")
        #expect(first.sourceBranch == "gio-hang")
        #expect(first.targetBranch == "main")
        #expect(first.headSHA == "abc123")
        #expect(first.webURL?.absoluteString == "https://gitlab.com/nhom/du-an/-/merge_requests/7")
        #expect(first.updatedAt != nil)
        #expect(first.assignees == [ForgePerson(username: "binh", gitlabID: 2)])
        #expect(first.assignees[0].gitlabID == 2)
        #expect(first.reviewers.map(\.gitlabID) == [3, 4])
        #expect(first.reviewers[1].displayName == "dung")

        let second = list[1]
        #expect(second.isDraft)
        #expect(second.author == "?")
        #expect(second.body == "")
        #expect(second.webURL == nil)

        let request = fake.requests[0]
        #expect(request.httpMethod == nil || request.httpMethod == "GET")
        #expect(request.url?.host == "gitlab.com")
        #expect(request.url?.path == "/api/v4/projects/nhom/du-an/merge_requests")
        #expect(request.url?.absoluteString.contains("state=opened") == true)
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer tk")
    }

    @Test func listsActiveProjectMembersAcrossPages() async throws {
        let fake = ReviewGitLab([
            .init(status: 200, body: #"[{"id":1,"username":"an","name":"An","state":"active"},{"id":2,"username":"binh","name":"Bình","state":"blocked"}]"#,
                  headers: ["X-Next-Page": "2"]),
            .init(status: 200, body: #"[{"id":1,"username":"an","name":"An","state":"active"},{"id":3,"username":"chi","name":"Chi"}]"#,
                  headers: ["X-Next-Page": ""]),
        ])
        let people = try await GitLabAPI(transport: fake.transport()).projectMembers(of: project, token: "tk")
        #expect(people.map(\.username) == ["an", "chi"])
        #expect(people.map(\.gitlabID) == [1, 3])
        #expect(fake.requests.count == 2)
        #expect(fake.requests[0].url?.absoluteString.contains("page=1") == true)
        #expect(fake.requests[1].url?.absoluteString.contains("page=2") == true)
        #expect(fake.requests[0].url?.path == "/api/v4/projects/nhom/du-an/members/all")
    }

    @Test func setsPeopleWithOnePutAndZeroMeansNone() async throws {
        let fake = ReviewGitLab([.init(status: 200, body: "{}"), .init(status: 200, body: "{}"), .init(status: 200, body: "{}")])
        let api = GitLabAPI(transport: fake.transport())
        try await api.setPeople(iid: 7, assigneeIDs: [2], reviewerIDs: [3, 4], in: project, token: "tk")
        try await api.setPeople(iid: 7, assigneeIDs: [], reviewerIDs: nil, in: project, token: "tk")
        try await api.setPeople(iid: 7, assigneeIDs: nil, reviewerIDs: [], in: project, token: "tk")

        #expect(fake.requests.allSatisfy { $0.httpMethod == "PUT" })
        #expect(fake.requests[0].url?.absoluteString == "https://gitlab.com/api/v4/projects/nhom%2Fdu-an/merge_requests/7")
        #expect(fake.json(0) == ["assignee_ids": [2], "reviewer_ids": [3, 4]])
        #expect(fake.json(1) == ["assignee_ids": [0]])
        #expect(fake.json(2) == ["reviewer_ids": [0]])
    }

    @Test func mapsGitLabAssignmentFailures() async {
        func failure(_ status: Int) async -> (any Error)? {
            let fake = ReviewGitLab([.init(status: status, body: "{}")])
            do {
                try await GitLabAPI(transport: fake.transport()).setPeople(iid: 1, assigneeIDs: [1], reviewerIDs: nil, in: project, token: "tk")
                return nil
            } catch {
                return error
            }
        }
        #expect(await failure(403) as? ForgeReviewError == .noPermission)
        #expect(await failure(422) as? ForgeReviewError == .rejected)
        #expect(await failure(404) as? GitLabError == .projectNotFound)
        #expect(await failure(401) as? GitLabError == .unauthorized)
        #expect(await failure(500) as? GitLabError == .badResponse(500))
        #expect(await failure(200) == nil)
    }

    @Test func friendlyMessagesForAssignmentErrors() {
        for error in [ForgeReviewError.noPermission, .authorCannotReview, .notCollaborator, .rejected] {
            #expect(FriendlyError.message(for: error) == error.userMessage)
            #expect(!error.userMessage.isEmpty)
        }
    }
}
