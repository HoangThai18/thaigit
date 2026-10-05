import AppKit
import SwiftTerm
import SwiftUI

/// Panel terminal dưới graph / diff (như GitKraken): thanh tab, nút thêm tab, kéo mép trên để đổi chiều cao.
struct TerminalPanel: View {
    let model: RepoModel
    @Bindable var session: TerminalSession
    @State private var dragStart: CGFloat?

    var body: some View {
        VStack(spacing: 0) {
            resizeHandle
            header
            Divider()
            if let tab = session.selected {
                TerminalHost(view: tab.view)
                    .id(tab.id)
                    .padding(.leading, 6)
            } else {
                Color.clear
            }
        }
        .frame(height: session.height)
        .background(Color(nsColor: .textBackgroundColor))
    }

    private var resizeHandle: some View {
        Rectangle()
            .fill(Color.primary.opacity(0.12))
            .frame(height: 1)
            .padding(.vertical, 2)
            .contentShape(Rectangle())
            .onHover { inside in
                if inside { NSCursor.resizeUpDown.push() } else { NSCursor.pop() }
            }
            .gesture(DragGesture(minimumDistance: 1, coordinateSpace: .global)
                .onChanged { value in
                    let start = dragStart ?? session.height
                    dragStart = start
                    session.height = min(max(start - value.translation.height, 120), 900)
                }
                .onEnded { _ in dragStart = nil })
    }

    private var header: some View {
        HStack(spacing: 4) {
            Image(systemName: "apple.terminal")
                .foregroundStyle(.secondary)
                .padding(.trailing, 4)
            ForEach(session.tabs) { tab in
                TabChip(title: tab.title, selected: tab.id == session.selected?.id,
                        onSelect: { session.selectedID = tab.id },
                        onClose: { session.close(tab) })
            }
            Button {
                session.newTab()
            } label: {
                Image(systemName: "plus")
            }
            .buttonStyle(.borderless)
            .help("Thêm tab terminal")
            Spacer()
            Button {
                withAnimation(.snappy(duration: 0.2)) { session.isVisible = false }
            } label: {
                Image(systemName: "chevron.down")
            }
            .buttonStyle(.borderless)
            .help("Ẩn terminal (⌃`) — các lệnh đang chạy vẫn tiếp tục")
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 4)
    }
}

private struct TabChip: View {
    let title: String
    let selected: Bool
    let onSelect: () -> Void
    let onClose: () -> Void
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 4) {
            Text(title)
                .font(.caption)
                .lineLimit(1)
            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(.system(size: 8, weight: .bold))
            }
            .buttonStyle(.borderless)
            .opacity(selected || hovering ? 1 : 0)
            .help("Đóng tab (dừng shell của tab này)")
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(RoundedRectangle(cornerRadius: 6).fill(selected ? Color.primary.opacity(0.1) : Color.clear))
        .contentShape(Rectangle())
        .onTapGesture(perform: onSelect)
        .onHover { hovering = $0 }
    }
}

/// Đặt `LocalProcessTerminalView` có sẵn của tab vào SwiftUI (không tạo lại khi panel vẽ lại) và đưa focus vào terminal.
private struct TerminalHost: NSViewRepresentable {
    let view: LocalProcessTerminalView

    func makeNSView(context: Context) -> NSView {
        let container = NSView()
        attach(to: container)
        return container
    }

    func updateNSView(_ container: NSView, context: Context) {
        if view.superview !== container { attach(to: container) }
    }

    private func attach(to container: NSView) {
        view.removeFromSuperview()
        view.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(view)
        NSLayoutConstraint.activate([
            view.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            view.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            view.topAnchor.constraint(equalTo: container.topAnchor),
            view.bottomAnchor.constraint(equalTo: container.bottomAnchor),
        ])
        let terminal = view
        DispatchQueue.main.async { terminal.window?.makeFirstResponder(terminal) }
    }
}
