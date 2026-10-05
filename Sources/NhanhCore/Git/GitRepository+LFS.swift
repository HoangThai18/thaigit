import Foundation

extension GitRepository {
    /// Whether the repo uses Git LFS: the root `.gitattributes` has `filter=lfs` (read the file, never run a command).
    public func usesLFS() -> Bool {
        guard let text = try? String(contentsOf: root.appendingPathComponent(".gitattributes"), encoding: .utf8) else { return false }
        return Self.lfsPatterns(inAttributes: text).isEmpty == false
    }

    /// The file patterns LFS tracks, taken from the `.gitattributes` content.
    static func lfsPatterns(inAttributes text: String) -> [String] {
        text.split(separator: "\n").compactMap { line in
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard !trimmed.hasPrefix("#"), trimmed.contains("filter=lfs") else { return nil }
            return trimmed.split(separator: " ").first.map(String.init)
        }
    }

    public func lfsTrackedPatterns() -> [String] {
        guard let text = try? String(contentsOf: root.appendingPathComponent(".gitattributes"), encoding: .utf8) else { return [] }
        return Self.lfsPatterns(inAttributes: text)
    }

    /// The git-lfs version, nil when it isn't installed.
    public func lfsVersion() async -> String? {
        guard let output = try? await runner.output(["lfs", "version"]) else { return nil }
        let text = output.trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? nil : text
    }

    /// `git lfs pull` / `fetch` / `prune` (network commands use the GitHub token like a normal fetch).
    public func lfs(_ command: LFSCommand, onProgress: (@Sendable (String) -> Void)? = nil) async throws {
        let urls = command.touchesNetwork ? await remoteURLs(nil, push: false) : []
        try await runner.run(["lfs", command.rawValue], credentialURLs: urls, onProgress: onProgress)
    }

    /// Start (or stop) tracking a file pattern with LFS — edits `.gitattributes`.
    public func lfsTrack(_ pattern: String, track: Bool = true) async throws {
        try await runner.run(["lfs", track ? "track" : "untrack", "--", pattern])
    }

    /// Files stored with LFS in HEAD.
    public func lfsFiles() async throws -> [String] {
        try await runner.output(["lfs", "ls-files", "--name-only"]).split(separator: "\n").map(String.init)
    }
}

public enum LFSCommand: String, Sendable {
    case pull
    case fetch
    case prune

    var touchesNetwork: Bool { self != .prune }
}
