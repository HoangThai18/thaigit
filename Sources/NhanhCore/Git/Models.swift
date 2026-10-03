import Foundation

public struct Commit: Sendable, Hashable, Identifiable {
    public let id: String
    public let parents: [String]
    public let authorName: String
    public let authorEmail: String
    public let authorDate: Date
    public let committerName: String
    public let committerEmail: String
    public let commitDate: Date
    public let subject: String

    public init(id: String, parents: [String], authorName: String, authorEmail: String, authorDate: Date,
                committerName: String, committerEmail: String, commitDate: Date, subject: String) {
        self.id = id
        self.parents = parents
        self.authorName = authorName
        self.authorEmail = authorEmail
        self.authorDate = authorDate
        self.committerName = committerName
        self.committerEmail = committerEmail
        self.commitDate = commitDate
        self.subject = subject
    }

    public var sha: String { id }
    public var shortSHA: String { String(id.prefix(7)) }
    public var isMerge: Bool { parents.count > 1 }

    /// Commit giả đại diện cho thay đổi chưa commit (node "WIP" trên graph).
    public static let workingTreeID = "__NHANH_WORKING_TREE__"
    public var isWorkingTree: Bool { id == Self.workingTreeID }

    public static func workingTree(parent: String?) -> Commit {
        Commit(id: workingTreeID, parents: parent.map { [$0] } ?? [], authorName: "", authorEmail: "",
               authorDate: Date(), committerName: "", committerEmail: "", commitDate: Date(), subject: "")
    }
}

public enum RefKind: String, Sendable, Hashable, Codable {
    case localBranch
    case remoteBranch
    case tag
}

public struct GitRef: Sendable, Hashable, Identifiable {
    public let fullName: String
    public let kind: RefKind
    /// Commit mà ref trỏ tới (đã bóc tag annotated).
    public let target: String
    /// Object của chính ref (tag object với annotated tag).
    public let objectName: String
    /// Upstream dạng rút gọn, ví dụ "origin/main".
    public let upstream: String?
    public let ahead: Int
    public let behind: Int
    public let upstreamGone: Bool
    public let isHead: Bool
    /// Ngày commit (hoặc ngày tạo tag annotated) — để xếp "nhánh gần đây".
    public let date: Date?

    public init(fullName: String, kind: RefKind, target: String, objectName: String, upstream: String?,
                ahead: Int, behind: Int, upstreamGone: Bool, isHead: Bool, date: Date? = nil) {
        self.fullName = fullName
        self.kind = kind
        self.target = target
        self.objectName = objectName
        self.upstream = upstream
        self.ahead = ahead
        self.behind = behind
        self.upstreamGone = upstreamGone
        self.isHead = isHead
        self.date = date
    }

    public var id: String { fullName }

    /// "main", "origin/main", "v1.0"
    public var name: String {
        switch kind {
        case .localBranch: return String(fullName.dropFirst("refs/heads/".count))
        case .remoteBranch: return String(fullName.dropFirst("refs/remotes/".count))
        case .tag: return String(fullName.dropFirst("refs/tags/".count))
        }
    }

    public var remoteName: String? {
        guard kind == .remoteBranch else { return nil }
        return name.split(separator: "/", maxSplits: 1).first.map(String.init)
    }

    /// Với nhánh remote "origin/feature/x" trả về "feature/x".
    public var shortBranchName: String {
        guard kind == .remoteBranch else { return name }
        let parts = name.split(separator: "/", maxSplits: 1)
        return parts.count == 2 ? String(parts[1]) : name
    }

    public var isAnnotatedTag: Bool { kind == .tag && objectName != target }
}

public enum HeadState: Sendable, Hashable {
    /// Đang ở một nhánh. `oid == nil` nghĩa là nhánh chưa có commit nào.
    case branch(name: String, oid: String?)
    case detached(oid: String)
    case unknown

    public var oid: String? {
        switch self {
        case .branch(_, let oid): return oid
        case .detached(let oid): return oid
        case .unknown: return nil
        }
    }

    public var branchName: String? {
        if case .branch(let name, _) = self { return name }
        return nil
    }

