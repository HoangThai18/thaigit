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

    /// Bỏ "user:mật-khẩu@" khỏi URL dạng scheme:// trước khi ghi vào message commit (như git pull), lưu lại hay hiện ra.
    public static func anonymizedSource(_ source: String) -> String {
        guard let scheme = source.range(of: "://") else { return source }
        let authorityEnd = source[scheme.upperBound...].firstIndex(of: "/") ?? source.endIndex
        guard let at = source[scheme.upperBound..<authorityEnd].lastIndex(of: "@") else { return source }
        return String(source[..<scheme.upperBound]) + source[source.index(after: at)...]
    }

    /// Các nhánh của một repository khác (thư mục trên máy hoặc URL). Nguồn là thư mục thì không cần mạng hay đăng nhập.
    public func branches(ofRepository source: String) async throws -> ForeignBranches {
        ForeignBranches.parse(try await runner.output(["ls-remote", "--symref", "--", source, "HEAD", "refs/heads/*"],
                                                      credentialURLs: [source]))
    }

    /// Merge nhánh `branch` của repository khác vào nhánh hiện tại mà không thêm remote: fetch nhánh đó vào ref tạm,
    /// merge, rồi xoá ref tạm. Merge dừng vì xung đột thì MERGE_HEAD vẫn giữ commit nguồn nên "Tiếp tục" / "Huỷ" chạy như
    /// merge thường. Hai repo tạo riêng (không chung commit nào) cần `allowUnrelatedHistories`, nếu không git từ chối.
    public func mergeBranch(_ branch: String, fromRepository source: String, allowUnrelatedHistories: Bool = false,
                            onProgress: (@Sendable (String) -> Void)? = nil) async throws {
        try await fetchForeignBranch(branch, fromRepository: source, onProgress: onProgress)
        try await mergeFetchedForeignBranch(branch, fromRepository: source, allowUnrelatedHistories: allowUnrelatedHistories)
    }

    /// Bước 1: fetch nhánh `branch` của repository khác vào ref tạm — chưa đụng HEAD hay working tree. Lỗi (nguồn không
    /// còn, nhánh đã xoá, mạng…) hoặc bị huỷ thì repo giữ nguyên và ref tạm được xoá.
    public func fetchForeignBranch(_ branch: String, fromRepository source: String,
                                   onProgress: (@Sendable (String) -> Void)? = nil) async throws {
        do {
            try await runner.run(["fetch", "--progress", "--no-tags", "--", source, "+refs/heads/\(branch):\(Self.foreignMergeRef)"],
                                 credentialURLs: [source], onProgress: onProgress)
            // Huỷ ngay sau fetch: chưa checkout / merge gì.
            try Task.checkCancellation()
        } catch {
            await removeForeignMergeRef()
            throw error
        }
    }

    /// Bước 2: checkout `target` (nil: nhánh hiện tại) rồi merge ref tạm và xoá ref tạm. Chạy tới cùng kể cả khi Task bị
    /// huỷ — dừng `git merge` giữa chừng để lại index nửa vời mà không có MERGE_HEAD. Bị huỷ trước khi bắt đầu thì chỉ xoá
    /// ref tạm. Merge lỗi mà git không để lại MERGE_HEAD (từ chối ngay: lịch sử không liên quan, thay đổi chưa commit bị
    /// đè…) sau khi đã checkout `target` thì checkout lại HEAD cũ và ném `ForeignMergeFailure`.
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

    /// Xoá ref tạm, kể cả khi Task đang bị huỷ (lệnh git của Task bị huỷ bị dừng ngay nên chạy ở Task riêng).
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

/// Merge từ repository khác vào nhánh khác nhánh hiện tại: đã checkout nhánh đích nhưng `git merge` thất bại mà không để
/// lại MERGE_HEAD (git từ chối ngay), nên Thaigit checkout lại HEAD cũ.
public struct ForeignMergeFailure: LocalizedError {
    /// Lỗi của `git merge`.
    public let underlying: any Error
    /// Nhánh (hoặc commit tách rời, dạng ngắn) đã quay lại; nil nếu không quay lại được — HEAD vẫn ở nhánh đích.
    public let restoredHead: String?

    public init(underlying: any Error, restoredHead: String?) {
        self.underlying = underlying
        self.restoredHead = restoredHead
    }

    public var errorDescription: String? {
        (underlying as? LocalizedError)?.errorDescription ?? underlying.localizedDescription
    }
}
