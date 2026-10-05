import Foundation

extension GitLabAPI {
    /// Max number of member pages (100 people each) fetched when listing assignable people.
    static let maxMemberPages = 3

    /// The project's open Merge Requests, most recently updated first (`GET /api/v4/projects/:id/merge_requests?state=opened`).
    /// Only one page of 100 MRs is read — enough for the sidebar. The token only ever goes to `https://<the project's host>`.
    public func openMergeRequests(in project: GitLabProjectRef, token: String) async throws -> [ForgeRequest] {
        let path = "/api/v4/projects/\(project.encodedPath)/merge_requests?state=opened&order_by=updated_at&sort=desc&per_page=100"
        let (data, response) = try await send(Self.apiRequest(host: project.host, path: path, token: token))
        if response.statusCode == 404 { throw GitLabError.projectNotFound }
        try Self.check(response)
        guard let items = try? JSONDecoder().decode([MergeRequestPayload].self, from: data) else { throw GitLabError.invalidResponse }
        var seen = Set<Int>()
        var result: [ForgeRequest] = []
        for item in items {
            if seen.insert(item.iid).inserted { result.append(item.forgeRequest(host: project.host)) }
        }
        return result
    }

    /// The project's active members, including ones inherited from groups (`GET …/members/all`) — the people who can
    /// be assigned / asked to review.
    public func projectMembers(of project: GitLabProjectRef, token: String) async throws -> [ForgePerson] {
        var result: [ForgePerson] = []
        var seen = Set<Int>()
        var page = 1
        while page > 0, page <= Self.maxMemberPages {
            let path = "/api/v4/projects/\(project.encodedPath)/members/all?per_page=100&page=\(page)"
            let (data, response) = try await send(Self.apiRequest(host: project.host, path: path, token: token))
            if response.statusCode == 404 { throw GitLabError.projectNotFound }
            try Self.check(response)
            guard let items = try? JSONDecoder().decode([MemberPayload].self, from: data) else { throw GitLabError.invalidResponse }
            for item in items {
                guard item.state == nil || item.state == "active" else { continue }
                if seen.insert(item.id).inserted {
                    result.append(ForgePerson(username: item.username, name: item.name, gitlabID: item.id))
                }
            }
            page = Int(response.value(forHTTPHeaderField: "X-Next-Page") ?? "") ?? 0
        }
        return result
    }

    /// Replace the MR's assignees and reviewers (`PUT /api/v4/projects/:id/merge_requests/:iid`). `nil` means leave unchanged;
    /// an empty list removes them all (GitLab accepts `[0]` for that).
    public func setPeople(iid: Int, assigneeIDs: [Int]?, reviewerIDs: [Int]?, in project: GitLabProjectRef, token: String) async throws {
        var request = Self.apiRequest(host: project.host, path: "/api/v4/projects/\(project.encodedPath)/merge_requests/\(iid)", token: token)
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: [Int]] = [:]
        if let assigneeIDs { body["assignee_ids"] = assigneeIDs.isEmpty ? [0] : assigneeIDs }
        if let reviewerIDs { body["reviewer_ids"] = reviewerIDs.isEmpty ? [0] : reviewerIDs }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (_, response) = try await send(request)
        switch response.statusCode {
        case 200..<300: return
        case 403: throw ForgeReviewError.noPermission
        case 404: throw GitLabError.projectNotFound
        case 400, 409, 422: throw ForgeReviewError.rejected
        default:
            try Self.check(response)
            throw GitLabError.badResponse(response.statusCode)
        }
    }

    struct MergeRequestPayload: Decodable {
        struct User: Decodable {
            let id: Int
            let username: String
            let name: String?
        }

        let iid: Int
        let title: String
        let description: String?
        let draft: Bool?
        let work_in_progress: Bool?
        let web_url: String?
        let author: User?
        let source_branch: String
        let target_branch: String
        let sha: String?
        let updated_at: String?
        let assignees: [User]?
        let reviewers: [User]?

        func forgeRequest(host: String) -> ForgeRequest {
            let people: ([User]?) -> [ForgePerson] = { users in
                (users ?? []).map { ForgePerson(username: $0.username, name: $0.name, gitlabID: $0.id) }
            }
            return ForgeRequest(
                kind: .gitlab, number: iid, title: title, body: description ?? "", author: author?.username ?? "?",
                isDraft: draft ?? work_in_progress ?? false,
                webURL: GitLabAPI.trustedWebURL(web_url, host: host),
                sourceBranch: source_branch, targetBranch: target_branch, headSHA: sha,
                updatedAt: updated_at.flatMap(GitHubRepository.parseDate),
                assignees: people(assignees), reviewers: people(reviewers))
        }
    }

    struct MemberPayload: Decodable {
        let id: Int
        let username: String
        let name: String?
        let state: String?
    }
}