    public var isDetached: Bool {
        if case .detached = self { return true }
        return false
    }

    public var isUnborn: Bool {
        if case .branch(_, nil) = self { return true }
        return false
    }
}

public struct Stash: Sendable, Hashable, Identifiable {
    public let index: Int
    public let selector: String
    public let sha: String
    public let parents: [String]
    public let date: Date
    public let message: String

    public init(index: Int, selector: String, sha: String, parents: [String], date: Date, message: String) {
        self.index = index
        self.selector = selector
        self.sha = sha
        self.parents = parents
        self.date = date
        self.message = message
    }

    public var id: String { sha }

    /// "On main: tin nhắn" → "tin nhắn". Stash tự đặt tên "WIP on main: abc123 msg" → "WIP trên main: msg"
    /// (giữ chữ WIP để không bị nhầm với tên commit).
    public var displayMessage: String {
        let parts = message.split(separator: ":", maxSplits: 1)
        guard parts.count == 2 else { return message }
        let rest = parts[1].trimmingCharacters(in: .whitespaces)
        if message.hasPrefix("WIP on ") {
            let branch = parts[0].dropFirst("WIP on ".count)
            let words = rest.split(separator: " ", maxSplits: 1)
            let subject = words.count == 2 && words[0].count >= 7 && words[0].allSatisfy(\.isHexDigit) ? String(words[1]) : rest
            return String(localized: "WIP trên \(branch): \(subject)")
        }
        return rest
    }

    /// Nhánh mà stash được tạo ra.
    public var branchName: String? {
        let parts = message.split(separator: ":", maxSplits: 1)
        guard let head = parts.first else { return nil }
        for prefix in ["WIP on ", "On "] where head.hasPrefix(prefix) {
            return String(head.dropFirst(prefix.count))
        }
        return nil
    }
}

public struct Remote: Sendable, Hashable, Identifiable {
    public let name: String
    public let fetchURL: String
    public let pushURL: String

    public init(name: String, fetchURL: String, pushURL: String) {
        self.name = name
        self.fetchURL = fetchURL
        self.pushURL = pushURL
    }

    public var id: String { name }
}

public enum ChangeKind: String, Sendable, Hashable {
    case added, modified, deleted, renamed, copied, typeChanged, untracked, conflicted, unknown

    public init(code: Character) {
        switch code {
        case "A": self = .added
        case "M": self = .modified
        case "D": self = .deleted
        case "R": self = .renamed
        case "C": self = .copied
        case "T": self = .typeChanged
        case "?": self = .untracked
        case "U": self = .conflicted
        default: self = .unknown
        }
    }
}

public struct FileChange: Sendable, Hashable, Identifiable {
    public let path: String
    public let oldPath: String?
    public let kind: ChangeKind

    public init(path: String, oldPath: String? = nil, kind: ChangeKind) {
        self.path = path
        self.oldPath = oldPath
        self.kind = kind
    }

    public var id: String { path }
    public var fileName: String { (path as NSString).lastPathComponent }
    public var directory: String { (path as NSString).deletingLastPathComponent }
    /// Tất cả đường dẫn liên quan (để rename được nhận diện khi diff theo pathspec).
    public var allPaths: [String] {
        if let oldPath, oldPath != path { return [oldPath, path] }
        return [path]
    }
}

public enum ConflictKind: String, Sendable, Hashable {
    case bothModified = "UU"
    case bothAdded = "AA"
    case deletedByUs = "DU"
    case deletedByThem = "UD"
    case addedByUs = "AU"
    case addedByThem = "UA"
    case bothDeleted = "DD"
    case unknown = "??"

    public var description: String {
        switch self {
        case .bothModified: return String(localized: "Cả hai bên đều sửa")
        case .bothAdded: return String(localized: "Cả hai bên đều thêm")
        case .deletedByUs: return String(localized: "Bên hiện tại đã xoá")
        case .deletedByThem: return String(localized: "Bên kia đã xoá")
        case .addedByUs: return String(localized: "Bên hiện tại thêm")
        case .addedByThem: return String(localized: "Bên kia thêm")
        case .bothDeleted: return String(localized: "Cả hai bên đều xoá")
        case .unknown: return String(localized: "Xung đột")
        }
    }

