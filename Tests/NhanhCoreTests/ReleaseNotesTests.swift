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
        - Graph **nhiều màu**:
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
        #expect(unreleased.items == ["Merge từ repository khác", "Graph **nhiều màu**: node là ảnh đại diện"])
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

    /// A slightly different heading still splits into the right version / date: a hyphen or en dash instead of an em dash,
    /// a version in square brackets (keep-a-changelog style). A hyphen glued to the version ("1.0.0-beta") is not split.
    @Test func headingVariants() {
        let notes = ReleaseNotes.parse("""
        ## 1.2.0 - 2026-11-01
        - gạch nối
        ## [1.1.0] — 2026-10-20
        - ngoặc vuông
        ## 1.0.5 – 2026-10-10
        - gạch ngắn
        ## 1.0.0-beta
        - bản thử
        """)
        #expect(notes.sections.map(\.title) == ["1.2.0", "1.1.0", "1.0.5", "1.0.0-beta"])
        #expect(notes.sections.map(\.date) == ["2026-11-01", "2026-10-20", "2026-10-10", nil])
        #expect(notes.sections.prefix(3).allSatisfy { !$0.isUnreleased })
        // The "current build" mark follows AppVersion: "1.1" is "1.1.0".
        #expect(notes.sections[1].isVersion("1.1") && notes.sections[1].isVersion("1.1.0") && notes.sections[1].isVersion("v1.1"))
        #expect(!notes.sections[1].isVersion("1.1.1") && !notes.sections[1].isVersion("Chưa phát hành"))
    }
}
