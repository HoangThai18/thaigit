import Foundation

/// Người dùng trên GitHub / GitLab có thể được gán vào Pull Request / Merge Request.
/// So sánh theo tên đăng nhập (không phân biệt hoa thường): danh sách từ PR và danh sách thành viên có thể khác ở phần tên hiển thị.
public struct ForgePerson: Sendable, Hashable, Identifiable {
    public let username: String
    public let name: String?
    /// GitLab gán người theo số id; GitHub gán theo tên đăng nhập (nil).
    public let gitlabID: Int?

    public init(username: String, name: String? = nil, gitlabID: Int? = nil) {
        self.username = username
        self.name = name
        self.gitlabID = gitlabID
    }

    public var id: String { username.lowercased() }

    /// Tên đầy đủ nếu có, không thì tên đăng nhập.
    public var displayName: String {
        guard let name, !name.isEmpty else { return username }
        return name
    }

    public static func == (lhs: ForgePerson, rhs: ForgePerson) -> Bool {
        lhs.id == rhs.id
    }

    public func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }
}

/// Pull Request (GitHub) hoặc Merge Request (GitLab) để hiện ở panel review — gộp hai kiểu cho giao diện dùng chung.
public struct ForgeRequest: Sendable, Equatable, Identifiable {
    public enum Kind: Sendable, Equatable {
        case github
        case gitlab
    }

    public let kind: Kind
    /// Số của PR (GitHub) hoặc `iid` của MR (GitLab).
    public let number: Int
    public let title: String
    public let body: String
    public let author: String
    public let isDraft: Bool
    public let webURL: URL?
    public let sourceBranch: String
    public let targetBranch: String
    public let headSHA: String?
    public let updatedAt: Date?
    /// Người được gán xử lý.
    public var assignees: [ForgePerson]
    /// Người được nhờ review.
    public var reviewers: [ForgePerson]

    public init(kind: Kind, number: Int, title: String, body: String, author: String, isDraft: Bool, webURL: URL?,
                sourceBranch: String, targetBranch: String, headSHA: String?, updatedAt: Date?,
                assignees: [ForgePerson] = [], reviewers: [ForgePerson] = []) {
        self.kind = kind
        self.number = number
        self.title = title
        self.body = body
        self.author = author
        self.isDraft = isDraft
        self.webURL = webURL
        self.sourceBranch = sourceBranch
        self.targetBranch = targetBranch
        self.headSHA = headSHA
        self.updatedAt = updatedAt
        self.assignees = assignees
        self.reviewers = reviewers
    }

    public var id: Int { number }

    /// "#12" (GitHub) hoặc "!12" (GitLab).
    public var reference: String {
        (kind == .github ? "#" : "!") + String(number)
    }

    /// "Pull Request" hoặc "Merge Request".
    public var kindName: String {
        kind == .github ? "Pull Request" : "Merge Request"
    }

    /// Tên máy chủ: "GitHub" hoặc "GitLab".
    public var siteName: String {
        kind == .github ? "GitHub" : "GitLab"
    }

    /// Cách lấy PR / MR và nhánh đích về máy để review: các refspec cho một lần fetch và hai ref nhận về.
    /// GitHub giữ đầu PR ở `refs/pull/N/head`, GitLab ở `refs/merge-requests/N/head` — kể cả PR / MR từ fork — nên không cần
    /// biết nhánh nguồn nằm ở đâu. Đầu PR / MR lưu ở `refs/thaigit/review/…` (không phải `refs/remotes/…`) để không lẫn vào danh
    /// sách nhánh remote và không bị `fetch --prune` dọn; nhánh đích là ref remote-tracking thật (`refs/remotes/<remote>/<nhánh>`,
    /// cũng chính là thứ `git fetch` thường cập nhật). Tên nhánh đích do máy chủ trả về: tên lạ thì không dựng (nil), không đưa
    /// vào lệnh git.
    public func reviewRefs(remote: String) -> ReviewRefs? {
        guard Self.isSafeBranchName(targetBranch), Self.isSafeBranchName(remote) else { return nil }
        let headRef: String
        let headSpec: String
        switch kind {
        case .github:
            headRef = "refs/thaigit/review/\(remote)/pr/\(number)"
            headSpec = "+refs/pull/\(number)/head:\(headRef)"
        case .gitlab:
            headRef = "refs/thaigit/review/\(remote)/mr/\(number)"
            headSpec = "+refs/merge-requests/\(number)/head:\(headRef)"
        }
        let baseRef = "refs/remotes/\(remote)/\(targetBranch)"
        let baseSpec = "+refs/heads/\(targetBranch):\(baseRef)"
        return ReviewRefs(refspecs: [headSpec, baseSpec], headRef: headRef, baseRef: baseRef)
    }

