import Foundation
import Testing
@testable import NhanhCore

private final class RecordingGitLab: @unchecked Sendable {
    private let lock = NSLock()
    private(set) var requests: [URLRequest] = []
    var status = 201
    var body = #"{"iid":12,"title":"Tiêu đề","web_url":"https://gitlab.com/nhom/du-an/-/merge_requests/12"}"#

    func transport() -> GitLabAPI.Transport {
        { request in
            self.lock.withLock { self.requests.append(request) }
            let response = HTTPURLResponse(url: request.url!, statusCode: self.status, httpVersion: nil, headerFields: nil)!
            return (Data(self.body.utf8), response)
        }
    }

    func json(_ index: Int = 0) -> [String: String] {
        let data = lock.withLock { requests[index].httpBody ?? Data() }
        return (try? JSONSerialization.jsonObject(with: data) as? [String: String]) ?? [:]
    }
}

@Suite("GitLab Merge Request (HTTP giả — không gọi mạng thật)")
struct GitLabMergeRequestTests {
    private let project = GitLabProjectRef(host: "gitlab.com", path: "nhom/nhom-con/du-an")

    private func new(draft: Bool = false) -> NewMergeRequest {
        NewMergeRequest(title: "Thêm giỏ hàng", description: "Mô tả", sourceBranch: "feature/gio-hang", targetBranch: "main", draft: draft)
    }

