import Foundation

/// A GitHub / GitLab user that can be assigned to a Pull Request / Merge Request.
/// Compared by login (case-insensitive): the PR's list and the member list can differ in their display names.
public struct ForgePerson: Sendable, Hashable, Identifiable {
    public let username: String
    public let name: String?
    /// GitLab assigns by numeric id; GitHub assigns by login (nil).
    public let gitlabID: Int?

    public init(username: String, name: String? = nil, gitlabID: Int? = nil) {
        self.username = username
        self.name = name
        self.gitlabID = gitlabID
    }

    public var id: String { username.lowercased() }

    /// Full name when available, otherwise the login.
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

/// A Pull Request (GitHub) or Merge Request (GitLab) as shown in the review panel — both kinds unified for a shared UI.
public struct ForgeRequest: Sendable, Equatable, Identifiable {
    public enum Kind: Sendable, Equatable {
        case github
        case gitlab
    }

    public let kind: Kind
    /// The PR number (GitHub) or the MR `iid` (GitLab).
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
    /// The assignee.
    public var assignees: [ForgePerson]
    /// The requested reviewers.
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

    /// "#12" (GitHub) or "!12" (GitLab).
    public var reference: String {
        (kind == .github ? "#" : "!") + String(number)
    }

    /// "Pull Request" or "Merge Request".
    public var kindName: String {
        kind == .github ? "Pull Request" : "Merge Request"
    }

    /// Host name: "GitHub" or "GitLab".
    public var siteName: String {
        kind == .github ? "GitHub" : "GitLab"
    }

    /// How to fetch a PR / MR and its target branch locally for review: the refspecs for one fetch and the
    /// two refs to fetch into.
    /// GitHub keeps a PR's head at `refs/pull/N/head` and GitLab at `refs/merge-requests/N/head` — even
    /// for forked PR / MR — so the source branch's location never has to be known. The PR / MR head is
    /// stored at `refs/thaigit/review/…` (not `refs/remotes/…`) so it doesn't get mixed into the remote
    /// branch list and isn't pruned by `fetch --prune`; the target branch is a real remote-tracking ref
    /// (`refs/remotes/<remote>/<branch>`), which is exactly what a normal `git fetch` updates. The target
    /// branch name comes from the host: an odd name yields no ref (nil) and never reaches a git command.
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

    /// Whether a branch / remote name is safe to interpolate into a refspec: non-empty, not starting with
    /// "-", no whitespace, control characters or `~ ^ : ? * [ \`, no "..", "@{", "//", and not ending
    /// in "/", "." or ".lock".
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

/// The refspecs and refs used to review a PR / MR (see `ForgeRequest.reviewRefs`).
public struct ReviewRefs: Sendable, Equatable {
    public let refspecs: [String]
    /// The PR / MR head ref after fetching.
    public let headRef: String
    /// The target branch ref after fetching.
    public let baseRef: String
}

/// A failure while assigning reviewers / assignees. Thaigit writes `userMessage`; it never embeds the host's response text.
public enum ForgeReviewError: Error, Equatable, UserFacingError {
    /// The account lacks permission to assign people in this repo / project.
    case noPermission
    /// GitHub won't let a PR's own author review it.
    case authorCannotReview
    /// GitHub only lets you request a review from someone who has already contributed to the repo.
    case notCollaborator
    /// The host rejected the change (other reason).
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
    /// Shared shape for the review panel.
    public var forgeRequest: ForgeRequest {
        ForgeRequest(kind: .github, number: number, title: title, body: body ?? "", author: author, isDraft: isDraft,
                     webURL: webURL, sourceBranch: headBranch, targetBranch: baseBranch, headSHA: headSHA, updatedAt: updatedAt,
                     assignees: assignees.map { ForgePerson(username: $0) },
                     reviewers: reviewers.map { ForgePerson(username: $0) })
    }
}
