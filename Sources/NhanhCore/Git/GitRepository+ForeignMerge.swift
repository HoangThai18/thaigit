import Foundation

/// A branch of another repository, read with `git ls-remote` (no remote has to be added).
public struct ForeignBranches: Sendable, Equatable {
    public var names: [String]
    /// The branch that repo's HEAD points at (the default branch), when readable.
    public var defaultBranch: String?

    public init(names: [String], defaultBranch: String?) {
        self.names = names
        self.defaultBranch = defaultBranch
    }

    /// Parse `git ls-remote --symref <source> HEAD refs/heads/*`: a "ref: refs/heads/main\tHEAD" line gives the
    /// default branch, a "<sha>\trefs/heads/<name>" line is a branch. The "HEAD" pattern also matches
    /// refs/remotes/*/HEAD, so only a literal "HEAD" line is accepted.
    public static func parse(_ text: String) -> ForeignBranches {
        let heads = "refs/heads/"
        var names: [String] = []
        var head: String?
        for line in text.split(separator: "\n") {
            let parts = line.split(separator: "\t", maxSplits: 1)
            guard parts.count == 2 else { continue }
            let name = String(parts[1])
            if parts[0].hasPrefix("ref: ") {
                let target = parts[0].dropFirst("ref: ".count)
                if name == "HEAD", target.hasPrefix(heads) { head = String(target.dropFirst(heads.count)) }
            } else if name.hasPrefix(heads) {
                names.append(String(name.dropFirst(heads.count)))
            }
        }
        return ForeignBranches(names: names, defaultBranch: head.flatMap { names.contains($0) ? $0 : nil })
    }
}

// MARK: - Merging from another repository

extension GitRepository {
    /// A temporary ref holding a branch just fetched from another repository. It sits outside
    /// refs/heads|remotes|tags so it never shows on the graph, and it is deleted right after the merge.
    public static let foreignMergeRef = "refs/thaigit/merge-source"

