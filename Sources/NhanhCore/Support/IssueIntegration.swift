import Foundation

/// Gợi ý tên nhánh từ issue: "PROJ-12 Sửa lỗi đăng nhập" → "PROJ-12-sua-loi-dang-nhap".
public enum BranchNameSuggester {
    /// Bỏ dấu tiếng Việt, chữ thường, ký tự lạ thành "-", tối đa `maxLength` ký tự (không cắt giữa chữ nếu tránh được).
    public static func slug(_ text: String, maxLength: Int = 40) -> String {
        let folded = text.replacingOccurrences(of: "đ", with: "d").replacingOccurrences(of: "Đ", with: "D")
            .folding(options: [.diacriticInsensitive, .caseInsensitive, .widthInsensitive], locale: Locale(identifier: "en_US_POSIX"))
            .lowercased()
        var result = ""
        var lastWasDash = true
        for scalar in folded.unicodeScalars {
            if ("a"..."z").contains(scalar) || ("0"..."9").contains(scalar) {
                result.unicodeScalars.append(scalar)
                lastWasDash = false
            } else if !lastWasDash {
                result.append("-")
                lastWasDash = true
            }
        }
        while result.hasSuffix("-") { result.removeLast() }
        if result.count > maxLength {
            var cut = String(result.prefix(maxLength))
            if let dash = cut.lastIndex(of: "-"), cut.distance(from: cut.startIndex, to: dash) > maxLength / 2 { cut = String(cut[..<dash]) }
            result = cut
        }
        return result
    }

    public static func branchName(key: String, title: String) -> String {
        let slug = slug(title)
        return slug.isEmpty ? key : "\(key)-\(slug)"
    }
}

/// Issue trên Jira Cloud (giao cho mình, chưa xong).
public struct JiraIssue: Sendable, Equatable, Identifiable {
    public let key: String
    public let summary: String
    public let status: String
    public let type: String
    public var id: String { key }

    public init(key: String, summary: String, status: String, type: String) {
        self.key = key
        self.summary = summary
        self.status = status
        self.type = type
    }
}

public enum JiraError: LocalizedError, Equatable, Sendable {
    case invalidSite
    case unauthorized
    case badResponse(Int)
    case invalidResponse
    case network(String)

    public var errorDescription: String? {
        switch self {
        case .invalidSite: return String(localized: "Địa chỉ Jira phải là https://…, ví dụ https://cong-ty.atlassian.net")
        case .unauthorized: return String(localized: "Jira từ chối email / API token — kiểm tra lại hoặc tạo token mới.")
        case .badResponse(let status): return String(localized: "Jira trả về lỗi \(status).")
        case .invalidResponse: return String(localized: "Phản hồi của Jira không đúng định dạng.")
        case .network(let detail): return String(localized: "Không kết nối được tới Jira: \(detail)")
        }
    }
}

/// Gọi REST API của Jira Cloud bằng email + API token (Basic auth). Token chỉ gửi tới đúng host https đã cấu hình;
/// không theo chuyển hướng (redirect) sang host khác.
public struct JiraClient: Sendable {
    public let site: URL
    private let email: String
    private let token: String
    private let transport: GitHubHTTPTransport

    public init(site: String, email: String, token: String, transport: GitHubHTTPTransport? = nil) throws {
        guard let url = Self.normalizedSite(site) else { throw JiraError.invalidSite }
        self.site = url
        self.email = email.trimmingCharacters(in: .whitespacesAndNewlines)
        self.token = token.trimmingCharacters(in: .whitespacesAndNewlines)
        self.transport = transport ?? JiraClient.noRedirectTransport(host: url.host ?? "")
    }

    /// "cong-ty.atlassian.net" / "https://cong-ty.atlassian.net/jira/…" → "https://cong-ty.atlassian.net".
    public static func normalizedSite(_ text: String) -> URL? {
        var trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.contains("://") { trimmed = "https://" + trimmed }
        guard let components = URLComponents(string: trimmed), components.scheme?.lowercased() == "https",
              let host = components.host?.lowercased(), host.contains("."), components.user == nil else { return nil }
        var clean = URLComponents()
        clean.scheme = "https"
        clean.host = host
        clean.port = components.port
        return clean.url
    }

    /// Tên hiển thị của tài khoản (kiểm tra kết nối).
    public func myself() async throws -> String {
        struct Me: Decodable { let displayName: String? ; let emailAddress: String? }
        let data = try await get("/rest/api/3/myself", query: [])
        guard let me = try? JSONDecoder().decode(Me.self, from: data) else { throw JiraError.invalidResponse }
        return me.displayName ?? me.emailAddress ?? email
    }

    /// Issue giao cho mình, chưa xong, mới cập nhật trước.
    public func myOpenIssues(limit: Int = 50) async throws -> [JiraIssue] {
        let data = try await get("/rest/api/3/search/jql", query: [
            URLQueryItem(name: "jql", value: "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC"),
            URLQueryItem(name: "fields", value: "summary,status,issuetype"),
            URLQueryItem(name: "maxResults", value: String(limit)),
        ])
        struct Page: Decodable {
            struct Issue: Decodable {
                struct Fields: Decodable {
                    struct Named: Decodable { let name: String? }
                    let summary: String?
                    let status: Named?
                    let issuetype: Named?
                }
                let key: String
                let fields: Fields?
            }
            let issues: [Issue]
        }
        guard let page = try? JSONDecoder().decode(Page.self, from: data) else { throw JiraError.invalidResponse }
        return page.issues.map {
            JiraIssue(key: $0.key, summary: $0.fields?.summary ?? "", status: $0.fields?.status?.name ?? "",
                      type: $0.fields?.issuetype?.name ?? "")
        }
    }

