import SwiftUI

/// Panel terminal đơn giản dưới graph / diff: output, ô gõ lệnh, kéo mép trên để đổi chiều cao.
struct TerminalPanel: View {
    let model: RepoModel
    @Bindable var session: TerminalSession
    @FocusState private var inputFocused: Bool
    @State private var dragStart: CGFloat?

    var body: some View {
        VStack(spacing: 0) {
            resizeHandle
            header
            Divider()
            output
            Divider()
            inputRow
        }
        .frame(height: session.height)
        .background(Color(nsColor: .textBackgroundColor))
        .onAppear { inputFocused = true }
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
                    session.height = min(max(start - value.translation.height, 120), 640)
                }
                .onEnded { _ in dragStart = nil })
    }

    private var header: some View {
        HStack(spacing: 8) {
            Image(systemName: "terminal")
                .foregroundStyle(.secondary)
            Text("Terminal")
                .font(.callout.weight(.semibold))
            Text(session.promptPath)
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .truncationMode(.head)
            Spacer()
            if session.isRunning {
                ProgressView().controlSize(.small)
                Button("Dừng") { session.stop() }
                    .buttonStyle(.borderless)
                    .keyboardShortcut("c", modifiers: .control)
                    .help("Dừng lệnh đang chạy (⌃C)")
            }
            Button { session.clear() } label: { Image(systemName: "trash") }
                .buttonStyle(.borderless)
                .help("Xoá màn hình (hoặc gõ clear)")
            Button { model.openInTerminal() } label: { Image(systemName: "arrow.up.forward.app") }
                .buttonStyle(.borderless)
                .help("Mở Terminal của macOS ở thư mục repo — dùng khi cần chương trình tương tác (vim, ssh…)")
            Button { model.toggleTerminal() } label: { Image(systemName: "xmark") }
                .buttonStyle(.borderless)
                .help("Đóng terminal (⌃`)")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 5)
    }

    private var output: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 1) {
                    if session.lines.isEmpty {
                        Text("Gõ lệnh rồi nhấn ↩ — chạy trong thư mục repo. Mỗi lệnh chạy riêng, không tương tác: không dùng được vim, less hay lệnh hỏi mật khẩu.")
                            .foregroundStyle(.secondary)
                            .padding(.vertical, 4)
                    }
                    ForEach(session.lines) { line in
                        Text(line.text.isEmpty ? " " : line.text)
                            .foregroundStyle(color(line.kind))
                            .fontWeight(line.kind == .command ? .semibold : .regular)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .id(line.id)
                    }
                }
                .font(.system(size: 12, design: .monospaced))
                .textSelection(.enabled)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
            }
            .onChange(of: session.lines.last?.id) { _, id in
                if let id { proxy.scrollTo(id, anchor: .bottom) }
            }
        }
    }

    private var inputRow: some View {
        HStack(spacing: 6) {
            Text("❯")
                .foregroundStyle(Color.accentColor)
            TextField(session.isRunning ? "Đang chạy…" : "Lệnh, ví dụ git status", text: $session.input)
                .textFieldStyle(.plain)
                .font(.system(size: 12.5, design: .monospaced))
                .focused($inputFocused)
                .disabled(session.isRunning)
                .onSubmit {
                    session.run()
                    inputFocused = true
                }
                .onKeyPress(.upArrow) { session.recall(-1); return .handled }
                .onKeyPress(.downArrow) { session.recall(1); return .handled }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
    }

    private func color(_ kind: TerminalSession.Kind) -> Color {
        switch kind {
        case .command: return .primary
        case .output: return .primary.opacity(0.85)
        case .error: return .red
        case .info: return .secondary
        }
    }
}