    /// Normalises the source the user typed: "~/…" and a relative path (resolved against `base`) become an absolute
    /// path when it is a real directory; a URL (https://, ssh://, git@host:…) is left as-is.
    public static func resolveRepositorySource(_ input: String, relativeTo base: URL) -> String {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !trimmed.contains("://") else { return trimmed }
        let expanded = (trimmed as NSString).expandingTildeInPath
        let url = expanded.hasPrefix("/") ? URL(fileURLWithPath: expanded) : base.appendingPathComponent(expanded)
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory), isDirectory.boolValue else { return trimmed }
        return url.standardizedFileURL.path
    }

    /// Strips "user:password@" from a scheme:// URL before it goes into the commit message (like git pull), whether stored or displayed.
    public static func anonymizedSource(_ source: String) -> String {
        guard let scheme = source.range(of: "://") else { return source }
        let authorityEnd = source[scheme.upperBound...].firstIndex(of: "/") ?? source.endIndex
        guard let at = source[scheme.upperBound..<authorityEnd].lastIndex(of: "@") else { return source }
        return String(source[..<scheme.upperBound]) + source[source.index(after: at)...]
    }

    /// The branches of another repository (a local folder or a URL). A local source needs no network and no sign-in.
    public func branches(ofRepository source: String) async throws -> ForeignBranches {
        ForeignBranches.parse(try await runner.output(["ls-remote", "--symref", "--", source, "HEAD", "refs/heads/*"],
                                                      credentialURLs: [source]))
    }

    /// Merge branch `branch` of another repository into the current branch without adding a remote: fetch that
    /// branch into a temporary ref, merge, then delete the temporary ref. When the merge stops on conflicts
    /// MERGE_HEAD still holds the source commit, so "Continue" / "Cancel" behave like a normal merge.
    /// Two unrelated repos (no shared commits) need `allowUnrelatedHistories`, otherwise git refuses.
    public func mergeBranch(_ branch: String, fromRepository source: String, allowUnrelatedHistories: Bool = false,
                            onProgress: (@Sendable (String) -> Void)? = nil) async throws {
        try await fetchForeignBranch(branch, fromRepository: source, onProgress: onProgress)
        try await mergeFetchedForeignBranch(branch, fromRepository: source, allowUnrelatedHistories: allowUnrelatedHistories)
    }

    /// Step 1: fetch branch `branch` of the other repository into the temporary ref — HEAD and the working tree are
    /// still untouched. On failure (source gone, branch deleted, network…) or cancellation the repo is unchanged and the temporary ref is deleted.
    public func fetchForeignBranch(_ branch: String, fromRepository source: String,
                                   onProgress: (@Sendable (String) -> Void)? = nil) async throws {
        do {
            try await runner.run(["fetch", "--progress", "--no-tags", "--", source, "+refs/heads/\(branch):\(Self.foreignMergeRef)"],
                                 credentialURLs: [source], onProgress: onProgress)
            // Delete right after fetching: nothing has been checked out or merged yet.
            try Task.checkCancellation()
        } catch {
            await removeForeignMergeRef()
            throw error
        }
    }

    /// Step 2: check out `target` (nil: the current branch), merge the temporary ref and delete it. It always runs
    /// to completion even when the Task was cancelled — stopping `git merge` halfway would leave a half-written
    /// index with no MERGE_HEAD. Cancelled before starting, it only deletes the temporary ref. If the merge
    /// fails without git leaving a MERGE_HEAD (refused outright: unrelated histories, uncommitted changes
    /// overwritten…) after `target` was already checked out, check the old HEAD back out and throw
    /// `ForeignMergeFailure`.
    public func mergeFetchedForeignBranch(_ branch: String, fromRepository source: String, into target: String? = nil,
                                          allowUnrelatedHistories: Bool = false) async throws {
        if Task.isCancelled {
            await removeForeignMergeRef()
            throw CancellationError()
        }
        let repository = self
        try await Task.detached {
            try await repository.checkoutAndMergeForeignRef(branch, source: source, target: target,
                                                            allowUnrelatedHistories: allowUnrelatedHistories)
        }.value
    }

    /// Delete the temporary ref, even while the Task is being cancelled (the cancelled Task's git commands are killed immediately, so this runs in its own Task).
    public func removeForeignMergeRef() async {
        let runner = runner
        await Task.detached { _ = try? await runner.run(["update-ref", "-d", GitRepository.foreignMergeRef]) }.value
    }

    private func checkoutAndMergeForeignRef(_ branch: String, source: String, target: String?,
                                            allowUnrelatedHistories: Bool) async throws {
        let ref = Self.foreignMergeRef
        var previous: (spec: String, isBranch: Bool)?
        if let target {
            do {
                let current = (try? await runner.output(["symbolic-ref", "--quiet", "--short", "HEAD"]))?
                    .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                if current != target {
                    previous = current.isEmpty ? (try await resolveCommit("HEAD"), false) : (current, true)
                    try await switchTo(branch: target)
                }
            } catch {
                _ = try? await runner.run(["update-ref", "-d", ref])
                throw error
            }
        }
        var args = ["merge", "--no-edit", "-m", "Merge branch '\(branch)' of \(Self.anonymizedSource(source))"]
        if allowUnrelatedHistories { args.append("--allow-unrelated-histories") }
        args.append(ref)
        do {
            try await runner.run(args)
        } catch {
            _ = try? await runner.run(["update-ref", "-d", ref])
            guard let previous, operationState() != .merging else { throw error }
            let restored: String?
            do {
                if previous.isBranch {
                    try await switchTo(branch: previous.spec)
                } else {
                    try await switchDetached(previous.spec)
                }
                restored = previous.isBranch ? previous.spec : String(previous.spec.prefix(7))
            } catch {
                restored = nil
            }
            throw ForeignMergeFailure(underlying: error, restoredHead: restored)
        }
        _ = try? await runner.run(["update-ref", "-d", ref])
    }
}

/// Merging from another repository into a branch that isn't the current one: the target branch was already checked out but
/// `git merge` failed without leaving a MERGE_HEAD (git refused outright), so Thaigit checks the old HEAD back out.
public struct ForeignMergeFailure: LocalizedError {
    /// `git merge`'s failure.
    public let underlying: any Error
    /// The branch (or short detached commit) it went back to; nil when it couldn't, in which case HEAD is still on the target.
    public let restoredHead: String?

    public init(underlying: any Error, restoredHead: String?) {
        self.underlying = underlying
        self.restoredHead = restoredHead
    }

    public var errorDescription: String? {
        (underlying as? LocalizedError)?.errorDescription ?? underlying.localizedDescription
    }
}
