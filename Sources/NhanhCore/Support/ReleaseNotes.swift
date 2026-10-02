import Foundation

/// Nhật ký thay đổi (CHANGELOG.md đi kèm app) tách thành từng phiên bản cho tab "Có gì mới".
public struct ReleaseNotes: Sendable, Equatable {
    public struct Section: Sendable, Equatable, Identifiable {
        /// "1.1.0", hoặc nguyên tiêu đề nếu không phải số phiên bản (ví dụ "Chưa phát hành").
        public var title: String
        /// Phần sau dấu "—" của tiêu đề, thường là ngày phát hành.
        public var date: String?
        /// Đoạn văn trước danh sách.
        public var paragraphs: [String]
        /// Các gạch đầu dòng (Markdown inline).
        public var items: [String]

        public var id: String { title }
        public var isUnreleased: Bool { AppVersion(title) == nil }
    }

    public var sections: [Section]

    /// Đọc Markdown kiểu "## 1.0.0 — 2026-10-02" rồi các dòng "- …"; bỏ tiêu đề "# …" và phần mở đầu.
    /// Dòng tiếp nối (thụt đầu dòng) được nối vào gạch đầu dòng phía trên.
    public static func parse(_ markdown: String) -> ReleaseNotes {
        var sections: [Section] = []
        var paragraph: [String] = []
        func flushParagraph() {
            guard !paragraph.isEmpty, !sections.isEmpty else { paragraph = []; return }
            sections[sections.count - 1].paragraphs.append(paragraph.joined(separator: " "))
            paragraph = []
        }
        for rawLine in markdown.replacingOccurrences(of: "\r\n", with: "\n").split(separator: "\n", omittingEmptySubsequences: false) {
            let line = String(rawLine)
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("## ") {
                flushParagraph()
                let heading = String(line.dropFirst(3)).trimmingCharacters(in: .whitespaces)
                let parts = heading.components(separatedBy: " — ")
                let title = parts[0].trimmingCharacters(in: .whitespaces)
                let date = parts.count > 1 ? parts.dropFirst().joined(separator: " — ").trimmingCharacters(in: .whitespaces) : nil
                sections.append(Section(title: title, date: date, paragraphs: [], items: []))
            } else if sections.isEmpty {
                continue
            } else if trimmed.hasPrefix("- ") || trimmed.hasPrefix("* ") {
                flushParagraph()
                sections[sections.count - 1].items.append(String(trimmed.dropFirst(2)))
            } else if trimmed.isEmpty || line.hasPrefix("#") {
                flushParagraph()
            } else if line.hasPrefix(" "), !sections[sections.count - 1].items.isEmpty, paragraph.isEmpty {
                sections[sections.count - 1].items[sections[sections.count - 1].items.count - 1] += " " + trimmed
            } else {
                paragraph.append(trimmed)
            }
        }
        flushParagraph()
        return ReleaseNotes(sections: sections)
    }
}
