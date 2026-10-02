import AppKit
import SwiftUI

/// Vùng sửa file ngay trong app: chữ đơn cách, có hoàn tác, tắt mọi tự thay thế của macOS (ngoặc kép cong, gạch ngang,
/// tự sửa chính tả…) để không đổi code ngoài ý muốn.
struct FileEditorView: View {
    @Bindable var session: FileEditorSession

    var body: some View {
        VStack(spacing: 0) {
            CodeTextView(text: $session.text)
            Divider()
            HStack(spacing: 12) {
                Text(session.file.usesCRLF ? "CRLF" : "LF")
                if session.file.hasBOM { Text("UTF-8 có BOM") } else { Text("UTF-8") }
                Text("\(session.text.utf8.reduce(into: 1) { count, byte in if byte == 0x0A { count += 1 } }) dòng")
                Spacer()
                Text("⌘S lưu · ⌘Z hoàn tác")
            }
            .font(.caption.monospacedDigit())
            .foregroundStyle(.secondary)
            .padding(.horizontal, 12)
            .padding(.vertical, 5)
            .background(.bar)
        }
    }
}

/// NSTextView thuần (không định dạng) bọc cho SwiftUI.
struct CodeTextView: NSViewRepresentable {
    @Binding var text: String

    func makeCoordinator() -> Coordinator { Coordinator(text: $text) }

    func makeNSView(context: Context) -> NSScrollView {
        let scrollView = NSTextView.scrollableTextView()
        guard let textView = scrollView.documentView as? NSTextView else { return scrollView }
        textView.delegate = context.coordinator
        textView.isRichText = false
        textView.importsGraphics = false
        textView.allowsUndo = true
        textView.usesFindBar = true
        textView.isIncrementalSearchingEnabled = true
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticDashSubstitutionEnabled = false
        textView.isAutomaticTextReplacementEnabled = false
        textView.isAutomaticSpellingCorrectionEnabled = false
        textView.isContinuousSpellCheckingEnabled = false
        textView.isGrammarCheckingEnabled = false
        textView.isAutomaticLinkDetectionEnabled = false
        textView.isAutomaticDataDetectionEnabled = false
        textView.isAutomaticTextCompletionEnabled = false
        textView.smartInsertDeleteEnabled = false
        textView.font = .monospacedSystemFont(ofSize: 12.5, weight: .regular)
        textView.textColor = .textColor
        textView.backgroundColor = .textBackgroundColor
        textView.textContainerInset = NSSize(width: 8, height: 10)
        textView.string = text
        DispatchQueue.main.async { textView.window?.makeFirstResponder(textView) }
        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        guard let textView = scrollView.documentView as? NSTextView, textView.string != text else { return }
        // Nội dung đổi từ ngoài (vừa lưu, mở file khác): thay cả văn bản, giữ chỗ con trỏ nếu còn hợp lệ.
        let selection = textView.selectedRanges
        textView.string = text
        let length = (text as NSString).length
        textView.selectedRanges = selection.filter { $0.rangeValue.upperBound <= length }
    }

    final class Coordinator: NSObject, NSTextViewDelegate {
        var text: Binding<String>

        init(text: Binding<String>) {
            self.text = text
        }

        func textDidChange(_ notification: Notification) {
            guard let textView = notification.object as? NSTextView else { return }
            text.wrappedValue = textView.string
        }
    }
}
