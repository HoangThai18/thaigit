import AppKit
import NhanhCore
import SwiftUI

/// Thứ đang được chọn trên graph.
enum RepoSelection: Hashable {
    case none
    case workingTree
    case commit(String)
    case stash(String)
}

/// Nguồn của file đang mở diff.
nonisolated enum DiffSource: Hashable, Sendable {
    case commit(String)
    case stash(String)
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

/// Ảnh trước/sau cho file ảnh nhị phân.
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
    /// Xung đột trong file không phải UTF-8: chỉ chọn cả file một bên hoặc mở editor.
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
    /// Nhóm thông báo để tự ẩn khi không còn đúng (ví dụ "conflict" khi đã hết xung đột).
    var tag: String?

    static func == (lhs: Toast, rhs: Toast) -> Bool { lhs.id == rhs.id }

    var isPersistent: Bool { style == .error || style == .warning }
    /// Thông báo có nút (ví dụ "Hoàn tác") được giữ lâu hơn.
    var lifetime: Double { actions.isEmpty ? 4 : 9 }
}

struct Confirmation: Identifiable {
    let id = UUID()
    var title: String
    var message: String
    var confirmTitle: String
    var isDestructive: Bool = false
    var action: () -> Void
}

struct PushRequest: Identifiable {
    let id = UUID()
    var localBranch: String
    var remote: String
    var remoteBranch: String
    var setUpstream: Bool
    var force: Bool
}

/// Yêu cầu khi kéo một nhánh thả lên nhánh khác hoặc lên một remote (giống GitKraken).
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

/// Nhãn nhánh/tag hiển thị cạnh commit trên graph. Nhánh local và remote cùng tên, cùng commit
/// được gộp thành một nhãn (biểu tượng máy tính + đám mây), giống GitKraken.
struct RefLabel: Hashable, Identifiable {
    var text: String
    var isCurrentBranch = false
    var hasLocal = false
    var remoteCount = 0
    var isTag = false
    var isDetachedHead = false
    var refs: [GitRef] = []

    var id: String { (isTag ? "tag:" : "ref:") + text }

    var localRef: GitRef? { refs.first { $0.kind == .localBranch } }
    var remoteRefs: [GitRef] { refs.filter { $0.kind == .remoteBranch } }
    var tagRef: GitRef? { refs.first { $0.kind == .tag } }
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

/// Mô tả menu chung, dùng cho cả NSMenu (graph) và SwiftUI contextMenu (sidebar).
indirect enum MenuItemSpec {
    case action(String, systemImage: String? = nil, destructive: Bool = false, enabled: Bool = true, handler: () -> Void)
    case submenu(String, systemImage: String? = nil, items: [MenuItemSpec])
    case separator
}
