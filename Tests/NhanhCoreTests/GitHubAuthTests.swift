import Foundation
import Testing
@testable import NhanhCore

@Suite("Đăng nhập GitHub (Device Flow, HTTP giả — không gọi mạng thật)")
struct GitHubAuthTests {
    static let deviceCodeJSON = #"""
    {"device_code":"dev-123","user_code":"WDJB-MJHT","verification_uri":"https://github.com/login/device","expires_in":900,"interval":5}
    """#
    static let code = GitHubDeviceCode(deviceCode: "dev-123", userCode: "WDJB-MJHT", verificationURL: GitHubAuth.defaultVerificationURL,
                                       expiresIn: 900, interval: 5)
    static let pollFields = [
        "client_id": "Iv1.thu",
        "device_code": "dev-123",
        "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
    ]

    @Test func deviceFlowWaitsThroughPendingAndSlowDown() async throws {
        let server = FakeGitHub([
            .json(200, Self.deviceCodeJSON),
            .json(200, #"{"error":"authorization_pending","error_description":"The authorization request is still pending."}"#),
            .json(200, #"{"error":"slow_down","error_description":"Too many requests have been made in the same timeframe.","interval":10}"#),
            .json(200, #"{"error":"authorization_pending"}"#),
            .json(200, #"{"access_token":"gho_thu123","token_type":"bearer","scope":"repo,workflow"}"#),
        ])
        let sleeps = SleepRecorder()
        // A client ID read from Info.plist may carry whitespace / newlines.
        let auth = GitHubAuth(clientID: " Iv1.thu\n", transport: server.transport, sleep: sleeps.sleep)

        let code = try await auth.requestDeviceCode()
        #expect(code == Self.code)
        #expect(try await auth.pollForToken(code) == "gho_thu123")
        // Wait `interval` before each poll; slow_down adds 5 more seconds for every one after it.
        #expect(sleeps.durations == [.seconds(5), .seconds(5), .seconds(10), .seconds(10)])

        let requests = server.requests
        #expect(requests.count == 5)
        #expect(requests[0].url == GitHubAuth.deviceCodeURL)
        #expect(requests[0].httpMethod == "POST")
        #expect(requests[0].value(forHTTPHeaderField: "Accept") == "application/json")
        #expect(formFields(requests[0]) == ["client_id": "Iv1.thu", "scope": "repo workflow read:org write:public_key"])
        for poll in requests.dropFirst() {
            #expect(poll.url == GitHubAuth.accessTokenURL)
            #expect(poll.httpMethod == "POST")
            #expect(formFields(poll) == Self.pollFields)
        }
    }

    @Test func pollingStopsWhenCodeExpires() async throws {
        let server = FakeGitHub([.json(200, #"{"error":"authorization_pending"}"#), .json(200, #"{"error":"expired_token"}"#)])
        let auth = GitHubAuth(clientID: "Iv1.thu", transport: server.transport, sleep: SleepRecorder().sleep)
        await #expect(throws: GitHubError.expired) { try await auth.pollForToken(Self.code) }

        // The user walks away without confirming: past `expires_in` the app stops polling on its own.
        let pending = #"{"error":"authorization_pending"}"#
        let idle = FakeGitHub([.json(200, pending), .json(200, pending), .json(200, pending)])
        let sleeps = SleepRecorder()
        let shortLived = GitHubDeviceCode(deviceCode: "dev-123", userCode: "WDJB-MJHT", verificationURL: GitHubAuth.defaultVerificationURL,
                                          expiresIn: 12, interval: 5)
        await #expect(throws: GitHubError.expired) {
            try await GitHubAuth(clientID: "Iv1.thu", transport: idle.transport, sleep: sleeps.sleep).pollForToken(shortLived)
        }
        #expect(idle.requests.count == 2)
        #expect(sleeps.durations == [.seconds(5), .seconds(5)])
    }

    @Test func pollingStopsWhenUserDenies() async throws {
        let server = FakeGitHub([
            .json(200, #"{"error":"authorization_pending"}"#),
            .json(200, #"{"error":"access_denied","error_description":"The authorization request was denied."}"#),
        ])
        let auth = GitHubAuth(clientID: "Iv1.thu", transport: server.transport, sleep: SleepRecorder().sleep)
        await #expect(throws: GitHubError.accessDenied) { try await auth.pollForToken(Self.code) }
        #expect(server.requests.count == 2)
    }

    @Test func notConfiguredWithoutClientIDOrDeviceFlow() async throws {
        // Info.plist leaves ThaigitGitHubClientID empty: no request is sent at all.
        let server = FakeGitHub([])
        let auth = GitHubAuth(clientID: "  ", transport: server.transport, sleep: SleepRecorder().sleep)
        #expect(!auth.isConfigured)
        #expect(GitHubAuth(clientID: nil).clientID == nil)
        await #expect(throws: GitHubError.notConfigured(nil)) { try await auth.requestDeviceCode() }
        await #expect(throws: GitHubError.notConfigured(nil)) { try await auth.pollForToken(Self.code) }
        #expect(server.requests.isEmpty)
        #expect(GitHubError.notConfigured(nil).errorDescription == "Chưa cấu hình (thiếu Client ID của GitHub OAuth App)")

        // The OAuth App hasn't enabled the Device Flow, or the client ID is wrong.
        let replies: [FakeGitHub.Reply] = [
            .json(400, #"{"error":"device_flow_disabled","error_description":"Device Flow must be explicitly enabled for this App"}"#),
            .json(200, #"{"error":"incorrect_client_credentials","error_description":"The client_id and/or client_secret passed are incorrect."}"#),
            .json(404, #"{"error":"Not Found"}"#),
        ]
        for reply in replies {
            let auth = GitHubAuth(clientID: "Iv1.sai", transport: FakeGitHub([reply]).transport, sleep: SleepRecorder().sleep)
            do {
                _ = try await auth.requestDeviceCode()
                Issue.record("Phải báo chưa cấu hình: \(reply)")
            } catch let error as GitHubError {
                guard case .notConfigured(let detail?) = error else {
                    Issue.record("Sai lỗi: \(error)")
                    continue
                }
                #expect(error.errorDescription?.hasPrefix("Chưa cấu hình") == true)
                #expect(!detail.isEmpty)
            }
        }
        // GitHub may also report a wrong client ID at the token-polling step.
        let polling = FakeGitHub([.json(200, #"{"error":"incorrect_client_credentials"}"#)])
        await #expect(throws: GitHubError.notConfigured("Client ID không đúng")) {
            try await GitHubAuth(clientID: "Iv1.sai", transport: polling.transport, sleep: SleepRecorder().sleep).pollForToken(Self.code)
        }
    }

    @Test func transientNetworkErrorsDoNotAbortPolling() async throws {
        let flaky = FakeGitHub([.failure(.notConnectedToInternet), .failure(.timedOut), .json(200, #"{"access_token":"gho_thu123"}"#)])
        let auth = GitHubAuth(clientID: "Iv1.thu", transport: flaky.transport, sleep: SleepRecorder().sleep)
        #expect(try await auth.pollForToken(Self.code) == "gho_thu123")

        let offline = FakeGitHub(Array(repeating: .failure(.notConnectedToInternet), count: 3))
        do {
            _ = try await GitHubAuth(clientID: "Iv1.thu", transport: offline.transport, sleep: SleepRecorder().sleep).pollForToken(Self.code)
            Issue.record("Mất mạng hẳn phải báo lỗi")
        } catch let error as GitHubError {
            guard case .network = error else {
                Issue.record("Sai lỗi: \(error)")
                return
            }
        }
        #expect(offline.requests.count == 3)

        // A network failure while getting the code: reported immediately.
        let down = FakeGitHub([.failure(.cannotFindHost)])
        do {
            _ = try await GitHubAuth(clientID: "Iv1.thu", transport: down.transport).requestDeviceCode()
            Issue.record("Phải báo lỗi mạng")
        } catch let error as GitHubError {
            guard case .network = error else {
                Issue.record("Sai lỗi: \(error)")
                return
            }
        }
    }

    @Test func cancellingStopsPolling() async throws {
        let server = FakeGitHub([])
        // A real Task.sleep: cancelling must stop right away rather than after the full 60 seconds. Only cancel once the
        // task really entered its wait (like the user closing the sign-in dialog) — never cancel a task that hasn't started.
        let (waiting, waitingSignal) = AsyncStream<Void>.makeStream()
        let auth = GitHubAuth(clientID: "Iv1.thu", transport: server.transport) { duration in
            waitingSignal.yield()
            try await Task.sleep(for: duration)
        }
        let slow = GitHubDeviceCode(deviceCode: "dev-123", userCode: "WDJB-MJHT", verificationURL: GitHubAuth.defaultVerificationURL,
                                    expiresIn: 900, interval: 60)
        let task = Task { try await auth.pollForToken(slow) }
        var signals = waiting.makeAsyncIterator()
        _ = await signals.next()
        task.cancel()
        let result = await task.result
        waitingSignal.finish()
        switch result {
        case .success:
            Issue.record("Đã huỷ mà vẫn trả token")
        case .failure(let error):
            #expect(error is CancellationError, "\(error)")
        }
        #expect(server.requests.isEmpty)
    }

    @Test func untrustedVerificationURLFallsBackToGitHub() async throws {
        let body = #"{"device_code":"d","user_code":"U","verification_uri":"https://evil.example.com/login/device","expires_in":900,"interval":5}"#
        let auth = GitHubAuth(clientID: "Iv1.thu", transport: FakeGitHub([.json(200, body)]).transport)
        #expect(try await auth.requestDeviceCode().verificationURL == GitHubAuth.defaultVerificationURL)
    }

    @Test func fetchUserSendsBearerToken() async throws {
        let server = FakeGitHub([
            .json(200, #"{"login":"octocat","id":583231,"name":"The Octocat","avatar_url":"https://avatars.githubusercontent.com/u/583231?v=4","type":"User"}"#),
            .json(401, #"{"message":"Bad credentials","documentation_url":"https://docs.github.com/rest"}"#),
        ])
        let auth = GitHubAuth(clientID: nil, transport: server.transport)
        let account = try await auth.fetchUser(token: "gho_thu123")
        #expect(account == GitHubAccount(id: 583231, login: "octocat", name: "The Octocat",
                                         avatarURL: URL(string: "https://avatars.githubusercontent.com/u/583231?v=4")))
        #expect(account.displayName == "The Octocat")
        #expect(GitHubAccount(id: 1, login: "hubot", name: nil, avatarURL: nil).displayName == "hubot")

        let request = try #require(server.requests.first)
        #expect(request.url == GitHubAuth.userURL)
        #expect(request.httpMethod == "GET")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer gho_thu123")
        #expect(request.value(forHTTPHeaderField: "Accept") == "application/vnd.github+json")
        #expect(request.value(forHTTPHeaderField: "X-GitHub-Api-Version") == "2022-11-28")

        // A revoked token.
        await #expect(throws: GitHubError.unauthorized) { try await auth.fetchUser(token: "gho_cu") }
    }

    @Test func repositoriesFollowLinkPagination() async throws {
        let first = GitHubAuth.repositoriesURL.absoluteString
        let page2 = first + "&page=2"
        let page3 = first + "&page=3"
        let server = FakeGitHub([
            .json(200, repositoriesJSON(["web", "rieng-api"]), headers: ["Link": #"<\#(page2)>; rel="next", <\#(page3)>; rel="last""#]),
            .json(200, repositoriesJSON(["docs", "web"]),
                  headers: ["Link": #"<\#(first)>; rel="prev", <\#(page3)>; rel="next", <\#(page3)>; rel="last", <\#(first)>; rel="first""#]),
            .json(200, repositoriesJSON(["cu"]), headers: ["Link": #"<\#(page2)>; rel="prev", <\#(first)>; rel="first""#]),
        ])
        let repositories = try await GitHubAuth(clientID: nil, transport: server.transport).listRepositories(token: "gho_thu123")

        // "web" was pushed to page 2 (just updated) and is kept only once.
        #expect(repositories.map(\.fullName) == ["octocat/web", "octocat/rieng-api", "octocat/docs", "octocat/cu"])
        #expect(repositories.map(\.isPrivate) == [false, true, false, false])
        #expect(repositories[0].cloneURL == "https://github.com/octocat/web.git")
        #expect(repositories[0].description == "Mô tả web")
        #expect(repositories[0].updatedAt == ISO8601DateFormatter().date(from: "2026-09-30T12:34:56Z"))
        #expect(repositories[3].description == nil)

        #expect(server.requests.map { $0.url?.absoluteString } == [first, page2, page3])
        #expect(server.requests.allSatisfy { $0.value(forHTTPHeaderField: "Authorization") == "Bearer gho_thu123" })
        let query = URLComponents(url: GitHubAuth.repositoriesURL, resolvingAgainstBaseURL: false)?.queryItems ?? []
        #expect(Dictionary(uniqueKeysWithValues: query.map { ($0.name, $0.value ?? "") }) == [
            "per_page": "100", "sort": "updated", "affiliation": "owner,collaborator,organization_member",
        ])
    }

    @Test func repositoriesStopAfterTenPagesAndNeverLeaveAPIHost() async throws {
        let endless = FakeGitHub(Array(repeating: .json(200, "[]", headers: ["Link": #"<https://api.github.com/user/repos?page=99>; rel="next""#]),
                                       count: 12))
        _ = try await GitHubAuth(clientID: nil, transport: endless.transport).listRepositories(token: "gho_thu123")
        #expect(endless.requests.count == GitHubAuth.maxRepositoryPages)

        // The next-page link points at another host: the token is never sent there.
        let foreign = FakeGitHub([.json(200, repositoriesJSON(["web"]), headers: ["Link": #"<https://evil.example.com/steal>; rel="next""#])])
        let repositories = try await GitHubAuth(clientID: nil, transport: foreign.transport).listRepositories(token: "gho_thu123")
        #expect(repositories.count == 1)
        #expect(foreign.requests.count == 1)

        let revoked = FakeGitHub([.json(401, #"{"message":"Bad credentials"}"#)])
        await #expect(throws: GitHubError.unauthorized) {
            try await GitHubAuth(clientID: nil, transport: revoked.transport).listRepositories(token: "gho_cu")
        }
    }

    @Test func listsOrganizationsAcrossPages() async throws {
        let first = GitHubAuth.organizationsURL.absoluteString
        let server = FakeGitHub([
            .json(200, #"[{"login":"Cong-Ty-ABC","id":10},{"login":"nhom-mo","id":11}]"#,
                  headers: ["Link": #"<\#(first)&page=2>; rel="next""#]),
            .json(200, #"[{"login":"cong-ty-abc","id":10},{"login":"du-an-cu","id":12}]"#),
        ])
        let organizations = try await GitHubAuth(clientID: nil, transport: server.transport).listOrganizations(token: "gho_thu123")
        // A duplicate (differing only in case) is kept only once.
        #expect(organizations == ["Cong-Ty-ABC", "nhom-mo", "du-an-cu"])
        #expect(server.requests.map { $0.url?.absoluteString } == [first, first + "&page=2"])
        #expect(server.requests.allSatisfy { $0.value(forHTTPHeaderField: "Authorization") == "Bearer gho_thu123" })
    }

    @Test func parsesLinkHeader() {
        // A URL with a comma in the query must not be split wrongly.
        let header = #"<https://api.github.com/user/repos?per_page=100&affiliation=owner,collaborator&page=2>; rel="next", <https://api.github.com/user/repos?per_page=100&affiliation=owner,collaborator&page=7>; rel="last""#
        #expect(GitHubAuth.nextPageURL(linkHeader: header)?.absoluteString
                == "https://api.github.com/user/repos?per_page=100&affiliation=owner,collaborator&page=2")
        #expect(GitHubAuth.nextPageURL(linkHeader: #"<https://api.github.com/x?page=1>; rel="prev", <https://api.github.com/x?page=3>; rel=next"#)?
            .absoluteString == "https://api.github.com/x?page=3")
        #expect(GitHubAuth.nextPageURL(linkHeader: #"<https://api.github.com/x?page=1>; rel="first", <https://api.github.com/x?page=1>; rel="prev""#) == nil)
        #expect(GitHubAuth.nextPageURL(linkHeader: nil) == nil)
        #expect(GitHubAuth.nextPageURL(linkHeader: "") == nil)
        #expect(GitHubAuth.nextPageURL(linkHeader: "không phải header Link") == nil)
    }
}

// MARK: - Fake GitHub server

/// Returns the queued responses in order and records every request — no real network connection anywhere.
final class FakeGitHub: Sendable {
    enum Reply: Sendable {
        case json(Int, String, headers: [String: String] = [:])
        case failure(URLError.Code)
    }

    private let replies: LockedBox<[Reply]>
    private let recorded = LockedBox([URLRequest]())

    init(_ replies: [Reply]) {
        self.replies = LockedBox(replies)
    }

    var requests: [URLRequest] { recorded.current }

    var transport: GitHubHTTPTransport {
        { [replies, recorded] request in
            recorded.withValue { $0.append(request) }
            guard let reply = replies.withValue({ $0.isEmpty ? nil : $0.removeFirst() }) else {
                Issue.record("Hết phản hồi giả cho \(request.url?.absoluteString ?? "?")")
                throw URLError(.badServerResponse)
            }
            switch reply {
            case .json(let status, let body, let headers):
                var fields = headers
                fields["Content-Type"] = "application/json; charset=utf-8"
                let url = request.url ?? GitHubAuth.userURL
                guard let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: fields) else {
                    throw URLError(.badServerResponse)
                }
                return (Data(body.utf8), response)
            case .failure(let code):
                throw URLError(code)
            }
        }
    }
}

/// Records the wait the app wants between two token polls, without actually waiting.
final class SleepRecorder: Sendable {
    private let box = LockedBox([Duration]())

    var durations: [Duration] { box.current }

    var sleep: GitHubSleep {
        { [box] duration in box.withValue { $0.append(duration) } }
    }
}

/// The fields of an `application/x-www-form-urlencoded` body.
func formFields(_ request: URLRequest) -> [String: String] {
    guard let body = request.httpBody, let text = String(data: body, encoding: .utf8) else { return [:] }
    var fields: [String: String] = [:]
    for pair in text.split(separator: "&") {
        let parts = pair.split(separator: "=", maxSplits: 1).map(String.init)
        fields[parts[0]] = parts.count > 1 ? (parts[1].removingPercentEncoding ?? parts[1]) : ""
    }
    return fields
}

/// One page of `GET /user/repos`: a repo whose name starts with "rieng" is private, repo "cu" has no description.
func repositoriesJSON(_ names: [String]) -> String {
    let items = names.map { name in
        let description = name == "cu" ? "null" : #""Mô tả \#(name)""#
        return #"{"name":"\#(name)","full_name":"octocat/\#(name)","private":\#(name.hasPrefix("rieng")),"clone_url":"https://github.com/octocat/\#(name).git","updated_at":"2026-09-30T12:34:56Z","description":\#(description),"stargazers_count":3}"#
    }
    return "[" + items.joined(separator: ",") + "]"
}
