import Foundation

extension GitRepository {
    /// Repo có dùng Git LFS không: `.gitattributes` ở gốc có `filter=lfs` (đọc file, không chạy lệnh).
    public func usesLFS() -> Bool {
        guard let text = try? String(contentsOf: root.appendingPathComponent(".gitattributes"), encoding: .utf8) else { return false }
        return Self.lfsPatterns(inAttributes: text).isEmpty == false
    }

    /// Các mẫu file được LFS theo dõi trong nội dung `.gitattributes`.
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

    /// Phiên bản git-lfs, nil nếu chưa cài.
    public func lfsVersion() async -> String? {
        guard let output = try? await runner.output(["lfs", "version"]) else { return nil }
        let text = output.trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? nil : text
    }

    /// `git lfs pull` / `fetch` / `prune` (lệnh mạng dùng token GitHub như fetch thường).
    public func lfs(_ command: LFSCommand, onProgress: (@Sendable (String) -> Void)? = nil) async throws {
        let urls = command.touchesNetwork ? await remoteURLs(nil, push: false) : []
        try await runner.run(["lfs", command.rawValue], credentialURLs: urls, onProgress: onProgress)
    }

    /// Theo dõi (hoặc bỏ theo dõi) một mẫu file bằng LFS — sửa `.gitattributes`.
    public func lfsTrack(_ pattern: String, track: Bool = true) async throws {
        try await runner.run(["lfs", track ? "track" : "untrack", "--", pattern])
    }

    /// File đang lưu bằng LFS trong HEAD.
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
