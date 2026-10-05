import NhanhCore
import SwiftUI

/// Blame like GitKraken: every line of the file with who changed it, when, and the commit message (each run of adjacent
/// lines from the same commit is labelled once). Click the left-hand part to jump to that commit on the graph.
struct BlameSheet: View {
    @Bindable var model: RepoModel
    let path: String
    /// nil: the working tree version (including uncommitted lines).
    let rev: String?
    @Environment(\.dismiss) private var dismiss
    @State private var blame: Blame?
    /// The group index (used to alternate the background colour), by line number.
    @State private var groupIndex: [Int: Int] = [:]
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Label("Blame: \(path)", systemImage: "person.text.rectangle")
                    .font(.title3.bold())
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer()
                Text(rev.map { String(localized: "tại commit \(String($0.prefix(7)))") } ?? String(localized: "bản đang sửa (gồm cả dòng chưa commit)"))
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
            content
            HStack {
                Text("Bấm vào tên người sửa để xem commit đó trên graph")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Button("Đóng") { dismiss() }
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(20)
        .frame(width: 1000, height: 660)
        .task { await load() }
    }

    @ViewBuilder
    private var content: some View {
        if let errorMessage {
            Text(errorMessage)
                .foregroundStyle(.red)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let blame {
            ScrollView([.vertical, .horizontal]) {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(blame.lines) { line in
                        BlameLineRow(line: line, info: blame.commits[line.sha], stripe: (groupIndex[line.number] ?? 0) % 2 == 1,
                                     repo: model.githubRepo) { sha in
                            dismiss()
                            model.reveal(commit: sha)
                        }
                    }
                }
                .padding(.vertical, 4)
            }
            .background(Color(nsColor: .textBackgroundColor).opacity(0.5), in: RoundedRectangle(cornerRadius: 10))
        } else {
            ProgressView("Đang đọc…").frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func load() async {
        do {
            let result = try await model.repository.blame(path: path, at: rev)
            var index: [Int: Int] = [:]
            var group = 0
            for line in result.lines {
                if line.startsGroup, line.number > 1 { group += 1 }
                index[line.number] = group
            }
            groupIndex = index
            blame = result
        } catch {
            errorMessage = FriendlyError.message(for: error)
        }
    }
}

private struct BlameLineRow: View {
    let line: Blame.Line
    let info: Blame.CommitInfo?
    let stripe: Bool
    let repo: GitHubRepoRef?
    let reveal: (String) -> Void
    @State private var hovering = false

    private static let gutterWidth: CGFloat = 330

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 0) {
            gutter
                .frame(width: Self.gutterWidth, alignment: .leading)
                .background(stripe ? Color.primary.opacity(0.05) : Color.clear)
            Text("\(line.number)")
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.tertiary)
                .frame(width: 48, alignment: .trailing)
                .padding(.trailing, 10)
            Text(line.text.isEmpty ? " " : line.text)
                .font(.system(size: 12, design: .monospaced))
                .textSelection(.enabled)
                .fixedSize()
                .padding(.trailing, 20)
        }
        .frame(minHeight: 19)
    }

    @ViewBuilder
    private var gutter: some View {
        if line.startsGroup, let info {
            Button {
                if !info.isUncommitted { reveal(info.sha) }
            } label: {
                HStack(spacing: 6) {
                    AvatarView(name: info.isUncommitted ? "?" : info.author, email: info.isUncommitted ? nil : info.email,
                               repo: repo, size: 15)
                    Text(info.isUncommitted ? String(localized: "Chưa commit") : info.author)
                        .lineLimit(1)
                        .frame(width: 96, alignment: .leading)
                    Text(info.isUncommitted ? "" : VietnameseDate.relative(info.date))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .frame(width: 74, alignment: .leading)
                    Text(info.isUncommitted ? "" : info.summary)
                        .foregroundStyle(hovering ? Brand.blue : .secondary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
                .font(.system(size: 11))
                .padding(.horizontal, 8)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(info.isUncommitted)
            .onHover { hovering = $0 }
            .help(info.isUncommitted ? "Dòng chưa commit"
                  : "\(info.shortSHA) · \(info.author) <\(info.email)> · \(VietnameseDate.absolute(info.date))\n\(info.summary)")
        } else {
            Color.clear.frame(height: 1)
        }
    }
}
