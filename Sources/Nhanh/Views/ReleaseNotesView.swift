import AppKit
import NhanhCore
import SwiftUI

/// The "What's New" tab, like GitKraken's Release Notes: reads the CHANGELOG.md shipped with the app.
struct ReleaseNotesView: View {
    private let notes = Self.load()
    private let currentVersion = AppUpdater.shared.currentVersion

    private static func load() -> ReleaseNotes? {
        guard let url = Bundle.main.url(forResource: "CHANGELOG", withExtension: "md"),
              let text = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        return ReleaseNotes.parse(text)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                HStack(spacing: 14) {
                    Image(nsImage: NSApp.applicationIconImage)
                        .resizable()
                        .frame(width: 56, height: 56)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Có gì mới")
                            .font(.system(size: 30, weight: .bold, design: .rounded))
                            .foregroundStyle(LinearGradient(colors: [Brand.orange, Brand.blue], startPoint: .leading, endPoint: .trailing))
                        Text("Bạn đang dùng Thaigit \(currentVersion)")
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("Kiểm tra cập nhật") {
                        Task { await AppUpdater.shared.check(userInitiated: true) }
                    }
                    .glassButtonStyle()
                }
                if let notes, !notes.sections.isEmpty {
                    ForEach(notes.sections) { section in
                        ReleaseSectionCard(section: section, isCurrent: section.isVersion(currentVersion))
                    }
                } else {
                    ContentUnavailableView("Chưa có nhật ký thay đổi", systemImage: "doc.text",
                                           description: Text("Bản build này không kèm CHANGELOG.md."))
                }
            }
            .padding(36)
            .frame(maxWidth: 780, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(BrandBackground())
        .navigationTitle("Có gì mới")
    }
}

private struct ReleaseSectionCard: View {
    let section: ReleaseNotes.Section
    let isCurrent: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(section.isUnreleased ? section.title : "Thaigit \(section.title)")
                    .font(.title2.bold())
                if isCurrent { badge(String(localized: "Bản bạn đang dùng"), tint: Brand.blue) }
                if section.isUnreleased { badge(String(localized: "Đang phát triển"), tint: Brand.orange) }
                Spacer()
                if let date = section.date {
                    Text(date).foregroundStyle(.secondary)
                }
            }
            ForEach(Array(section.paragraphs.enumerated()), id: \.offset) { _, paragraph in
                Text(Self.markdown(paragraph))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            ForEach(Array(section.items.enumerated()), id: \.offset) { _, item in
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text("•").foregroundStyle(Brand.blue).fontWeight(.bold)
                    Text(Self.markdown(item))
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .textSelection(.enabled)
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassSurface(in: RoundedRectangle(cornerRadius: 18))
    }

    private func badge(_ text: String, tint: Color) -> some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .foregroundStyle(tint)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(tint.opacity(0.15), in: Capsule())
    }

    /// Inline Markdown (**bold**, `code`, links); a syntax error falls back to the raw text.
    private static func markdown(_ text: String) -> AttributedString {
        (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            ?? AttributedString(text)
    }
}
