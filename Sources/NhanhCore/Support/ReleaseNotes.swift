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

        /// Mục này có phải phiên bản `version` không — so bằng `AppVersion` ("1.1" là "1.1.0", "v1.2" là "1.2").
        public func isVersion(_ version: String) -> Bool {
            guard let mine = AppVersion(title), let other = AppVersion(version) else { return title == version }
            return mine == other
        }
    }

    public var sections: [Section]

    /// Đọc Markdown kiểu "## 1.0.0 — 2026-10-02" rồi các dòng "- …"; bỏ tiêu đề "# …" và phần mở đầu. Tiêu đề tách ở
    /// gạch dài / gạch ngắn / gạch nối có khoảng trắng hai bên ("1.0.0-beta" không bị tách), số phiên bản trong ngoặc
    /// vuông ("[1.1.0]", kiểu keep-a-changelog) được bỏ ngoặc. Dòng tiếp nối (thụt đầu dòng) được nối vào gạch đầu dòng
    /// phía trên.
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
                var title = heading
                var date: String?
                if let separator = heading.range(of: #"\s+[—–-]\s+"#, options: .regularExpression) {
                    title = String(heading[..<separator.lowerBound])
                    date = heading[separator.upperBound...].trimmingCharacters(in: .whitespaces)
                }
                title = title.trimmingCharacters(in: .whitespaces)
                if title.hasPrefix("["), title.hasSuffix("]"), title.count > 2 {
                    title = String(title.dropFirst().dropLast()).trimmingCharacters(in: .whitespaces)
                }
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
