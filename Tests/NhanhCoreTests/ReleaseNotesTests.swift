import Foundation
import Testing
@testable import NhanhCore

@Suite("Có gì mới (CHANGELOG)")
struct ReleaseNotesTests {
    @Test func parsesSections() {
        let text = """
        # Nhật ký thay đổi

        Các thay đổi đáng chú ý của Thaigit.

        ## Chưa phát hành

        - Merge từ repository khác
        - Graph như **GitKraken**:
          node là ảnh đại diện

        ## 1.0.0 — 2026-10-02

        Bản đầu tiên của Thaigit cho macOS.

        - Graph lịch sử nhiều màu
        * Kéo & thả `merge`
        """
        let notes = ReleaseNotes.parse(text)
        #expect(notes.sections.map(\.title) == ["Chưa phát hành", "1.0.0"])
        let unreleased = notes.sections[0]
        #expect(unreleased.isUnreleased && unreleased.date == nil)
        #expect(unreleased.items == ["Merge từ repository khác", "Graph như **GitKraken**: node là ảnh đại diện"])
        let first = notes.sections[1]
        #expect(!first.isUnreleased && first.date == "2026-10-02")
        #expect(first.paragraphs == ["Bản đầu tiên của Thaigit cho macOS."])
        #expect(first.items == ["Graph lịch sử nhiều màu", "Kéo & thả `merge`"])
    }

    @Test func parsesTheRealChangelog() throws {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("CHANGELOG.md")
        let notes = ReleaseNotes.parse(try String(contentsOf: url, encoding: .utf8))
        #expect(notes.sections.contains { $0.title == "1.0.0" && $0.items.count >= 5 })
        #expect(notes.sections.allSatisfy { !$0.items.isEmpty })
    }

    @Test func handlesCRLFAndEmpty() {
        #expect(ReleaseNotes.parse("").sections.isEmpty)
        #expect(ReleaseNotes.parse("# Tiêu đề\n\nchỉ có lời mở đầu\n").sections.isEmpty)
        let notes = ReleaseNotes.parse("## 2.0 — hôm nay\r\n- a\r\n- b\r\n")
        #expect(notes.sections.first?.items == ["a", "b"])
        #expect(notes.sections.first?.date == "hôm nay")
    }
}
