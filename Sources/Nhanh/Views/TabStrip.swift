import AppKit
import SwiftUI

/// Thanh tab tự vẽ ở hàng trên cùng của cửa sổ, cạnh 3 nút đỏ/vàng/xanh (như GitKraken): Trang chủ cố định ở đầu,
/// tab repo co giãn theo bề ngang, × để đóng, + mở tab mới, kéo để đổi chỗ, chuột phải để đóng nhiều tab;
/// nút "Có gì mới" ở cuối hàng.
struct TabStrip: View {
    @Bindable var tabs: TabsModel
    /// Chiều cao bằng thanh tiêu đề của cửa sổ để 3 nút đỏ/vàng/xanh nằm giữa hàng tab.
    let height: CGFloat

    /// Chừa chỗ cho 3 nút đỏ/vàng/xanh.
    private static let trafficLightsWidth: CGFloat = 78
    private static let addButtonWidth: CGFloat = 34
    private static let homeTabWidth: CGFloat = 40
    private static let trailingWidth: CGFloat = 44
    private static let minTabWidth: CGFloat = 72
    private static let maxTabWidth: CGFloat = 230

    var body: some View {
        GeometryReader { proxy in
            let others = tabs.tabs.dropFirst()
            let available = proxy.size.width - Self.trafficLightsWidth - Self.homeTabWidth - Self.addButtonWidth
                - Self.trailingWidth - 40
            let width = min(Self.maxTabWidth, max(Self.minTabWidth, available / CGFloat(max(others.count, 1))))
            HStack(spacing: 0) {
                Color.clear.frame(width: Self.trafficLightsWidth)
                HStack(spacing: 2) {
                    HomeTabButton(tabs: tabs, isSelected: tabs.selected.kind == .home)
                        .frame(width: Self.homeTabWidth)
                    ForEach(others) { tab in
                        TabButton(tab: tab, tabs: tabs, isSelected: tab.id == tabs.selectedID)
                            .frame(width: width)
                    }
                }
                Button { tabs.newTab() } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 13, weight: .semibold))
                        .frame(width: 26, height: 26)
                        .contentShape(Rectangle())
                }
                .buttonStyle(TabIconButtonStyle())
                .padding(.leading, 4)
                .help("Tab mới (⌘T)")
                Spacer(minLength: 0)
                Button { tabs.openReleaseNotes() } label: {
                    Image(systemName: "sparkles")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(tabs.selected.kind == .releaseNotes ? Brand.blue : .secondary)
                        .frame(width: 28, height: 26)
                        .contentShape(Rectangle())
                }
                .buttonStyle(TabIconButtonStyle())
                .help("Có gì mới trong Thaigit")
                .padding(.trailing, 10)
            }
            .frame(height: height)
        }
        .frame(height: height)
        // Chỉ vùng trống (nền) kéo được cửa sổ; kéo tab là để đổi chỗ tab.
        .background { Color(nsColor: .underPageBackgroundColor).windowDraggable() }
    }
}

/// Tab Trang chủ: chỉ có biểu tượng ngôi nhà, luôn ở đầu, không đóng / kéo được.
private struct HomeTabButton: View {
    let tabs: TabsModel
    let isSelected: Bool
    @State private var hovering = false

    var body: some View {
        Image(systemName: "house.fill")
            .font(.system(size: 13))
            .foregroundStyle(isSelected ? Brand.blue : .secondary)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(.vertical, 5)
            .background {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(isSelected ? Color(nsColor: .windowBackgroundColor) : Color.primary.opacity(hovering ? 0.07 : 0))
                    .shadow(color: .black.opacity(isSelected ? 0.12 : 0), radius: 1.5, y: 0.5)
                    .padding(.vertical, 5)
            }
            .contentShape(Rectangle())
            .onHover { hovering = $0 }
            .onTapGesture { tabs.select(tabs.home.id) }
            .help("Trang chủ — mở, clone, tạo repository (⌘1)")
    }
}

private struct TabButton: View {
    let tab: AppTab
    let tabs: TabsModel
    let isSelected: Bool
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 6) {
            Group {
                if tab.isLoading || tab.model?.busy != nil {
                    ProgressView().controlSize(.mini)
                } else {
                    Image(systemName: tab.systemImage)
                        .font(.system(size: 11))
                        .foregroundStyle(isSelected ? Brand.blue : .secondary)
                }
            }
            .frame(width: 14)
            Text(tab.title)
                .font(.system(size: 12, weight: isSelected ? .semibold : .regular))
                .foregroundStyle(isSelected ? .primary : .secondary)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: 0)
            Button { tabs.close(tab.id) } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 9, weight: .bold))
                    .frame(width: 16, height: 16)
                    .contentShape(Rectangle())
            }
            .buttonStyle(TabIconButtonStyle())
            .opacity(isSelected || hovering ? 1 : 0)
            .help("Đóng tab (⌘W)")
        }
        .padding(.leading, 10)
        .padding(.trailing, 6)
        .frame(maxHeight: .infinity)
        .padding(.vertical, 5)
        .background {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(isSelected ? Color(nsColor: .windowBackgroundColor) : Color.primary.opacity(hovering ? 0.07 : 0))
                .shadow(color: .black.opacity(isSelected ? 0.12 : 0), radius: 1.5, y: 0.5)
                .padding(.vertical, 5)
        }
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
        .onTapGesture { tabs.select(tab.id) }
        .help(tab.repositoryPath ?? tab.title)
        .draggable(tab.id.uuidString) {
            Label(tab.title, systemImage: tab.systemImage)
                .padding(6)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 6))
        }
        .dropDestination(for: String.self) { items, _ in
            guard let raw = items.first, let id = UUID(uuidString: raw) else { return false }
            tabs.move(id, onto: tab.id)
            return true
        }
        .contextMenu {
            Button("Đóng tab") { tabs.close(tab.id) }
            Button("Đóng các tab khác") { tabs.closeOthers(than: tab.id) }
                .disabled(tabs.tabs.count < 2)
            Button("Đóng các tab bên phải") { tabs.closeToTheRight(of: tab.id) }
                .disabled(tab.id == tabs.tabs.last?.id)
            if let path = tab.repositoryPath {
                Divider()
                Button("Hiện trong Finder") { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)]) }
                Button("Sao chép đường dẫn") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(path, forType: .string)
                }
            }
        }
    }
}

/// Nút biểu tượng nhỏ trên thanh tab: chỉ hiện nền khi rê chuột / bấm.
private struct TabIconButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        StyledBody(configuration: configuration)
    }

    private struct StyledBody: View {
        let configuration: Configuration
        @State private var hovering = false

        var body: some View {
            configuration.label
                .foregroundStyle(.secondary)
                .background(
                    RoundedRectangle(cornerRadius: 5)
                        .fill(Color.primary.opacity(configuration.isPressed ? 0.16 : hovering ? 0.09 : 0))
                )
                .onHover { hovering = $0 }
        }
    }
}

extension View {
    /// Kéo vùng trống của thanh tab để di chuyển cửa sổ, nhấp đúp để phóng to (như thanh tiêu đề thường).
    @ViewBuilder
    func windowDraggable() -> some View {
        if #available(macOS 15, *) {
            self.gesture(WindowDragGesture())
                .allowsWindowActivationEvents(true)
                .simultaneousGesture(TapGesture(count: 2).onEnded { NSApp.keyWindow?.performZoom(nil) })
        } else {
            self.simultaneousGesture(TapGesture(count: 2).onEnded { NSApp.keyWindow?.performZoom(nil) })
        }
    }
}
