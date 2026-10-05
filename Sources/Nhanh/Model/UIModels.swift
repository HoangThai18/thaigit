import AppKit
import NhanhCore
import SwiftUI

/// What is selected on the graph.
enum RepoSelection: Hashable {
    case none
    case workingTree
    case commit(String)
    case stash(String)
    /// Comparing two revisions (commit / branch): `from` is the base, `to` the one compared against it.
    case compare(from: String, to: String)
}

/// The result of comparing two revisions: the commits in between and the files that differ.
struct Comparison: Equatable {
    var from: String
    var to: String
    var fromLabel: String
    var toLabel: String
    var files: [FileChange]
    /// Commits in `to` but not in `from`, newest first.
    var commits: [Commit]
}

/// The source of the file whose diff is open.
nonisolated enum DiffSource: Hashable, Sendable {
    case commit(String)
    case stash(String)
    /// The file's diff between the two revisions being compared.
    case compare(from: String, to: String)
    case unstaged
    case staged
    case conflict

    var isWorkingTree: Bool {
        switch self {
        case .unstaged, .staged, .conflict: return true
        default: return false
        }
    }
}

nonisolated struct OpenFile: Hashable, Sendable {
    var source: DiffSource
    var change: FileChange
}

/// Before / after images for a binary image file.
struct ImagePair {
    var before: NSImage?
    var after: NSImage?
}

enum DiffState {
    case idle
    case loading
    case text(DiffPresentation)
    case binary(FileDiff?, ImagePair?)
    case tooLarge(FileDiff)
    case conflict(ConflictFile, ConflictEntry)
    case conflictWithoutMarkers(ConflictEntry)
    /// A conflict in a non-UTF-8 file: only "take the whole file from one side" or open the editor.
    case conflictNotUTF8(ConflictEntry)
    case message(String)
    case failed(String)
}

struct BusyState: Equatable {
    var title: String
    var detail: String = ""
    var fraction: Double?
    var canCancel: Bool = false
}

struct ToastAction: Identifiable {
    let id = UUID()
    let title: String
    let handler: () -> Void
}

struct Toast: Identifiable, Equatable {
    enum Style {
        case info, success, warning, error
    }

    let id = UUID()
    var style: Style
    var title: String
    var message: String?
    var actions: [ToastAction] = []
    /// A notification group, so it auto-dismisses once it stops applying (e.g. "conflict" once there are no conflicts left).
    var tag: String?

    static func == (lhs: Toast, rhs: Toast) -> Bool { lhs.id == rhs.id }

    var isPersistent: Bool { style == .error || style == .warning }
    /// A notification with a button (e.g. "Undo") is kept longer.
    var lifetime: Double { actions.isEmpty ? 4 : 9 }
}

struct Confirmation: Identifiable {
    let id = UUID()
    var title: String
    var message: String
    var confirmTitle: String
    var isDestructive: Bool = false
    var action: () -> Void
    /// A second, non-default button between the confirm button and "Cancel", e.g. "Revert, don't commit".
    var secondaryTitle: String? = nil
    var secondaryAction: (() -> Void)? = nil
}

struct PushRequest: Identifiable {
    let id = UUID()
    var localBranch: String
    var remote: String
    var remoteBranch: String
    var setUpstream: Bool
    var force: Bool
}

/// The prompt shown when a branch is dragged onto another branch or a remote (like GitKraken).
struct DragRequest: Identifiable {
    enum Target {
        case ref(GitRef)
        case remote(Remote)
    }

    let id = UUID()
    var source: GitRef
    var target: Target

    var targetName: String {
        switch target {
        case .ref(let ref): return ref.name
        case .remote(let remote): return remote.name
        }
    }
}

