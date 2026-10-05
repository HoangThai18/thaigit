import CoreServices
import Foundation

/// Watches a repository for file changes using FSEvents (so edits made in another editor, a commit from a
/// terminal… are noticed).
public final class RepoWatcher: @unchecked Sendable {
    public struct Change: Sendable, OptionSet {
        public let rawValue: Int
        public init(rawValue: Int) { self.rawValue = rawValue }

        /// A file in the working tree or the index changed.
        public static let workingTree = Change(rawValue: 1 << 0)
        /// HEAD, refs, packed-refs, or the merge/rebase state changed.
        public static let refs = Change(rawValue: 1 << 1)
    }

    private let root: String
    private let gitDir: String
    private let commonDir: String
    private let handler: @Sendable (Change) -> Void
    private let queue = DispatchQueue(label: "nhanh.repo-watcher", qos: .utility)
    private let lock = NSLock()
    private var stream: FSEventStreamRef?

    public init(root: URL, gitDir: URL, commonDir: URL, handler: @escaping @Sendable (Change) -> Void) {
        self.root = Self.canonicalPath(root)
        self.gitDir = Self.canonicalPath(gitDir)
        self.commonDir = Self.canonicalPath(commonDir)
        self.handler = handler
    }

    deinit {
        stop()
    }

    public func start() {
        lock.lock()
        defer { lock.unlock() }
        guard stream == nil else { return }

        var paths = [root]
        for dir in [gitDir, commonDir] where !dir.hasPrefix(root + "/") && !paths.contains(dir) {
            paths.append(dir)
        }

        var context = FSEventStreamContext(
            version: 0,
            info: Unmanaged.passUnretained(self).toOpaque(),
            retain: nil,
            release: nil,
            copyDescription: nil
        )
        let callback: FSEventStreamCallback = { _, info, count, eventPaths, _, _ in
            guard let info else { return }
            let watcher = Unmanaged<RepoWatcher>.fromOpaque(info).takeUnretainedValue()
            let array = Unmanaged<CFArray>.fromOpaque(eventPaths).takeUnretainedValue()
            guard let paths = array as? [String] else { return }
            watcher.process(paths: Array(paths.prefix(count)))
        }
        let flags = FSEventStreamCreateFlags(
            kFSEventStreamCreateFlagUseCFTypes | kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagNoDefer
        )
        guard let created = FSEventStreamCreate(
            kCFAllocatorDefault, callback, &context, paths as CFArray,
            FSEventStreamEventId(kFSEventStreamEventIdSinceNow), 0.25, flags
        ) else { return }
        FSEventStreamSetDispatchQueue(created, queue)
        FSEventStreamStart(created)
        stream = created
    }

    public func stop() {
        lock.lock()
        defer { lock.unlock() }
        guard let stream else { return }
        FSEventStreamStop(stream)
        FSEventStreamInvalidate(stream)
        FSEventStreamRelease(stream)
        self.stream = nil
    }

    private func process(paths: [String]) {
        var change: Change = []
        for path in paths {
            if let relative = Self.relative(path, to: gitDir) ?? Self.relative(path, to: commonDir) {
                change.formUnion(Self.classifyGitPath(relative))
            } else if Self.relative(path, to: root) != nil {
                change.insert(.workingTree)
            }
            if change == [.workingTree, .refs] { break }
        }
        if !change.isEmpty { handler(change) }
    }

    /// The real path, matching how FSEvents reports it. `URL.resolvingSymlinksInPath` is not used because
    /// it strips "/private" (/private/tmp → /tmp) and would stop matching the events.
    static func canonicalPath(_ url: URL) -> String {
        guard let resolved = realpath(url.path, nil) else { return url.standardizedFileURL.path }
        defer { free(resolved) }
        return String(cString: resolved)
    }

    /// macOS disks are case-insensitive by default, so prefix matching ignores case.
    static func relative(_ path: String, to base: String) -> String? {
        if path.compare(base, options: .caseInsensitive) == .orderedSame { return "" }
        guard let range = path.range(of: base + "/", options: [.anchored, .caseInsensitive]) else { return nil }
        return String(path[range.upperBound...])
    }

    /// Classifies a change inside the .git directory.
    static func classifyGitPath(_ relative: String) -> Change {
        if relative.isEmpty { return [] }
        let ignoredPrefixes = ["objects/", "logs/", "lfs/", "hooks/", "info/", "modules/", "fsmonitor", "gc.", "FETCH_HEAD", "ORIG_HEAD.lock"]
        if ignoredPrefixes.contains(where: { relative.hasPrefix($0) }) { return [] }
        if relative.hasSuffix(".lock") { return [] }
        // The app's own snapshots (including those of another worktree visible through the common dir) are not user changes.
        let snapshotRefs = SnapshotSpec.refDirectory
        if relative.hasPrefix(snapshotRefs) || relative.contains("/" + snapshotRefs) { return [] }
        if relative == "index" { return .workingTree }
        if relative == "HEAD" || relative == "packed-refs" || relative.hasPrefix("refs/")
            || relative.hasPrefix("rebase-") || relative.hasSuffix("_HEAD") || relative.hasPrefix("sequencer")
            || relative == "BISECT_LOG" || relative.hasPrefix("worktrees/") {
            return [.refs, .workingTree]
        }
        return []
    }
}
