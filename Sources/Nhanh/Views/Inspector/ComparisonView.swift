import NhanhCore
import SwiftUI

/// The right-hand panel while comparing two commits / two branches (like GitKraken): both ends of the comparison, the
/// commits in between, and the files that differ — click a file to see its diff in the centre.
struct ComparisonView: View {
    @Bindable var model: RepoModel
    let from: String
    let to: String

    var body: some View {
        if let comparison = model.comparison, comparison.from == from, comparison.to == to {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    header(comparison)
                    ComparisonContent(model: model, comparison: comparison, from: from, to: to)
                }
                .padding(16)
            }
        } else {
            ProgressView("Đang so sánh…").frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func header(_ comparison: Comparison) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("So sánh", systemImage: "arrow.left.arrow.right")
                    .font(.title3.bold())
                Spacer()
                Button {
                    model.select(.compare(from: to, to: from))
                } label: {
                    Image(systemName: "arrow.up.arrow.down")
                }
                .help("Đổi chiều so sánh")
                Button {
                    model.select(.commit(to))
                } label: {
                    Image(systemName: "xmark")
                }
                .help("Thôi so sánh")
            }
            .glassButtonStyle()
            endpoint(comparison.fromLabel, sha: from, caption: String(localized: "Từ"))
            Image(systemName: "arrow.down").foregroundStyle(.secondary).padding(.leading, 18)
            endpoint(comparison.toLabel, sha: to, caption: String(localized: "Tới"))
            Text("Trong diff: đỏ là chỉ có ở “Từ”, xanh là chỉ có ở “Tới”. Giữ ⌘ và bấm 2 commit trên graph để so sánh hai commit bất kỳ.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func endpoint(_ label: String, sha: String, caption: String) -> some View {
        HStack(spacing: 8) {
            Text(caption)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .frame(width: 28, alignment: .leading)
            Text(label)
                .font(.callout.weight(.semibold))
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: 4)
            Text(sha.prefix(7))
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.06)))
        .onTapGesture { model.reveal(commit: sha) }
    }
}

/// What the comparison screen and the PR / MR review screen share: the commits in between and the list of differing files (click a file to see its diff).
struct ComparisonContent: View {
    @Bindable var model: RepoModel
    let comparison: Comparison
    let from: String
    let to: String
    /// Clicking a commit jumps to it on the graph. Off in the review panel: jumping to a commit leaves the comparison and closes the review panel.
    var revealsCommits = true
    @State private var showCommits = true

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if !comparison.commits.isEmpty {
                DisclosureGroup(isExpanded: $showCommits) {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(comparison.commits.prefix(30)) { commit in
                            if revealsCommits {
                                Button {
                                    model.reveal(commit: commit.id)
                                } label: {
                                    commitRow(commit)
                                }
                                .buttonStyle(.plain)
                            } else {
                                commitRow(commit)
                            }
                        }
                        if comparison.commits.count > 30 {
                            Text("… và \(comparison.commits.count - 30) commit nữa").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .padding(.top, 6)
                } label: {
                    Text("\(comparison.commits.count)\(comparison.commits.count >= 300 ? "+" : "") commit có ở “Tới” mà “Từ” chưa có")
                        .font(.callout.weight(.semibold))
                }
            }
            if comparison.files.isEmpty {
                Text("Hai bản giống hệt nhau — không có file nào khác.")
                    .foregroundStyle(.secondary)
            } else {
                FileList(model: model, files: comparison.files, source: .compare(from: from, to: to))
            }
        }
    }

    private func commitRow(_ commit: Commit) -> some View {
        HStack(spacing: 8) {
            AvatarView(name: commit.authorName, email: commit.authorEmail, repo: model.githubRepo, size: 18)
            Text(commit.subject).lineLimit(1)
            Spacer(minLength: 4)
            Text(commit.shortSHA).font(.caption.monospaced()).foregroundStyle(.secondary)
        }
        .contentShape(Rectangle())
    }
}
