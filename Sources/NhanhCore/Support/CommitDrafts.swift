import Foundation

/// Message commit đang gõ dở của một repo.
public struct CommitDraft: Codable, Equatable, Sendable {
    public var summary: String
    public var body: String
    /// Lần sửa cuối — để bỏ bản nháp cũ nhất khi vượt trần.
    public var savedAt: Date

    public init(summary: String, body: String, savedAt: Date = Date()) {
        self.summary = summary
        self.body = body
        self.savedAt = savedAt
    }

    public var isEmpty: Bool {
        summary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

/// Bản nháp commit theo từng repo (khoá: đường dẫn gốc repo) lưu trong UserDefaults: đóng app, đóng tab hay đổi repo
/// rồi quay lại vẫn còn message đang gõ dở. Bản nháp trống thì xoá; giữ tối đa `maxDrafts` repo gần nhất.
public struct CommitDraftStore: Sendable {
    public static let key = "commitDrafts.v1"
    public static let maxDrafts = 50
    public let storage: any GitHubSettingsStorage

    public init(storage: any GitHubSettingsStorage = UserDefaultsSettingsStorage()) {
        self.storage = storage
    }

    public func load(root: String) -> CommitDraft? {
        all()[root]
    }

    public func save(root: String, summary: String, body: String, now: Date = Date()) {
        var drafts = all()
        let draft = CommitDraft(summary: summary, body: body, savedAt: now)
        if draft.isEmpty {
            guard drafts.removeValue(forKey: root) != nil else { return }
        } else {
            drafts[root] = draft
        }
        if drafts.count > Self.maxDrafts {
            let kept = drafts.sorted { $0.value.savedAt > $1.value.savedAt }.prefix(Self.maxDrafts)
            drafts = Dictionary(uniqueKeysWithValues: kept.map { ($0.key, $0.value) })
        }
        storage.setData(drafts.isEmpty ? nil : try? JSONEncoder().encode(drafts), forKey: Self.key)
    }

    private func all() -> [String: CommitDraft] {
        guard let data = storage.data(forKey: Self.key),
              let drafts = try? JSONDecoder().decode([String: CommitDraft].self, from: data) else { return [:] }
        return drafts.filter { !$0.value.isEmpty }
    }
}