enum RepoSheet: Identifiable {
    case createBranch(startPoint: String, label: String)
    case renameBranch(String)
    case createTag(sha: String, label: String)
    case push(PushRequest)
    case stash
    case identity
    case addRemote
    case commandLog
    case fileHistory(String)
    case switchBranch
    /// Merge a branch from another repository; `target` is the preselected target branch (nil: choose one).
    case mergeFromRepository(target: String?)
    /// Sign in to GitHub (from the suggestion shown when fetch / pull / push was denied for auth reasons).
    case githubLogin
    /// Pick a GitHub account for an owner (nil: the owner of the origin remote — "GitHub account for this repo").
    case githubAccount(owner: String?)
    /// Interactive rebase of the commits after `base` (like GitKraken).
    case interactiveRebase(base: String, label: String)
    /// Edit one commit's message (right-click menu).
    case rewordCommit(sha: String, label: String)
    /// Blame a file; a nil `rev` is the working tree version.
    case blame(path: String, rev: String?)
    /// Create a Pull Request on GitHub from branch `head` (the branch name on the GitHub remote).
    case createPullRequest(head: String)
    /// Turn commit signing on / off (GPG / SSH).
    case commitSigning
    /// Create a new worktree (an existing branch, or a new one).
    case addWorktree
    /// Initialise Git Flow (main / develop branch names, prefixes).
    case gitFlowInit
    /// Start a feature / release / hotfix.
    case gitFlowStart(GitFlowKind)
    /// Track a file pattern with Git LFS.
    case lfsTrack
    /// A GitHub / Jira issue: create a branch, attach it to a commit.
    case issues

    var id: String {
        switch self {
        case .createBranch(let start, _): return "branch-\(start)"
        case .renameBranch(let name): return "rename-\(name)"
        case .createTag(let sha, _): return "tag-\(sha)"
        case .push(let request): return "push-\(request.id)"
        case .stash: return "stash"
        case .identity: return "identity"
        case .addRemote: return "add-remote"
        case .commandLog: return "command-log"
        case .fileHistory(let path): return "history-\(path)"
        case .switchBranch: return "switch-branch"
        case .mergeFromRepository(let target): return "merge-from-repo-\(target ?? "")"
        case .githubLogin: return "github-login"
        case .githubAccount(let owner): return "github-account-\(owner ?? "")"
        case .interactiveRebase(let base, _): return "interactive-rebase-\(base)"
        case .rewordCommit(let sha, _): return "reword-\(sha)"
        case .blame(let path, let rev): return "blame-\(rev ?? "")-\(path)"
        case .createPullRequest(let head): return "create-pr-\(head)"
        case .commitSigning: return "commit-signing"
        case .addWorktree: return "add-worktree"
        case .gitFlowInit: return "git-flow-init"
        case .gitFlowStart(let kind): return "git-flow-start-\(kind.rawValue)"
        case .lfsTrack: return "lfs-track"
        case .issues: return "issues"
        }
    }
}

struct RefreshScope: OptionSet {
    let rawValue: Int
    static let status = RefreshScope(rawValue: 1 << 0)
    static let refs = RefreshScope(rawValue: 1 << 1)
    static let history = RefreshScope(rawValue: 1 << 2)
    static let all: RefreshScope = [.status, .refs, .history]
}

/// A branch / tag label shown next to a commit on the graph. A local and a remote branch with the same name pointing at
/// the same commit are merged into one label (computer + cloud icons), like GitKraken.
struct RefLabel: Hashable, Identifiable {
    var text: String
    var isCurrentBranch = false
    var hasLocal = false
    var remoteCount = 0
    var isTag = false
    var isDetachedHead = false
    var refs: [GitRef] = []
    /// An open Pull Request from this branch (number and title) — draws a PR icon on the label.
    var pullRequest: PullRequestBadge?

    var id: String { (isTag ? "tag:" : "ref:") + text }

    var localRef: GitRef? { refs.first { $0.kind == .localBranch } }
    var remoteRefs: [GitRef] { refs.filter { $0.kind == .remoteBranch } }
    var tagRef: GitRef? { refs.first { $0.kind == .tag } }
}

struct PullRequestBadge: Hashable {
    let number: Int
    let title: String
}

struct GraphEntry: Identifiable {
    let commit: Commit
    let row: GraphRow
    var labels: [RefLabel]

    var id: String { commit.id }
}

struct ScrollRequest: Equatable {
    let id = UUID()
    var row: Int
}

/// A shared menu description, used by both NSMenu (graph) and SwiftUI contextMenu (sidebar).
indirect enum MenuItemSpec {
    case action(String, systemImage: String? = nil, destructive: Bool = false, enabled: Bool = true, handler: () -> Void)
    case submenu(String, systemImage: String? = nil, items: [MenuItemSpec])
    case separator
}
