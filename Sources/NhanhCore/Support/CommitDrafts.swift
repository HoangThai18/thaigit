import Foundation

/// One repo's half-typed commit message.
public struct CommitDraft: Codable, Equatable, Sendable {
    public var summary: String
    public var body: String
    /// Last edit time — used to drop the oldest draft once the cap is exceeded.
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

/// Per-repo commit drafts (keyed by the repo's root path) stored in UserDefaults: closing the app, closing a
/// tab or switching repo and coming back still keeps the half-typed message. A blank draft is deleted; at
/// most the `maxDrafts` most recent repos are kept.
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
