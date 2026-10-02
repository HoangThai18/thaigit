import Foundation

/// Nhánh của một repository khác, đọc bằng `git ls-remote` (không cần thêm remote).
public struct ForeignBranches: Sendable, Equatable {
    public var names: [String]
    /// Nhánh mà HEAD của repo đó trỏ tới (nhánh mặc định), nếu đọc được.
    public var defaultBranch: String?

    public init(names: [String], defaultBranch: String?) {
        self.names = names
        self.defaultBranch = defaultBranch
    }

    /// Parse `git ls-remote --symref <nguồn> HEAD refs/heads/*`: dòng "ref: refs/heads/main\tHEAD" cho biết nhánh mặc định,
    /// dòng "<sha>\trefs/heads/<tên>" là một nhánh. Mẫu "HEAD" còn khớp cả refs/remotes/*/HEAD nên chỉ nhận dòng đúng "HEAD".
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

// MARK: - Merge từ repository khác

extension GitRepository {
    /// Ref tạm giữ nhánh vừa lấy từ repository khác. Nằm ngoài refs/heads|remotes|tags nên không hiện trên graph,
    /// và được xoá ngay sau khi merge.
    public static let foreignMergeRef = "refs/thaigit/merge-source"

    /// Chuẩn hoá nguồn người dùng nhập: "~/…" và đường dẫn tương đối (tính từ `base`) thành đường dẫn tuyệt đối nếu đó là
    /// thư mục có thật; URL (https://, ssh://, git@host:…) giữ nguyên.
    public static func resolveRepositorySource(_ input: String, relativeTo base: URL) -> String {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !trimmed.contains("://") else { return trimmed }
        let expanded = (trimmed as NSString).expandingTildeInPath
        let url = expanded.hasPrefix("/") ? URL(fileURLWithPath: expanded) : base.appendingPathComponent(expanded)
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory), isDirectory.boolValue else { return trimmed }
        return url.standardizedFileURL.path
    }

    /// Bỏ "user:mật-khẩu@" khỏi URL dạng scheme:// trước khi ghi vào message commit (như git pull).
    static func anonymizedSource(_ source: String) -> String {
        guard let scheme = source.range(of: "://") else { return source }
        let authorityEnd = source[scheme.upperBound...].firstIndex(of: "/") ?? source.endIndex
        guard let at = source[scheme.upperBound..<authorityEnd].lastIndex(of: "@") else { return source }
        return String(source[..<scheme.upperBound]) + source[source.index(after: at)...]
    }

    /// Các nhánh của một repository khác (thư mục trên máy hoặc URL). Nguồn là thư mục thì không cần mạng hay đăng nhập.
    public func branches(ofRepository source: String) async throws -> ForeignBranches {
        ForeignBranches.parse(try await runner.output(["ls-remote", "--symref", "--", source, "HEAD", "refs/heads/*"]))
    }

    /// Merge nhánh `branch` của repository khác vào nhánh hiện tại mà không thêm remote: fetch nhánh đó vào ref tạm,
    /// merge, rồi xoá ref tạm. Merge dừng vì xung đột thì MERGE_HEAD vẫn giữ commit nguồn nên "Tiếp tục" / "Huỷ" chạy như
    /// merge thường. Hai repo tạo riêng (không chung commit nào) cần `allowUnrelatedHistories`, nếu không git từ chối.
    public func mergeBranch(_ branch: String, fromRepository source: String, allowUnrelatedHistories: Bool = false,
                            onProgress: (@Sendable (String) -> Void)? = nil) async throws {
        let ref = Self.foreignMergeRef
        try await runner.run(["fetch", "--progress", "--no-tags", "--", source, "+refs/heads/\(branch):\(ref)"], onProgress: onProgress)
        var args = ["merge", "--no-edit", "-m", "Merge branch '\(branch)' of \(Self.anonymizedSource(source))"]
        if allowUnrelatedHistories { args.append("--allow-unrelated-histories") }
        args.append(ref)
        do {
            try await runner.run(args)
        } catch {
            _ = try? await runner.run(["update-ref", "-d", ref])
            throw error
        }
        _ = try? await runner.run(["update-ref", "-d", ref])
    }
}
