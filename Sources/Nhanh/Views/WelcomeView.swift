import AppKit
import NhanhCore
import SwiftUI

struct WelcomeView: View {
    @Environment(AppState.self) private var appState
    var error: String?
    var onOpen: (String) -> Void
    var onClone: () -> Void
    var onInit: () -> Void
    @State private var isDropTargeted = false

    var body: some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 22) {
                HStack(spacing: 14) {
                    Image(nsImage: NSApp.applicationIconImage)
                        .resizable()
                        .frame(width: 72, height: 72)
                        .shadow(color: Brand.blue.opacity(0.25), radius: 12, y: 4)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Thaigit")
                            .font(.system(size: 34, weight: .bold, design: .rounded))
                            .foregroundStyle(LinearGradient(colors: [Brand.orange, Brand.blue], startPoint: .leading, endPoint: .trailing))
                        Text("Git client trực quan, miễn phí")
                            .foregroundStyle(.secondary)
                    }
                }

                VStack(spacing: 10) {
                    WelcomeActionButton(title: String(localized: "Mở repository"), subtitle: String(localized: "Chọn một thư mục có sẵn trên máy"),
                                        systemImage: "folder.fill", tint: Brand.blue, shortcut: "⌘O") {
                        if let path = appState.chooseRepositoryFolder() { onOpen(path) }
                    }
                    WelcomeActionButton(title: "Clone repository", subtitle: String(localized: "Tải về từ GitHub, GitLab, Bitbucket…"),
                                        systemImage: "arrow.down.circle.fill", tint: .green, shortcut: "⇧⌘O", action: onClone)
                    WelcomeActionButton(title: String(localized: "Tạo repository mới"), subtitle: String(localized: "Khởi tạo Git cho một thư mục"),
                                        systemImage: "plus.square.fill", tint: Brand.orange, shortcut: "⌥⌘N", action: onInit)
                }

                if let error {
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red)
                        .font(.callout)
                        .textSelection(.enabled)
                        .padding(10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.red.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
                }

                Spacer()

                VStack(alignment: .leading, spacing: 4) {
                    Text("Mẹo: kéo thả một thư mục vào cửa sổ này hoặc vào biểu tượng Dock để mở nhanh.")
                    if let version = appState.gitVersion {
                        Text("\(version) · \(appState.gitExecutablePath)")
                    }
                }
                .font(.caption)
                .foregroundStyle(.tertiary)
            }
            .padding(36)
            .frame(width: 420)
            .frame(maxHeight: .infinity)

            VStack(alignment: .leading, spacing: 12) {
                Text("Mở gần đây")
                    .font(.headline)
                    .padding(.horizontal, 24)
                    .padding(.top, 28)
                if appState.recentRepositories.isEmpty {
                    ContentUnavailableView("Chưa có repository nào", systemImage: "clock.arrow.circlepath",
                                           description: Text("Repository bạn mở sẽ hiện ở đây."))
                } else {
                    List {
                        ForEach(appState.recentRepositories, id: \.self) { path in
                            RecentRepositoryRow(path: path) { onOpen(path) } onRemove: {
                                appState.removeRecent(path)
                            }
                        }
                    }
                    .listStyle(.inset)
                    .scrollContentBackground(.hidden)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .glassSurface(in: RoundedRectangle(cornerRadius: 24))
            .padding([.vertical, .trailing], 20)
        }
        .background(BrandBackground())
        .overlay {
            if isDropTargeted {
                RoundedRectangle(cornerRadius: 16)
                    .strokeBorder(Color.accentColor, style: StrokeStyle(lineWidth: 3, dash: [10, 6]))
                    .padding(12)
                    .overlay(Text("Thả thư mục để mở").font(.title2.bold()).foregroundStyle(Color.accentColor))
                    .allowsHitTesting(false)
            }
        }
        .dropDestination(for: URL.self) { urls, _ in
            guard let url = urls.first(where: \.hasDirectoryPath) ?? urls.first else { return false }
            onOpen(url.path)
            return true
        } isTargeted: { isDropTargeted = $0 }
    }
}

private struct WelcomeActionButton: View {
    let title: String
    let subtitle: String
    let systemImage: String
    let tint: Color
    let shortcut: String
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: systemImage)
                    .font(.system(size: 22))
                    .foregroundStyle(tint)
                    .frame(width: 30)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.body.weight(.semibold))
                    Text(subtitle).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Text(shortcut)
                    .font(.caption.monospaced())
                    .foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .contentShape(RoundedRectangle(cornerRadius: 16))
            .glassSurface(in: RoundedRectangle(cornerRadius: 16), tint: hovering ? tint.opacity(0.25) : nil, interactive: true)
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
    }
}

private struct RecentRepositoryRow: View {
    let path: String
    let onOpen: () -> Void
    let onRemove: () -> Void
    @State private var hovering = false

    private var exists: Bool { FileManager.default.fileExists(atPath: path) }

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: exists ? "folder.fill" : "questionmark.folder")
                .foregroundStyle(exists ? Color.accentColor : .secondary)
                .font(.title3)
            VStack(alignment: .leading, spacing: 2) {
                Text((path as NSString).lastPathComponent)
                    .font(.body.weight(.medium))
                Text((path as NSString).abbreviatingWithTildeInPath)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            Spacer()
            if hovering {
                Button(action: onRemove) {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .help("Xoá khỏi danh sách")
            }
        }
        .padding(.vertical, 4)
        .opacity(exists ? 1 : 0.5)
        .contentShape(Rectangle())
        .onTapGesture(perform: onOpen)
        .onHover { hovering = $0 }
        .help(path)
    }
}