    /// Tên nhánh / remote an toàn để ghép vào refspec: không rỗng, không bắt đầu bằng "-", không có khoảng trắng, ký tự điều
    /// khiển hay `~ ^ : ? * [ \`, không có "..", "@{", "//", không kết thúc bằng "/", "." hay ".lock".
    public static func isSafeBranchName(_ name: String) -> Bool {
        guard !name.isEmpty, !name.hasPrefix("-"), !name.hasPrefix("/"), !name.hasSuffix("/"), !name.hasSuffix("."),
              !name.hasSuffix(".lock"), !name.contains(".."), !name.contains("@{"), !name.contains("//") else { return false }
        let forbidden = Set<Character>(["~", "^", ":", "?", "*", "[", "\\", " "])
        for character in name {
            if forbidden.contains(character) { return false }
            guard let scalar = character.unicodeScalars.first, scalar.value >= 0x20, scalar.value != 0x7f else { return false }
        }
        return true
    }
}

/// Refspec và ref để review một PR / MR (xem `ForgeRequest.reviewRefs`).
public struct ReviewRefs: Sendable, Equatable {
    public let refspecs: [String]
    /// Ref đầu của PR / MR sau khi fetch.
    public let headRef: String
    /// Ref nhánh đích sau khi fetch.
    public let baseRef: String
}

/// Lỗi khi gán người review / người xử lý. Câu `userMessage` do Thaigit soạn, không chèn nội dung phản hồi của máy chủ.
public enum ForgeReviewError: Error, Equatable, UserFacingError {
    /// Tài khoản không đủ quyền gán người ở repo / project này.
    case noPermission
    /// GitHub không cho nhờ chính tác giả PR review.
    case authorCannotReview
    /// GitHub chỉ cho nhờ review người đã là cộng tác viên của repo.
    case notCollaborator
    /// Máy chủ không nhận thay đổi (lý do khác).
    case rejected

    public var userMessage: String {
        switch self {
        case .noPermission:
            return String(localized: "Tài khoản này chưa đủ quyền gán người cho PR / MR ở đây — cần quyền ghi (GitHub) hoặc Developer trở lên (GitLab).")
        case .authorCannotReview:
            return String(localized: "Không nhờ chính tác giả review được.")
        case .notCollaborator:
            return String(localized: "Người này chưa phải cộng tác viên của repo nên chưa nhờ review được.")
        case .rejected:
            return String(localized: "Máy chủ không nhận thay đổi người review / người được gán — thử lại hoặc làm trên web.")
        }
    }
}

extension GitHubPullRequest {
    /// Dạng dùng chung cho panel review.
    public var forgeRequest: ForgeRequest {
        ForgeRequest(kind: .github, number: number, title: title, body: body ?? "", author: author, isDraft: isDraft,
                     webURL: webURL, sourceBranch: headBranch, targetBranch: baseBranch, headSHA: headSHA, updatedAt: updatedAt,
                     assignees: assignees.map { ForgePerson(username: $0) },
                     reviewers: reviewers.map { ForgePerson(username: $0) })
    }
}
