import Foundation

/// Nhánh ẩn / chỉ hiện ("solo") trên graph, như GitKraken. Ref ghi bằng tên đầy đủ (`refs/heads/x`, `refs/remotes/origin/x`).
/// Ẩn một nhánh chỉ bỏ nó khỏi các điểm bắt đầu của lịch sử: commit chung với nhánh khác vẫn hiện.
public struct GraphRefFilter: Sendable, Equatable, Codable {
    public var hidden: Set<String>
    /// Khác rỗng: graph chỉ gồm lịch sử của các ref này.
    public var solo: Set<String>

    public init(hidden: Set<String> = [], solo: Set<String> = []) {
        self.hidden = hidden
        self.solo = solo
    }

    public var isActive: Bool { !hidden.isEmpty || !solo.isEmpty }

    /// Ref có được vẽ (nhãn, lịch sử riêng) trên graph không. Tag luôn hiện khi không solo.
    public func isVisible(_ fullName: String) -> Bool {
        if !solo.isEmpty { return solo.contains(fullName) }
        return !hidden.contains(fullName)
    }

    /// Bỏ các ref không còn tồn tại (nhánh đã xoá).
    public func keeping(_ existing: Set<String>) -> GraphRefFilter {
        GraphRefFilter(hidden: hidden.intersection(existing), solo: solo.intersection(existing))
    }

    /// Các đối số chọn điểm bắt đầu cho `git log` (thay cho `--branches --remotes --tags HEAD`).
    /// - solo: đúng các ref đó, kèm HEAD (nhánh đang checkout và dòng WIP luôn hiện).
    /// - ẩn: `--exclude=<mẫu>` đặt ngay trước `--branches` / `--remotes` (mẫu không có tiền tố refs/heads/, refs/remotes/
    ///   và được thoát ký tự glob — git coi mẫu --exclude là glob).
    public func revisionArguments(includeHEAD: Bool, includeRemotes: Bool, includeTags: Bool) -> [String] {
        if !solo.isEmpty {
            var args = solo.filter { $0.hasPrefix("refs/") }.sorted()
            if includeHEAD { args.append("HEAD") }
            return args
        }
        var args = excludes(prefix: "refs/heads/") + ["--branches"]
        if includeRemotes { args += excludes(prefix: "refs/remotes/") + ["--remotes"] }
        if includeTags { args += excludes(prefix: "refs/tags/") + ["--tags"] }
        if includeHEAD { args.append("HEAD") }
        return args
    }

    private func excludes(prefix: String) -> [String] {
        hidden.filter { $0.hasPrefix(prefix) }.sorted().map { "--exclude=" + Self.escapeGlob(String($0.dropFirst(prefix.count))) }
    }

    static func escapeGlob(_ text: String) -> String {
        var result = ""
        for character in text {
            if "*?[]\\".contains(character) { result.append("\\") }
            result.append(character)
        }
        return result
    }
}
