import Foundation
import Testing
@testable import NhanhCore

/// A fake HTTP layer for GitLab: answers by path and records requests — the real network is never touched.
private final class FakeGitLab: @unchecked Sendable {
    private let lock = NSLock()
    private(set) var requests: [URLRequest] = []
    var responses: [String: [(Int, String)]] = [:]

    func transport() -> GitLabAPI.Transport {
        { request in
            let path = request.url?.path ?? ""
            let (status, body) = self.lock.withLock { () -> (Int, String) in
                self.requests.append(request)
                var queue = self.responses[path] ?? []
                let next = queue.isEmpty ? (404, "{}") : queue.removeFirst()
                self.responses[path] = queue
                return next
            }
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
            return (Data(body.utf8), response)
        }
    }

    func form(_ index: Int) -> [String: String] {
        let body = lock.withLock { String(decoding: requests[index].httpBody ?? Data(), as: UTF8.self) }
        var result: [String: String] = [:]
        for pair in body.split(separator: "&") {
            let parts = pair.split(separator: "=", maxSplits: 1).map { String($0).removingPercentEncoding ?? "" }
            if parts.count == 2 { result[parts[0]] = parts[1] }
        }
        return result
    }
}

@Suite("GitLab (HTTP giả — không gọi mạng thật)")
struct GitLabTests {
    private func api(_ fake: FakeGitLab) -> GitLabAPI {
        GitLabAPI(transport: fake.transport(), sleep: { _ in })
    }

    @Test func normalizesHosts() {
        #expect(GitLabAPI.normalizedHost("gitlab.com") == "gitlab.com")
        #expect(GitLabAPI.normalizedHost(" https://GitLab.Cong-Ty.vn/nhom/repo ") == "gitlab.cong-ty.vn")
        #expect(GitLabAPI.normalizedHost("gitlab.vd.vn:8443") == "gitlab.vd.vn:8443")
        #expect(GitLabAPI.normalizedHost("user@gitlab.com") == nil)
        #expect(GitLabAPI.normalizedHost("khong hop le") == nil)
        #expect(GitLabAPI.normalizedHost("") == nil)
    }