    /// Trang của issue trên Jira.
    public func browseURL(_ key: String) -> URL {
        site.appendingPathComponent("browse").appendingPathComponent(key)
    }

    private func get(_ path: String, query: [URLQueryItem]) async throws -> Data {
        var components = URLComponents(url: site, resolvingAgainstBaseURL: false)
        components?.path = path
        if !query.isEmpty { components?.queryItems = query }
        guard let url = components?.url, url.host == site.host, url.scheme == "https" else { throw JiraError.invalidSite }
        var request = URLRequest(url: url, timeoutInterval: 20)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Basic " + Data("\(email):\(token)".utf8).base64EncodedString(), forHTTPHeaderField: "Authorization")
        request.setValue("Thaigit", forHTTPHeaderField: "User-Agent")
        let data: Data
        let response: HTTPURLResponse
        do {
            (data, response) = try await transport(request)
        } catch let error as JiraError {
            throw error
        } catch {
            if error is CancellationError { throw error }
            throw JiraError.network(error.localizedDescription)
        }
        switch response.statusCode {
        case 200..<300: return data
        case 401, 403: throw JiraError.unauthorized
        default: throw JiraError.badResponse(response.statusCode)
        }
    }

    /// Phiên mạng tạm, chặn mọi chuyển hướng (không để header Authorization đi theo sang chỗ khác).
    static func noRedirectTransport(host: String) -> GitHubHTTPTransport {
        let delegate = NoRedirectDelegate()
        let session = URLSession(configuration: .ephemeral, delegate: delegate, delegateQueue: nil)
        return { request in
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw JiraError.invalidResponse }
            return (data, http)
        }
    }
}

private final class NoRedirectDelegate: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest) async -> URLRequest? {
        nil
    }
}

/// Dựng lời nhắc cho AI viết commit message từ thay đổi đã stage.
public enum CommitPrompt {
    /// Giới hạn ký tự của phần diff (model trên máy có cửa sổ ngữ cảnh nhỏ).
    public static let maxPatchCharacters = 6000

    public static func build(stat: String, patch: String, recentSubjects: [String]) -> String {
        // Chữ riêng của tiếng Việt (ă â đ ê ô ơ ư và các chữ có dấu thanh U+1EA0–U+1EF9), không tính chữ có dấu của
        // tiếng Pháp / Đức…
        let vietnameseLetters = Set("ăâđêôơưĂÂĐÊÔƠƯ".unicodeScalars.map(\.value))
        let vietnamese = recentSubjects.contains { subject in
            subject.unicodeScalars.contains { vietnameseLetters.contains($0.value) || (0x1EA0...0x1EF9).contains($0.value) }
        }
        var patchText = patch
        if patchText.count > maxPatchCharacters {
            patchText = String(patchText.prefix(maxPatchCharacters)) + "\n… (đã cắt bớt phần còn lại của diff)"
        }
        var lines: [String] = []
        lines.append(vietnamese
            ? "Viết commit message bằng tiếng Việt cho các thay đổi dưới đây."
            : "Write a git commit message for the changes below.")
        lines.append("""
        Dòng đầu: tóm tắt ngắn gọn (dưới 72 ký tự, không dấu chấm cuối) nói thay đổi làm gì. \
        Sau đó một dòng trống, rồi 0–5 gạch đầu dòng "- " giải thích ý chính nếu cần. \
        Chỉ trả về commit message, không giải thích thêm, không bọc trong ```.
        """)
        if !recentSubjects.isEmpty {
            lines.append("Các commit gần đây của repo (theo phong cách này):")
            lines += recentSubjects.prefix(8).map { "- \($0)" }
        }
        lines.append("Thống kê thay đổi:")
        lines.append(stat.trimmingCharacters(in: .whitespacesAndNewlines))
        lines.append("Diff:")
        lines.append(patchText)
        return lines.joined(separator: "\n")
    }

    /// Tách câu trả lời thành (tóm tắt, phần thân); bỏ ``` và dòng tiêu đề kiểu "Commit message:".
    public static func parse(_ response: String) -> (summary: String, body: String) {
        var lines = response.replacingOccurrences(of: "\r\n", with: "\n").split(separator: "\n", omittingEmptySubsequences: false)
            .map(String.init)
            .filter { !$0.trimmingCharacters(in: .whitespaces).hasPrefix("```") }
        while let first = lines.first, first.trimmingCharacters(in: .whitespaces).isEmpty { lines.removeFirst() }
        guard var summary = lines.first?.trimmingCharacters(in: .whitespaces) else { return ("", "") }
        for label in ["commit message:", "message:", "tóm tắt:"] where summary.lowercased().hasPrefix(label) {
            summary = String(summary.dropFirst(label.count)).trimmingCharacters(in: .whitespaces)
        }
        if summary.hasSuffix("."), !summary.hasSuffix("...") { summary.removeLast() }
        let body = lines.dropFirst().joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        return (summary, body)
    }
}

extension GitRepository {
    /// Thống kê và patch của thay đổi đã stage (byte thật, không chạy textconv / external diff của repo).
    public func stagedChangesForPrompt() async throws -> (stat: String, patch: String) {
        let common = ["--cached", "--no-color", "--no-ext-diff", "--no-textconv"]
        async let stat = runner.output(["diff"] + common + ["--stat=100"])
        async let patch = runner.output(["diff"] + common + ["-U2"])
        return (try await stat, try await patch)
    }

    /// Tóm tắt các commit gần nhất của HEAD (để AI viết theo đúng phong cách / ngôn ngữ của repo).
    public func recentSubjects(_ count: Int = 8) async -> [String] {
        guard let output = try? await runner.output(["log", "-\(count)", "--format=%s", "HEAD", "--"]) else { return [] }
        return output.split(separator: "\n").map(String.init)
    }
}
