import Foundation

/// The changelog (the CHANGELOG.md shipped with the app) split per version for the "What's New" tab.
public struct ReleaseNotes: Sendable, Equatable {
    public struct Section: Sendable, Equatable, Identifiable {
        /// "1.1.0", or the raw heading when it isn't a version number (e.g. "Chưa phát hành").
        public var title: String
        /// The part after the heading's "—", usually the release date.
        public var date: String?
        /// The paragraph before the list.
        public var paragraphs: [String]
        /// The bullet items (inline Markdown).
        public var items: [String]

        public var id: String { title }
        public var isUnreleased: Bool { AppVersion(title) == nil }

        /// Whether this entry is version `version` — compared with `AppVersion` ("1.1" is "1.1.0", "v1.2" is "1.2").
        public func isVersion(_ version: String) -> Bool {
            guard let mine = AppVersion(title), let other = AppVersion(version) else { return title == version }
            return mine == other
        }
    }

    public var sections: [Section]

    /// Read Markdown of the form "## 1.0.0 — 2026-10-02" followed by "- …" lines; drops the "# …" title and the
    /// preamble. Headings split on an em / en dash or hyphen surrounded by spaces ("1.0.0-beta" is not split),
    /// and a bracketed version ("[1.1.0]", keep-a-changelog style) loses its brackets. Continuation lines
    /// (indented) are appended to the bullet above.
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