    @Test func deviceFlowWaitsAndReturnsRefreshableToken() async throws {
        let fake = FakeGitLab()
        fake.responses["/oauth/authorize_device"] = [(200, #"{"device_code":"dc","user_code":"ABCD-1234","verification_uri":"https://gitlab.com/oauth/device","verification_uri_complete":"https://evil.example/x","expires_in":300,"interval":5}"#)]
        fake.responses["/oauth/token"] = [
            (400, #"{"error":"authorization_pending"}"#),
            (400, #"{"error":"slow_down"}"#),
            (200, #"{"access_token":"at","refresh_token":"rt","expires_in":7200}"#),
        ]
        let code = try await api(fake).requestDeviceCode(host: "gitlab.com", clientID: "cid")
        #expect(code.userCode == "ABCD-1234")
        // A confirmation page pointing at an odd host falls back to that host's own default page.
        #expect(code.verificationURL.host == "gitlab.com")
        #expect(fake.form(0)["scope"] == GitLabAPI.scopes)

        let now = Date(timeIntervalSince1970: 1_000)
        let token = try await api(fake).pollForToken(host: "gitlab.com", clientID: "cid", code: code, now: { now })
        #expect(token.accessToken == "at")
        #expect(token.isOAuth)
        #expect(token.expiresAt == now.addingTimeInterval(7200))
        #expect(fake.form(1)["grant_type"] == "urn:ietf:params:oauth:grant-type:device_code")
        #expect("\(token)".contains("ẩn"))
        #expect(!"\(token)".contains("at\""))
    }

    @Test func unknownClientIDIsNotConfigured() async {
        let fake = FakeGitLab()
        fake.responses["/oauth/authorize_device"] = [(401, #"{"error":"invalid_client"}"#)]
        await #expect(throws: GitLabError.notConfigured) {
            try await api(fake).requestDeviceCode(host: "gitlab.com", clientID: "sai")
        }
    }

    @Test func refreshesExpiringTokensOnceAndPicksAccountByHost() async throws {
        let fake = FakeGitLab()
        fake.responses["/oauth/token"] = [(200, #"{"access_token":"moi","refresh_token":"rt2","expires_in":7200}"#)]
        let tokens = InMemoryGitLabTokenStore()
        let accounts = GitLabAccounts(storage: InMemorySettingsStorage(), tokens: tokens, api: api(fake), clientIDs: { _ in "cid" })
        let old = GitLabToken(accessToken: "cu", refreshToken: "rt1", expiresAt: Date().addingTimeInterval(30))
        let account = try accounts.add(host: "gitlab.com", user: GitLabUser(id: 1, username: "Alice", name: "Alice", avatarURL: nil), token: old)
        _ = try accounts.add(host: "gitlab.cong-ty.vn", user: GitLabUser(id: 2, username: "bob", name: nil, avatarURL: nil),
                             token: GitLabToken(accessToken: "pat", refreshToken: nil, expiresAt: nil))

        async let first = accounts.validToken(for: account)
        async let second = accounts.validToken(for: account)
        let results = await [first, second]
        #expect(results.allSatisfy { $0?.accessToken == "moi" })
        #expect(fake.requests.count == 1)
        #expect(fake.form(0)["refresh_token"] == "rt1")
        #expect(try tokens.read(key: account.key)?.refreshToken == "rt2")

        let oauth = await accounts.credential(forURLs: ["https://gitlab.com/nhom/app.git"])
        #expect(oauth?.username == "oauth2")
        #expect(oauth?.token == "moi")
        let pat = await accounts.credential(forURLs: ["git@github.com:a/b.git", "https://gitlab.cong-ty.vn/x/y.git"])
        #expect(pat?.username == "bob")
        #expect(pat?.token == "pat")
        #expect(await accounts.credential(forURLs: ["https://github.com/a/b.git", "http://gitlab.com/a/b"]) == nil)

        let additions = GitLabCredentialInjection.additions(for: pat, helperPath: "/tmp/h.sh")
        #expect(additions.arguments == ["-c", "credential.https://gitlab.cong-ty.vn.helper=",
                                        "-c", "credential.https://gitlab.cong-ty.vn.helper=!'/tmp/h.sh'"])
        #expect(additions.environment[GitLabCredentialInjection.tokenVariable] == "pat")

        try accounts.remove(key: account.key)
        #expect(accounts.accounts.map(\.host) == ["gitlab.cong-ty.vn"])
        #expect(try tokens.read(key: account.key) == nil)
    }

    @Test func helperScriptAnswersOnlyGet() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("thaigit-gl-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let script = try GitLabCredentialHelper.install(in: directory)
        let environment = ["PATH": "/usr/bin:/bin", GitLabCredentialInjection.userVariable: "oauth2",
                           GitLabCredentialInjection.tokenVariable: "bi-mat"]
        let get = try await ProcessRunner.run(executable: script, arguments: ["get"], environment: environment, input: Data("host=gitlab.com\n\n".utf8))
        #expect(get.stdoutString == "username=oauth2\npassword=bi-mat\n")
        let store = try await ProcessRunner.run(executable: script, arguments: ["store"], environment: environment, input: Data())
        #expect(store.stdoutString.isEmpty)
    }

    @Test func sshKeyUploadOutcomes() async throws {
        let fake = FakeGitLab()
        fake.responses["/api/v4/user/keys"] = [
            (201, "{}"), (400, #"{"message":{"key":["has already been taken"]}}"#), (403, "{}"),
        ]
        let gitlab = api(fake)
        #expect(try await gitlab.addSSHKey(host: "gitlab.com", token: "t", title: "x", publicKey: "ssh-ed25519 AAAA") == .added)
        #expect(try await gitlab.addSSHKey(host: "gitlab.com", token: "t", title: "x", publicKey: "ssh-ed25519 AAAA") == .alreadyExists)
        #expect(try await gitlab.addSSHKey(host: "gitlab.com", token: "t", title: "x", publicKey: "ssh-ed25519 AAAA") == .missingScope)
        #expect(fake.requests.first?.value(forHTTPHeaderField: "Authorization") == "Bearer t")
    }
}
