import Foundation
import Testing
@testable import NhanhCore

@Suite("Bản nháp commit theo repo")
struct CommitDraftTests {
    @Test func savesLoadsAndClearsPerRepo() {
        let storage = InMemorySettingsStorage()
        let store = CommitDraftStore(storage: storage)
        store.save(root: "/repo/a", summary: "Sửa lỗi", body: "Chi tiết")
        store.save(root: "/repo/b", summary: "Khác", body: "")

        let reopened = CommitDraftStore(storage: storage)
        #expect(reopened.load(root: "/repo/a")?.summary == "Sửa lỗi")
        #expect(reopened.load(root: "/repo/a")?.body == "Chi tiết")
        #expect(reopened.load(root: "/repo/b")?.summary == "Khác")
        #expect(reopened.load(root: "/repo/c") == nil)

        reopened.save(root: "/repo/a", summary: "  ", body: "\n")
        #expect(reopened.load(root: "/repo/a") == nil)
        reopened.save(root: "/repo/b", summary: "", body: "")
        #expect(storage.data(forKey: CommitDraftStore.key) == nil)
    }

    @Test func dropsOldestBeyondLimitAndIgnoresGarbage() {
        let storage = InMemorySettingsStorage()
        storage.setData(Data("không phải json".utf8), forKey: CommitDraftStore.key)
        let store = CommitDraftStore(storage: storage)
        #expect(store.load(root: "/x") == nil)

        let start = Date(timeIntervalSince1970: 1_000)
        for index in 0..<CommitDraftStore.maxDrafts {
            store.save(root: "/r\(index)", summary: "s", body: "", now: start.addingTimeInterval(Double(index)))
        }
        store.save(root: "/moi", summary: "mới", body: "", now: start.addingTimeInterval(10_000))
        #expect(store.load(root: "/moi")?.summary == "mới")
        #expect(store.load(root: "/r0") == nil)
        #expect(store.load(root: "/r1")?.summary == "s")
    }
}