    @Test func parsesGitLabRemotes() {
        #expect(GitLabProjectRef.parse(remoteURL: "https://gitlab.com/nhom/du-an.git") == GitLabProjectRef(host: "gitlab.com", path: "nhom/du-an"))
        #expect(GitLabProjectRef.parse(remoteURL: "git@gitlab.com:nhom/nhom-con/du-an.git")
                == GitLabProjectRef(host: "gitlab.com", path: "nhom/nhom-con/du-an"))
        #expect(GitLabProjectRef.parse(remoteURL: "ssh://git@gitlab.cong-ty.vn:2222/nhom/du-an")
                == GitLabProjectRef(host: "gitlab.cong-ty.vn", path: "nhom/du-an"))
        #expect(GitLabProjectRef.parse(remoteURL: "https://user@gitlab.cong-ty.vn:8443/nhom/du-an.git")
                == GitLabProjectRef(host: "gitlab.cong-ty.vn:8443", path: "nhom/du-an"))
        #expect(GitLabProjectRef.parse(remoteURL: "https://www.gitlab.com/nhom/du-an")?.host == "gitlab.com")
    }

    @Test func rejectsOtherHostsAndUnsafePaths() {
        #expect(GitLabProjectRef.parse(remoteURL: "https://github.com/nhom/du-an.git") == nil)
        #expect(GitLabProjectRef.parse(remoteURL: "https://git.cong-ty.vn/nhom/du-an.git") == nil)
        #expect(GitLabProjectRef.parse(remoteURL: "https://gitlab.com/du-an") == nil)
        #expect(GitLabProjectRef.parse(remoteURL: "https://gitlab.com/nhom/../du-an") == nil)
        #expect(GitLabProjectRef.parse(remoteURL: "https://gitlab.com/nhom/du an") == nil)
        #expect(GitLabProjectRef.parse(remoteURL: "/duong/dan/cuc/bo") == nil)
    }

    @Test func acceptsHostsOfSignedInAccounts() {
        let known: Set<String> = ["git.cong-ty.vn"]
        #expect(GitLabProjectRef.parse(remoteURL: "git@git.cong-ty.vn:nhom/du-an.git", knownHosts: known)?.host == "git.cong-ty.vn")
        #expect(GitLabProjectRef.parse(remoteURL: "https://git.khac.vn/nhom/du-an.git", knownHosts: known) == nil)
    }

    @Test func encodesProjectPathInTheRequestURL() async throws {
        let fake = RecordingGitLab()
        _ = try await GitLabAPI(transport: fake.transport()).createMergeRequest(new(), in: project, token: "tk")
        let request = fake.requests[0]
        #expect(request.httpMethod == "POST")
        #expect(request.url?.absoluteString == "https://gitlab.com/api/v4/projects/nhom%2Fnhom-con%2Fdu-an/merge_requests")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer tk")
        #expect(fake.json()["source_branch"] == "feature/gio-hang")
        #expect(fake.json()["target_branch"] == "main")
        #expect(fake.json()["title"] == "Thêm giỏ hàng")
        #expect(fake.json()["description"] == "Mô tả")
    }

    @Test func returnsNumberAndTrustedLink() async throws {
        let fake = RecordingGitLab()
        let created = try await GitLabAPI(transport: fake.transport()).createMergeRequest(new(), in: project, token: "tk")
        #expect(created.iid == 12)
        #expect(created.webURL?.absoluteString == "https://gitlab.com/nhom/du-an/-/merge_requests/12")

        fake.body = #"{"iid":3,"title":"x","web_url":"https://evil.example/x"}"#
        let other = try await GitLabAPI(transport: fake.transport()).createMergeRequest(new(), in: project, token: "tk")
        #expect(other.webURL == nil)
    }

    @Test func draftAddsPrefixOnce() async throws {
        let fake = RecordingGitLab()
        let api = GitLabAPI(transport: fake.transport())
        _ = try await api.createMergeRequest(new(draft: true), in: project, token: "tk")
        #expect(fake.json(0)["title"] == "Draft: Thêm giỏ hàng")
        var already = new(draft: true)
        already.title = "draft: đã có"
        _ = try await api.createMergeRequest(already, in: project, token: "tk")
        #expect(fake.json(1)["title"] == "draft: đã có")
    }

    @Test func mapsRejectionsToFriendlyReasons() async {
        let fake = RecordingGitLab()
        let api = GitLabAPI(transport: fake.transport())
        func failure(_ status: Int, _ body: String) async -> GitLabError? {
            fake.status = status
            fake.body = body
            do {
                _ = try await api.createMergeRequest(new(), in: project, token: "tk")
                return nil
            } catch {
                return error as? GitLabError
            }
        }
        #expect(await failure(409, #"{"message":["Another open merge request already exists for this source branch: !5"]}"#)
                == .mergeRequestRejected(.alreadyExists))
        #expect(await failure(400, #"{"message":"Source branch does not exist"}"#) == .mergeRequestRejected(.sourceMissing))
        #expect(await failure(422, #"{"message":"Target branch does not exist"}"#) == .mergeRequestRejected(.targetMissing))
        #expect(await failure(422, #"{"message":"khong ro"}"#) == .mergeRequestRejected(.other))
        #expect(await failure(401, "{}") == .unauthorized)
        #expect(await failure(403, "{}") == .forbidden)
        #expect(await failure(404, "{}") == .projectNotFound)
        #expect(await failure(500, "{}") == .badResponse(500))
    }

    @Test func readsDefaultBranchWithAndWithoutToken() async throws {
        let fake = RecordingGitLab()
        fake.status = 200
        fake.body = #"{"default_branch":"develop"}"#
        let api = GitLabAPI(transport: fake.transport())
        #expect(try await api.defaultBranch(of: project, token: "tk") == "develop")
        #expect(fake.requests[0].value(forHTTPHeaderField: "Authorization") == "Bearer tk")
        #expect(try await api.defaultBranch(of: project, token: nil) == "develop")
        #expect(fake.requests[1].value(forHTTPHeaderField: "Authorization") == nil)
    }

    @Test func picksAccountAndTokenByHost() async throws {
        let accounts = GitLabAccounts(storage: InMemorySettingsStorage(), tokens: InMemoryGitLabTokenStore(), api: GitLabAPI(),
                                      clientIDs: { _ in nil })
        _ = try accounts.add(host: "gitlab.com", user: GitLabUser(id: 1, username: "alice", name: nil, avatarURL: nil),
                             token: GitLabToken(accessToken: "tk-alice", refreshToken: nil, expiresAt: nil))
        _ = try accounts.add(host: "gitlab.com", user: GitLabUser(id: 2, username: "bob", name: nil, avatarURL: nil),
                             token: GitLabToken(accessToken: "tk-bob", refreshToken: nil, expiresAt: nil))
        _ = try accounts.add(host: "gitlab.cong-ty.vn:8443", user: GitLabUser(id: 3, username: "carol", name: nil, avatarURL: nil),
                             token: GitLabToken(accessToken: "tk-carol", refreshToken: nil, expiresAt: nil))

        #expect(accounts.account(forHost: "gitlab.com")?.user.username == "alice")
        #expect(accounts.account(forHost: "gitlab.com", preferredUser: "BOB")?.user.username == "bob")
        #expect(await accounts.apiToken(forHost: "gitlab.com", preferredUser: "bob") == "tk-bob")
        #expect(accounts.account(forHost: "gitlab.cong-ty.vn:8443")?.user.username == "carol")
        #expect(accounts.account(forHost: "gitlab.cong-ty.vn")?.user.username == "carol")
        #expect(accounts.account(forHost: "git.khac.vn") == nil)
        #expect(await accounts.apiToken(forHost: "git.khac.vn") == nil)
    }
}
