import Foundation
import Testing
@testable import NhanhCore

@Suite("Ảnh đại diện")
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
        let server = FakeHTTP { request in
            let url = request.url!.absoluteString
            if url.hasPrefix("https://api.github.com/repos/o/r/commits?author=co@vd.vn") {
                return (200, "application/json", Data(#"[{"author":{"avatar_url":"https://avatars.githubusercontent.com/u/7?v=4"}}]"#.utf8))
            }
            if url.hasPrefix("https://api.github.com/") { return (200, "application/json", Data("[]".utf8)) }
            if url.hasPrefix("https://avatars.githubusercontent.com/u/7") { return (200, "image/png", png) }
            if url.contains(AvatarSource.hash("gravatar@vd.vn")) { return (200, "image/jpeg", png) }
            return (404, "text/html", Data())
        }
        let fetcher = AvatarFetcher(cacheDirectory: cache, transport: server.transport)

        // Qua API commit của repo GitHub.
        #expect(await fetcher.avatar(email: "co@vd.vn", repo: repo, size: 80) == png)
        // GitHub không biết email này → Gravatar.
        #expect(await fetcher.avatar(email: "gravatar@vd.vn", repo: repo, size: 80) == png)
        // Không ai có ảnh → nil, và nhớ "không có".
        #expect(await fetcher.avatar(email: "khong-co@vd.vn", repo: repo, size: 80) == nil)
        let requestsBefore = server.requestCount
        #expect(await fetcher.avatar(email: "co@vd.vn", repo: repo, size: 80) == png)
        #expect(await fetcher.avatar(email: "khong-co@vd.vn", repo: repo, size: 80) == nil)
        #expect(server.requestCount == requestsBefore, "Lần hai phải lấy từ cache trên đĩa")
    }

    @Test func networkErrorsAreNotRememberedAndRateLimitSkipsGitHub() async throws {
        let cache = FileManager.default.temporaryDirectory.appendingPathComponent("nhanh-avatars-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: cache) }
        let repo = GitHubRepoRef(owner: "o", name: "r")
        let server = FakeHTTP { request in
            if request.url!.host == "api.github.com" { return (403, "application/json", Data("{}".utf8)) }
            return (500, "text/html", Data())
        }
        let fetcher = AvatarFetcher(cacheDirectory: cache, transport: server.transport)
        #expect(await fetcher.avatar(email: "a@vd.vn", repo: repo, size: 80) == nil)
        #expect(server.requests(host: "api.github.com") == 1)

        // Hết lượt API: không hỏi GitHub nữa; lỗi 500 không bị nhớ nên lần sau vẫn hỏi Gravatar.
        let png = Data([0x89, 0x50, 0x4E, 0x47])
        server.reset { request in
            if request.url!.host == "api.github.com" { return (200, "application/json", Data("[]".utf8)) }
            return (200, "image/png", png)
        }
        #expect(await fetcher.avatar(email: "a@vd.vn", repo: repo, size: 80) == png)
        #expect(server.requests(host: "api.github.com") == 0)
    }

    /// 401 (token hết hạn / bị thu hồi) là lỗi tạm, không phải "GitHub không có ảnh": không nhớ "không có" trên đĩa,
    /// đăng nhập lại thì tìm được ngay.
    @Test func unauthorizedIsNotRememberedAsMissing() async throws {
        let cache = FileManager.default.temporaryDirectory.appendingPathComponent("nhanh-avatars-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: cache) }
        let png = Data([0x89, 0x50, 0x4E, 0x47, 9])
        let repo = GitHubRepoRef(owner: "cty", name: "app")
        let server = FakeHTTP { request in
            if request.url!.host == "api.github.com" { return (401, "application/json", Data(#"{"message":"Bad credentials"}"#.utf8)) }
            return (404, "text/html", Data())
        }
        #expect(await AvatarFetcher(cacheDirectory: cache, transport: server.transport).avatar(email: "dev@cty.vn", repo: repo, size: 80, token: "het-han") == nil)
        let files = (try? FileManager.default.contentsOfDirectory(atPath: cache.path)) ?? []
        #expect(!files.contains { $0.hasSuffix(".none") }, "\(files)")

        server.reset { request in
            let url = request.url!.absoluteString
            if url.hasPrefix("https://api.github.com/") {
                return (200, "application/json", Data(#"[{"author":{"avatar_url":"https://avatars.githubusercontent.com/u/1?v=4"}}]"#.utf8))
            }
            if url.hasPrefix("https://avatars.githubusercontent.com/") { return (200, "image/png", png) }
            return (404, "text/html", Data())
        }
        #expect(await AvatarFetcher(cacheDirectory: cache, transport: server.transport).avatar(email: "dev@cty.vn", repo: repo, size: 80, token: "moi") == png)
    }

    /// "Không có ảnh" tìm được khi chưa biết repo GitHub (chưa hỏi API GitHub) không được dùng cho lần hỏi có repo GitHub.
    @Test func missingWithoutGitHubDoesNotHideGitHubAvatar() async throws {
        let cache = FileManager.default.temporaryDirectory.appendingPathComponent("nhanh-avatars-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: cache) }
        let png = Data([0x89, 0x50, 0x4E, 0x47, 8])
        let server = FakeHTTP { request in
            let url = request.url!.absoluteString
            if url.hasPrefix("https://api.github.com/") {
                return (200, "application/json", Data(#"[{"author":{"avatar_url":"https://avatars.githubusercontent.com/u/2?v=4"}}]"#.utf8))
            }
            if url.hasPrefix("https://avatars.githubusercontent.com/") { return (200, "image/png", png) }
            return (404, "text/html", Data())
        }
        let fetcher = AvatarFetcher(cacheDirectory: cache, transport: server.transport)
        #expect(await fetcher.avatar(email: "dev@cty.vn", repo: nil, size: 80) == nil)
        // Repo không ở GitHub hỏi lại: vẫn lấy "không có" từ cache, không gửi gì.
        let before = server.requestCount
        #expect(await fetcher.avatar(email: "dev@cty.vn", repo: nil, size: 80) == nil)
        #expect(server.requestCount == before)
        // Repo trên GitHub: phải hỏi API GitHub.
        #expect(await fetcher.avatar(email: "dev@cty.vn", repo: GitHubRepoRef(owner: "cty", name: "app"), size: 80) == png)
    }

    /// Lỗi tạm và "không có ảnh" là hai kết quả khác nhau (app thử lại lỗi tạm sau ít phút).
    @Test func lookupSeparatesMissingFromUnavailable() async throws {
        let cache = FileManager.default.temporaryDirectory.appendingPathComponent("nhanh-avatars-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: cache) }
        let server = FakeHTTP { _ in (503, "text/html", Data()) }
        let fetcher = AvatarFetcher(cacheDirectory: cache, transport: server.transport)
        #expect(await fetcher.lookupAvatar(email: "a@vd.vn", repo: nil, size: 80) == .unavailable)
        server.reset { _ in (404, "text/html", Data()) }
        #expect(await fetcher.lookupAvatar(email: "a@vd.vn", repo: nil, size: 80) == .missing)
        let png = Data([0x89, 0x50, 0x4E, 0x47, 5])
        server.reset { _ in (200, "image/png", png) }
        #expect(await fetcher.lookupAvatar(email: "b@vd.vn", repo: nil, size: 80) == .found(png))
    }

    // MARK: - Hàng đợi trong RAM của app

    /// Tắt "Ảnh đại diện thật": bỏ hết yêu cầu đang chờ — không việc nào bắt đầu sau đó.
    @Test func disablingDropsQueuedRequests() {
        var queue = AvatarQueue(maxConcurrent: 2)
        for index in 0..<10 { queue.enqueue("k\(index)", AvatarRequest(email: "\(index)@vd.vn", repo: nil)) }
        #expect(queue.next()?.key == "k9")
        #expect(queue.next()?.key == "k8")
        #expect(queue.next() == nil) // đủ 2 việc đang chạy
        queue.removeAllQueued()
        queue.finish("k9", .found)
        queue.finish("k8", .found)
        #expect(queue.next() == nil)
        #expect(queue.queuedCount == 0 && queue.inFlightCount == 0)
    }

    /// Lỗi tạm không bị nhớ thành "không có ảnh": hỏi lại sau `retryInterval` thì tải lại; "không có ảnh" thì không hỏi lại.
    @Test func unavailableIsRetriedLaterButMissingIsNot() {
        var queue = AvatarQueue(maxConcurrent: 4, retryInterval: 300)
        let start = Date(timeIntervalSince1970: 1_000_000)
        let request = AvatarRequest(email: "a@vd.vn", repo: nil)
        queue.enqueue("loi-tam", request, now: start)
        queue.enqueue("khong-co", request, now: start)
        #expect(queue.next()?.key == "khong-co")
        #expect(queue.next()?.key == "loi-tam")
        queue.finish("loi-tam", .unavailable, now: start)
        queue.finish("khong-co", .missing, now: start)

        queue.enqueue("loi-tam", request, now: start.addingTimeInterval(60))
        queue.enqueue("khong-co", request, now: start.addingTimeInterval(60))
        #expect(queue.next() == nil)
        queue.enqueue("loi-tam", request, now: start.addingTimeInterval(301))
        queue.enqueue("khong-co", request, now: start.addingTimeInterval(301))
        #expect(queue.next()?.key == "loi-tam")
        #expect(queue.next() == nil)
    }

    /// Hàng đợi có giới hạn: cuộn qua hàng nghìn dòng chỉ giữ các yêu cầu mới nhất; hỏi lại một khoá đưa nó lên đầu,
    /// yêu cầu có repo GitHub thắng yêu cầu không có repo.
    @Test func queueIsBoundedAndLatestFirst() {
        var queue = AvatarQueue(maxConcurrent: 1, maxQueued: 100)
        let repo = GitHubRepoRef(owner: "o", name: "r")
        for index in 0..<5000 {
            queue.enqueue("k\(index)", AvatarRequest(email: "\(index)@vd.vn", repo: nil))
            // Vẽ lại nhiều lần cùng một dòng (graph gọi mỗi lần vẽ).
            queue.enqueue("k\(index)", AvatarRequest(email: "\(index)@vd.vn", repo: index == 4999 ? repo : nil))
        }
        #expect(queue.queuedCount <= 100)
        queue.enqueue("k4990", AvatarRequest(email: "4990@vd.vn", repo: nil))
        let first = queue.next()
        #expect(first?.key == "k4990")
        queue.finish("k4990", .found)
        let second = queue.next()
        #expect(second?.key == "k4999" && second?.request.repo == repo)
    }
}

/// Máy chủ HTTP giả của riêng một test (không URLProtocol, không biến tĩnh dùng chung): trả lời theo `handler`, ghi lại
/// mọi request. Không bao giờ gọi mạng thật.
final class FakeHTTP: Sendable {
    typealias Handler = @Sendable (URLRequest) -> (status: Int, mime: String, body: Data)

    private let state: LockedBox<(handler: Handler, requests: [URLRequest])>

    init(_ handler: @escaping Handler) {
        state = LockedBox((handler, []))
    }

    /// Đổi cách trả lời (giữa chừng test) và xoá danh sách request đã ghi.
    func reset(_ handler: @escaping Handler) {
        state.withValue { $0 = (handler, []) }
    }

    var requestCount: Int { state.current.requests.count }

    func requests(host: String) -> Int {
        state.current.requests.filter { $0.url?.host == host }.count
    }

    var transport: GitHubHTTPTransport {
        { [state] request in
            let handler = state.withValue { current -> Handler in
                current.requests.append(request)
                return current.handler
            }
            let (status, mime, body) = handler(request)
            guard let url = request.url,
                  let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": mime])
            else { throw URLError(.badURL) }
            return (body, response)
        }
    }
}
