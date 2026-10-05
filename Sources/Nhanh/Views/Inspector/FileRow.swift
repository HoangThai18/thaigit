import NhanhCore
import SwiftUI

/// Biểu tượng loại thay đổi (thêm/sửa/xoá/đổi tên…).
struct ChangeIcon: View {
    let kind: ChangeKind

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(color)
            .frame(width: 16)
            .help(description)
    }

    private var symbol: String {
        switch kind {
        case .added: return "plus.square.fill"
        case .untracked: return "plus.square.dashed"
        case .modified: return "pencil.circle.fill"
        case .deleted: return "minus.square.fill"
        case .renamed, .copied: return "arrow.right.square.fill"
        case .typeChanged: return "arrow.triangle.2.circlepath"
        case .conflicted: return "exclamationmark.triangle.fill"
        case .unknown: return "questionmark.square"
        }
    }

    private var color: Color {
        switch kind {
        case .added, .untracked: return .green
        case .modified, .typeChanged: return .orange
        case .deleted: return .red
        case .renamed, .copied: return .blue
        case .conflicted: return .orange
        case .unknown: return .secondary
        }
    }

    private var description: String {
        switch kind {
        case .added: return String(localized: "Thêm mới")
        case .untracked: return String(localized: "File mới (chưa track)")
        case .modified: return String(localized: "Đã sửa")
        case .deleted: return String(localized: "Đã xoá")
        case .renamed: return String(localized: "Đổi tên")
        case .copied: return String(localized: "Sao chép")
        case .typeChanged: return String(localized: "Đổi loại file")
        case .conflicted: return String(localized: "Xung đột")
        case .unknown: return String(localized: "Khác")
        }
    }
}

/// Một dòng file: biểu tượng, tên file, thư mục, nút nhanh khi rê chuột.
struct FileRow: View {
    let change: FileChange
    var quickActionTitle: String?
    var quickActionSymbol: String?
    var quickActionTint: Color = .accentColor
    var quickAction: (() -> Void)?
    /// Dạng cây: thư mục đã có ở hàng cha nên không lặp lại.
    var showDirectory = true
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 6) {
            ChangeIcon(kind: change.kind)
            Text(change.fileName)
                .lineLimit(1)
                .layoutPriority(1)
            if showDirectory, !change.directory.isEmpty {
                Text(change.directory)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.head)
            }
            Spacer(minLength: 2)
            if let quickAction, let quickActionSymbol {
                Button(action: quickAction) {
                    Image(systemName: quickActionSymbol)
                        .font(.system(size: 14))
                        .foregroundStyle(quickActionTint)
                }
                .buttonStyle(.plain)
                .help(quickActionTitle ?? "")
                .opacity(hovering ? 1 : 0)
            }
        }
        .font(.callout)
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
        .help(change.oldPath.map { "\($0) → \(change.path)" } ?? change.path)
    }
}

/// Ảnh đại diện của tác giả (GitHub / Gravatar theo `email`); chưa có ảnh thì vòng tròn chữ cái đầu.
struct AvatarView: View {
    let name: String
    var email: String?
    /// Repo GitHub giúp tìm ảnh qua API commit.
    var repo: GitHubRepoRef?
    var size: CGFloat = 28

    var body: some View {
        // Đọc `version` để vẽ lại khi ảnh tải xong.
        let _ = AvatarStore.shared.version
        if let email, let image = AvatarStore.shared.image(email: email, repo: repo) {
            Image(nsImage: image)
                .resizable()
                .interpolation(.high)
                .scaledToFill()
                .frame(width: size, height: size)
                .clipShape(Circle())
                .overlay(Circle().strokeBorder(.white.opacity(0.25), lineWidth: 0.5))
        } else {
            Circle()
                .fill(color)
                .frame(width: size, height: size)
                .overlay(
                    Text(GraphStyle.initials(name))
                        .font(.system(size: size * 0.38, weight: .bold))
                        .foregroundStyle(.white)
                )
        }
    }

    private var color: Color {
        var hash = 5381
        for scalar in name.unicodeScalars { hash = ((hash << 5) &+ hash) &+ Int(scalar.value) }
        return Color(nsColor: GraphStyle.palette[abs(hash) % GraphStyle.palette.count])
    }
}