    /// Có tồn tại file kèm dấu xung đột trong working tree không.
    public var hasMarkers: Bool { self == .bothModified || self == .bothAdded }
}

public struct ConflictEntry: Sendable, Hashable, Identifiable {
    public let path: String
    public let kind: ConflictKind

    public init(path: String, kind: ConflictKind) {
        self.path = path
        self.kind = kind
    }

    public var id: String { path }
    public var asChange: FileChange { FileChange(path: path, kind: .conflicted) }
}

public struct WorkingTreeStatus: Sendable, Equatable {
    public var head: HeadState
    public var upstream: String?
    public var ahead: Int
    public var behind: Int
    public var staged: [FileChange]
    public var unstaged: [FileChange]
    public var conflicts: [ConflictEntry]
    public var stashCount: Int

    public init(head: HeadState, upstream: String?, ahead: Int, behind: Int, staged: [FileChange],
                unstaged: [FileChange], conflicts: [ConflictEntry], stashCount: Int) {
        self.head = head
        self.upstream = upstream
        self.ahead = ahead
        self.behind = behind
        self.staged = staged
        self.unstaged = unstaged
        self.conflicts = conflicts
        self.stashCount = stashCount
    }

    public static let empty = WorkingTreeStatus(head: .unknown, upstream: nil, ahead: 0, behind: 0,
                                                staged: [], unstaged: [], conflicts: [], stashCount: 0)

    public var isClean: Bool { staged.isEmpty && unstaged.isEmpty && conflicts.isEmpty }
    /// Số file khác nhau có thay đổi.
    public var changedFileCount: Int {
        Set(staged.map(\.path) + unstaged.map(\.path) + conflicts.map(\.path)).count
    }
}

public enum RepoOperation: Sendable, Equatable {
    case merging
    case rebasing(step: Int?, total: Int?, headName: String?)
    case cherryPicking
    case reverting
    case applyingPatches
    case bisecting

    public var title: String {
        switch self {
        case .merging: return String(localized: "Đang merge")
        case .rebasing(let step, let total, _):
            if let step, let total { return String(localized: "Đang rebase (\(step)/\(total))") }
            return String(localized: "Đang rebase")
        case .cherryPicking: return String(localized: "Đang cherry-pick")
        case .reverting: return String(localized: "Đang revert")
        case .applyingPatches: return String(localized: "Đang áp dụng patch (git am)")
        case .bisecting: return String(localized: "Đang bisect")
        }
    }

    /// Tên ngắn để ghép câu: "Huỷ merge", "Tiếp tục rebase"…
    public var shortName: String {
        switch self {
        case .merging: return "merge"
        case .rebasing: return "rebase"
        case .cherryPicking: return "cherry-pick"
        case .reverting: return "revert"
        case .applyingPatches: return String(localized: "áp dụng patch")
        case .bisecting: return "bisect"
        }
    }

    public var canContinue: Bool { self != .bisecting }
    public var canSkip: Bool {
        switch self {
        case .rebasing, .cherryPicking, .reverting, .applyingPatches: return true
        default: return false
        }
    }
}

public struct CommitDetails: Sendable, Equatable {
    public let commit: Commit
    public let message: String
    public let files: [FileChange]

    public init(commit: Commit, message: String, files: [FileChange]) {
        self.commit = commit
        self.message = message
        self.files = files
    }

    /// Phần thân message (bỏ dòng tóm tắt đầu tiên).
    public var body: String {
        let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let newline = trimmed.firstIndex(of: "\n") else { return "" }
        return trimmed[newline...].trimmingCharacters(in: .whitespacesAndNewlines)
    }

    public var summary: String {
        let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.split(separator: "\n", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? commit.subject
    }
}

public enum ResetMode: String, Sendable, CaseIterable {
    case soft, mixed, hard
}

public enum PullMode: String, Sendable, CaseIterable, Codable {
    /// Fast-forward nếu được, không thì tạo merge commit.
    case merge
    case rebase
    case fastForwardOnly
}

public enum LogOrder: String, Sendable, CaseIterable, Codable {
    case date
    case topo
}
