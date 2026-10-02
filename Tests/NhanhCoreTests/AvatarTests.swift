import Foundation
import Testing
@testable import NhanhCore

@Suite("Ảnh đại diện", .serialized)
struct AvatarTests {
    @Test func parsesGitHubRemotes() {
        let expected = GitHubRepoRef(owner: "cong-ty", name: "du-an")
        for url in ["https://github.com/cong-ty/du-an.git", "https://ten:token@github.com/cong-ty/du-an",
                    "git@github.com:cong-ty/du-an.git", "ssh://git@github.com/cong-ty/du-an.git",
                    "ssh://git@ssh.github.com:443/cong-ty/du-an.git", "https://github.com/cong-ty/du-an/"] {
            #expect(GitHubRepoRef.parse(remoteURL: url) == expected, "\(url)")
        }
        for url in ["https://gitlab.com/a/b.git", "git@bitbucket.org:a/b.git", "/Users/a/du-an", "../du-an",
                    "https://github.com/chi-owner"] {
            #expect(GitHubRepoRef.parse(remoteURL: url) == nil, "\(url)")
        }
    }

    @Test func buildsAvatarURLs() throws {
        let withID = try #require(AvatarSource.githubNoreply("12345+Ten-A@users.noreply.github.com"))
        #expect(withID.id == 12345 && withID.login == "ten-a")
        let loginOnly = try #require(AvatarSource.githubNoreply("ten@users.noreply.github.com"))
        #expect(loginOnly.id == nil && loginOnly.login == "ten")
        #expect(AvatarSource.githubNoreply("ten@gmail.com") == nil)
        #expect(AvatarSource.githubAvatarURL(id: 12345, login: "ten", size: 80)?.absoluteString
            == "https://avatars.githubusercontent.com/u/12345?s=80&v=4")
        #expect(AvatarSource.githubAvatarURL(id: nil, login: "ten", size: 80)?.absoluteString == "https://github.com/ten.png?size=80")
        // Gravatar: SHA-256 của email đã trim + viết thường.
        #expect(AvatarSource.gravatarURL(email: "  Test@Example.com ", size: 80)?.absoluteString
            == "https://gravatar.com/avatar/973dfe463ec85785f5f95af5ba3906eedb2d931c24e69824a89ea65dba4e813b?s=80&d=404")

        let request = try #require(AvatarSource.githubCommitsRequest(repo: GitHubRepoRef(owner: "o", name: "r"), email: "A+b@x.vn"))
        #expect(request.url?.absoluteString == "https://api.github.com/repos/o/r/commits?author=a%2Bb@x.vn&per_page=1")
        #expect(request.value(forHTTPHeaderField: "Authorization") == nil)

        let json = Data(#"[{"sha":"1","author":{"login":"ten","avatar_url":"https://avatars.githubusercontent.com/u/9?v=4"}}]"#.utf8)
        #expect(AvatarSource.parseCommitAvatar(json, size: 80)?.absoluteString == "https://avatars.githubusercontent.com/u/9?v=4&s=80")
        #expect(AvatarSource.parseCommitAvatar(Data(#"[{"sha":"1","author":null}]"#.utf8), size: 80) == nil)
        #expect(AvatarSource.parseCommitAvatar(Data("[]".utf8), size: 80) == nil)
    }

    @Test func fetchesInOrderAndCaches() async throws {
        let cache = FileManager.default.temporaryDirectory.appendingPathComponent("nhanh-avatars-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: cache) }
        let png = Data([0x89, 0x50, 0x4E, 0x47, 1, 2, 3])
        let repo = GitHubRepoRef(owner: "o", name: "r")
        MockHTTP.reset { request in
            let url = request.url!.absoluteString
            if url.hasPrefix("https://api.github.com/repos/o/r/commits?author=co@vd.vn") {
                return (200, "application/json", Data(#"[{"author":{"avatar_url":"https://avatars.githubusercontent.com/u/7?v=4"}}]"#.utf8))
            }
            if url.hasPrefix("https://api.github.com/") { return (200, "application/json", Data("[]".utf8)) }
            if url.hasPrefix("https://avatars.githubusercontent.com/u/7") { return (200, "image/png", png) }
            if url.contains(AvatarSource.hash("gravatar@vd.vn")) { return (200, "image/jpeg", png) }
            return (404, "text/html", Data())
        }
        let fetcher = AvatarFetcher(cacheDirectory: cache, session: MockHTTP.session())

        // Qua API commit của repo GitHub.
        #expect(await fetcher.avatar(email: "co@vd.vn", repo: repo, size: 80) == png)
        // GitHub không biết email này → Gravatar.
        #expect(await fetcher.avatar(email: "gravatar@vd.vn", repo: repo, size: 80) == png)
        // Không ai có ảnh → nil, và nhớ "không có".
        #expect(await fetcher.avatar(email: "khong-co@vd.vn", repo: repo, size: 80) == nil)
        let requestsBefore = MockHTTP.requestCount
        #expect(await fetcher.avatar(email: "co@vd.vn", repo: repo, size: 80) == png)
        #expect(await fetcher.avatar(email: "khong-co@vd.vn", repo: repo, size: 80) == nil)
        #expect(MockHTTP.requestCount == requestsBefore, "Lần hai phải lấy từ cache trên đĩa")
    }

    @Test func networkErrorsAreNotRememberedAndRateLimitSkipsGitHub() async throws {
        let cache = FileManager.default.temporaryDirectory.appendingPathComponent("nhanh-avatars-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: cache) }
        let repo = GitHubRepoRef(owner: "o", name: "r")
        MockHTTP.reset { request in
            if request.url!.host == "api.github.com" { return (403, "application/json", Data("{}".utf8)) }
            return (500, "text/html", Data())
        }
        let fetcher = AvatarFetcher(cacheDirectory: cache, session: MockHTTP.session())
        #expect(await fetcher.avatar(email: "a@vd.vn", repo: repo, size: 80) == nil)
        #expect(MockHTTP.requests(host: "api.github.com") == 1)

        // Hết lượt API: không hỏi GitHub nữa; lỗi 500 không bị nhớ nên lần sau vẫn hỏi Gravatar.
        let png = Data([0x89, 0x50, 0x4E, 0x47])
        MockHTTP.reset { request in
            if request.url!.host == "api.github.com" { return (200, "application/json", Data("[]".utf8)) }
            return (200, "image/png", png)
        }
        #expect(await fetcher.avatar(email: "a@vd.vn", repo: repo, size: 80) == png)
        #expect(MockHTTP.requests(host: "api.github.com") == 0)
    }
}

/// URLProtocol giả: test không bao giờ gọi mạng thật.
final class MockHTTP: URLProtocol {
    typealias Handler = @Sendable (URLRequest) -> (status: Int, mime: String, body: Data)

    private static let state = LockedBox<(handler: Handler?, requests: [URLRequest])>((nil, []))

    static func reset(_ handler: @escaping Handler) {
        state.withValue { $0 = (handler, []) }
    }

    static var requestCount: Int { state.current.requests.count }

    static func requests(host: String) -> Int {
        state.current.requests.filter { $0.url?.host == host }.count
    }

    static func session() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockHTTP.self]
        return URLSession(configuration: configuration)
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let handler = Self.state.withValue { state -> Handler? in
            state.requests.append(request)
            return state.handler
        }
        let (status, mime, body) = handler?(request) ?? (404, "text/plain", Data())
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1",
                                       headerFields: ["Content-Type": mime])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
