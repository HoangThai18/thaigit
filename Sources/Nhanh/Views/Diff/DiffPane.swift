import AppKit
import NhanhCore
import SwiftUI

/// Vùng diff thay chỗ graph khi mở một file (giống GitKraken). Esc để quay lại graph.
struct DiffPane: View {
    @Bindable var model: RepoModel
    @AppStorage(Prefs.diffSplit) private var split = false

    var body: some View {
        VStack(spacing: 0) {
            if let file = model.openFile {
                DiffHeader(model: model, file: file, split: $split)
                Divider()
            }
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(Color(nsColor: .textBackgroundColor))
        .overlay(alignment: .bottom) {
            if model.selectedLineCount > 0 {
                LineSelectionBar(model: model)
                    .padding(.bottom, 14)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.snappy(duration: 0.18), value: model.selectedLineCount)
    }

    @ViewBuilder
    private var content: some View {
        switch model.diffState {
        case .idle, .loading:
            ProgressView()
        case .text(let presentation):
            DiffTextView(model: model, presentation: presentation, split: split)
        case .binary(let diff, let images):
            if let images {
                ImageDiffView(images: images)
            } else {
                ContentUnavailableView("File nhị phân", systemImage: "doc.zipper",
                                       description: Text(diff?.isNewFile == true ? "File mới (nhị phân)" : "Không hiển thị được nội dung file nhị phân."))
            }
        case .tooLarge(let diff):
            ContentUnavailableView {
                Label("Diff rất lớn", systemImage: "exclamationmark.triangle")
            } description: {
                Text("\(diff.lineCount.formatted()) dòng thay đổi (+\(diff.additions) −\(diff.deletions)). Hiển thị có thể chậm.")
            } actions: {
                Button("Vẫn hiển thị") { model.showDiffAnyway() }
            }
        case .conflict(let file, let entry):
            ConflictResolverView(model: model, file: file, entry: entry)
                .id(entry.path)
        case .conflictWithoutMarkers(let entry):
            ConflictWithoutMarkersView(model: model, entry: entry)
        case .message(let text):
            ContentUnavailableView(text, systemImage: "doc.text.magnifyingglass")
        case .failed(let message):
            ContentUnavailableView {
                Label("Không tải được diff", systemImage: "xmark.octagon")
            } description: {
                Text(message).textSelection(.enabled)
            } actions: {
                Button("Thử lại") { model.loadDiff() }
            }
        }
    }
}

private struct DiffHeader: View {
    @Bindable var model: RepoModel
    let file: OpenFile
    @Binding var split: Bool

    private var sourceLabel: (String, Color) {
        switch file.source {
        case .unstaged: return ("Chưa stage", .orange)
        case .staged: return ("Đã stage", .green)
        case .commit(let sha): return ("Commit \(sha.prefix(7))", .blue)
        case .stash: return ("Stash", .purple)
        case .conflict: return ("Xung đột", .red)
        }
    }

    var body: some View {
        HStack(spacing: 10) {
            Button {
                model.closeFile()
            } label: {
                Label("Graph", systemImage: "chevron.left")
            }
            .glassButtonStyle()
            .keyboardShortcut(.cancelAction)
            .help("Quay lại graph (Esc)")

            ChangeIcon(kind: file.change.kind)
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 6) {
                    Text(file.change.fileName).font(.headline).lineLimit(1)
                    Text(sourceLabel.0)
                        .font(.caption2.weight(.semibold))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Capsule().fill(sourceLabel.1.opacity(0.18)))
                        .foregroundStyle(sourceLabel.1)
                }
                Text(file.change.oldPath.map { "\($0) → \(file.change.path)" } ?? file.change.path)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .textSelection(.enabled)
            }
            Spacer(minLength: 8)

            if case .text(let presentation) = model.diffState {
                HStack(spacing: 6) {
                    Text("+\(presentation.diff.additions)").foregroundStyle(.green)
                    Text("−\(presentation.diff.deletions)").foregroundStyle(.red)
                }
                .font(.callout.monospacedDigit().weight(.semibold))

                Picker("", selection: $split) {
                    Image(systemName: "rectangle.grid.1x2").tag(false).help("Gộp (unified)")
                    Image(systemName: "rectangle.split.2x1").tag(true).help("Tách đôi (trước | sau)")
                }
                .pickerStyle(.segmented)
                .frame(width: 84)
            }

            switch file.source {
            case .unstaged:
                Button(role: .destructive) { model.discard([file.change]) } label: {
                    Label("Huỷ", systemImage: "arrow.uturn.backward")
                }
                .glassButtonStyle()
                .help("Huỷ mọi thay đổi chưa stage của file")
                Button { model.stage([file.change]) } label: {
                    Label("Stage file", systemImage: "plus.circle.fill")
                }
                .glassButtonStyle(prominent: true)
                .tint(.green)
            case .staged:
                Button { model.unstage([file.change]) } label: {
                    Label("Bỏ stage file", systemImage: "minus.circle.fill")
                }
                .glassButtonStyle(prominent: true)
                .tint(.red)
            default:
                EmptyView()
            }

            Menu {
                MenuSpecContent(items: model.fileMenu(file.change, source: file.source))
            } label: {
                Image(systemName: "ellipsis.circle")
            }
            .menuStyle(.borderlessButton)
            .fixedSize()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.bar)
    }
}

private struct LineSelectionBar: View {
    @Bindable var model: RepoModel

    var body: some View {
        HStack(spacing: 10) {
            Text("Đã chọn \(model.selectedLineCount) dòng")
                .font(.callout.weight(.semibold))
            if model.openFile?.source == .unstaged {
                Button { model.applySelectedLines(.stage) } label: { Label("Stage dòng", systemImage: "plus.circle.fill") }
                    .glassButtonStyle(prominent: true)
                    .tint(.green)
                Button(role: .destructive) { model.applySelectedLines(.discard) } label: { Label("Huỷ dòng", systemImage: "arrow.uturn.backward") }
                    .glassButtonStyle()
            } else if model.openFile?.source == .staged {
                Button { model.applySelectedLines(.unstage) } label: { Label("Bỏ stage dòng", systemImage: "minus.circle.fill") }
                    .glassButtonStyle(prominent: true)
                    .tint(.red)
            }
            Button("Bỏ chọn") { model.clearLineSelection() }
                .glassButtonStyle()
        }
        .fixedSize()
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .glassSurface(in: Capsule())
    }
}

/// Thông số chữ đơn cách để tính độ rộng nội dung (cuộn ngang thay vì xuống dòng).
private struct DiffMetrics {
    static let font = NSFont.monospacedSystemFont(ofSize: 12, weight: .regular)
    static let charWidth: CGFloat = {
        let attributes: [NSAttributedString.Key: Any] = [.font: font]
        return ceil(NSAttributedString(string: String(repeating: "M", count: 100), attributes: attributes).size().width) / 100
    }()
    static let lineHeight: CGFloat = 19

    let numberWidth: CGFloat
    let textWidth: CGFloat

    init(_ presentation: DiffPresentation) {
        let digits = max(3, String(presentation.maxLineNumber).count)
        numberWidth = CGFloat(digits) * Self.charWidth + 12
        textWidth = CGFloat(max(presentation.maxLineLength, 20)) * Self.charWidth + 24
    }
}

private struct DiffTextView: View {
    @Bindable var model: RepoModel
    let presentation: DiffPresentation
    let split: Bool

    var body: some View {
        let metrics = DiffMetrics(presentation)
        let selectable = model.canSelectLines
        GeometryReader { proxy in
            if split {
                // Hai cột bằng nhau, dòng dài tự xuống dòng — không cần cuộn ngang.
                let halfWidth = max(240, floor((proxy.size.width - 1) / 2))
                ScrollView(.vertical) {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(presentation.hunks) { hunk in
                            HunkHeader(model: model, hunk: hunk)
                            ForEach(Array(hunk.splitRows.enumerated()), id: \.offset) { _, row in
                                SplitRowView(row: row, numberWidth: metrics.numberWidth, halfWidth: halfWidth,
                                             selection: model.lineSelection[hunk.id] ?? [], selectable: selectable) { index, extend in
                                    model.toggleLine(hunk: hunk, index: index, extend: extend)
                                }
                            }
                        }
                        Color.clear.frame(height: 60)
                    }
                    .frame(width: halfWidth * 2 + 1, alignment: .leading)
                }
            } else {
                let contentWidth = max(metrics.numberWidth * 2 + 20 + metrics.textWidth, proxy.size.width)
                ScrollView([.vertical, .horizontal]) {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(presentation.hunks) { hunk in
                            HunkHeader(model: model, hunk: hunk)
                            ForEach(hunk.lines, id: \.index) { line in
                                UnifiedLineView(line: line, metrics: metrics,
                                                isSelected: model.lineSelection[hunk.id]?.contains(line.index) == true,
                                                selectable: selectable && (line.kind == .addition || line.kind == .deletion)) { extend in
                                    model.toggleLine(hunk: hunk, index: line.index, extend: extend)
                                }
                            }
                        }
                        Color.clear.frame(height: 60)
                    }
                    .frame(width: contentWidth, alignment: .leading)
                }
                .defaultScrollAnchor(.topLeading)
            }
        }
        .background(Color(nsColor: .textBackgroundColor))
    }
}

private struct HunkHeader: View {
    @Bindable var model: RepoModel
    let hunk: DiffPresentation.Hunk

    var body: some View {
        HStack(spacing: 8) {
            if model.canSelectLines || model.openFile?.source == .unstaged || model.openFile?.source == .staged {
                actionButtons
            }
            Text(hunk.header)
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .fixedSize()
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 10)
        .frame(height: 30)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.accentColor.opacity(0.07))
        .overlay(alignment: .top) { Divider() }
    }

    @ViewBuilder
    private var actionButtons: some View {
        let partial = model.canSelectLines
        switch model.openFile?.source {
        case .unstaged?:
            if partial {
                Button { model.apply(.stage, hunk: hunk) } label: { Label("Stage hunk", systemImage: "plus.circle.fill") }
                    .controlSize(.small)
                    .tint(.green)
                    .glassButtonStyle(prominent: true)
                Button(role: .destructive) { model.apply(.discard, hunk: hunk) } label: { Label("Huỷ hunk", systemImage: "arrow.uturn.backward") }
                    .controlSize(.small)
                    .glassButtonStyle()
            }
        case .staged?:
            if partial {
                Button { model.apply(.unstage, hunk: hunk) } label: { Label("Bỏ stage hunk", systemImage: "minus.circle.fill") }
                    .controlSize(.small)
                    .tint(.red)
                    .glassButtonStyle(prominent: true)
            }
        default:
            EmptyView()
        }
    }
}

private enum DiffColors {
    static let addition = Color.green.opacity(0.13)
    static let deletion = Color.red.opacity(0.13)
    static let additionStrong = Color.green.opacity(0.32)
    static let deletionStrong = Color.red.opacity(0.32)
    static let selected = Color.accentColor.opacity(0.28)
    static let gutterAddition = Color.green.opacity(0.2)
    static let gutterDeletion = Color.red.opacity(0.2)
}

private func attributedText(_ line: DiffPresentation.Line) -> AttributedString {
    var text = AttributedString(line.text.isEmpty ? " " : line.text)
    if let range = line.highlight, !line.text.isEmpty, range.lowerBound < line.text.count {
        let characters = text.characters
        let start = characters.index(characters.startIndex, offsetBy: range.lowerBound)
        let end = characters.index(characters.startIndex, offsetBy: min(range.upperBound, line.text.count))
        if start < end {
            text[start..<end].backgroundColor = line.kind == .addition ? DiffColors.additionStrong : DiffColors.deletionStrong
        }
    }
    return text
}

private struct UnifiedLineView: View {
    let line: DiffPresentation.Line
    let metrics: DiffMetrics
    let isSelected: Bool
    let selectable: Bool
    let onTap: (Bool) -> Void

    var body: some View {
        if line.kind == .noNewline {
            Text("⏎ Không có xuống dòng ở cuối file")
                .font(.system(size: 11).italic())
                .foregroundStyle(.tertiary)
                .padding(.leading, metrics.numberWidth * 2 + 20)
                .frame(height: 16)
        } else {
            HStack(spacing: 0) {
                Text(line.oldNumber.map(String.init) ?? "")
                    .frame(width: metrics.numberWidth, alignment: .trailing)
                Text(line.newNumber.map(String.init) ?? "")
                    .frame(width: metrics.numberWidth, alignment: .trailing)
                Text(marker)
                    .frame(width: 20)
                    .foregroundStyle(markerColor)
                Text(attributedText(line))
                    .foregroundStyle(Color.primary)
                    .fixedSize()
                Spacer(minLength: 0)
            }
            .font(Font(DiffMetrics.font))
            .foregroundStyle(.secondary)
            .frame(height: DiffMetrics.lineHeight)
            .background(background)
            .overlay(alignment: .leading) {
                if isSelected {
                    Rectangle().fill(Color.accentColor).frame(width: 3)
                }
            }
            .contentShape(Rectangle())
            .onTapGesture {
                guard selectable else { return }
                onTap(NSEvent.modifierFlags.contains(.shift))
            }
            .help(selectable ? "Bấm để chọn dòng (Shift+bấm để chọn liên tiếp), rồi Stage/Huỷ ở thanh bên dưới" : "")
        }
    }

    private var marker: String {
        switch line.kind {
        case .addition: return "+"
        case .deletion: return "−"
        default: return ""
        }
    }

    private var markerColor: Color {
        switch line.kind {
        case .addition: return .green
        case .deletion: return .red
        default: return .secondary
        }
    }

    private var background: Color {
        if isSelected { return DiffColors.selected }
        switch line.kind {
        case .addition: return DiffColors.addition
        case .deletion: return DiffColors.deletion
        default: return .clear
        }
    }
}

private struct SplitRowView: View {
    let row: DiffPresentation.SplitRow
    let numberWidth: CGFloat
    let halfWidth: CGFloat
    let selection: Set<Int>
    let selectable: Bool
    let onTap: (Int, Bool) -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            half(row.left, isLeft: true)
            Rectangle().fill(Color.primary.opacity(0.1)).frame(width: 1)
            half(row.right, isLeft: false)
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder
    private func half(_ line: DiffPresentation.Line?, isLeft: Bool) -> some View {
        if let line {
            let isChange = line.kind == .addition || line.kind == .deletion
            let isSelected = selection.contains(line.index) && isChange
            HStack(alignment: .top, spacing: 0) {
                Text((isLeft ? line.oldNumber : line.newNumber).map(String.init) ?? "")
                    .frame(width: numberWidth, alignment: .trailing)
                    .foregroundStyle(.secondary)
                Text(line.kind == .addition ? "+" : (line.kind == .deletion ? "−" : ""))
                    .frame(width: 18)
                    .foregroundStyle(line.kind == .addition ? Color.green : Color.red)
                Text(attributedText(line))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .font(Font(DiffMetrics.font))
            .padding(.vertical, 1.5)
            .padding(.trailing, 6)
            .frame(width: halfWidth, alignment: .topLeading)
            .frame(maxHeight: .infinity, alignment: .top)
            .background(isSelected ? DiffColors.selected : (line.kind == .addition ? DiffColors.addition : (line.kind == .deletion ? DiffColors.deletion : Color.clear)))
            .overlay(alignment: .leading) {
                if isSelected { Rectangle().fill(Color.accentColor).frame(width: 3) }
            }
            .contentShape(Rectangle())
            .onTapGesture {
                guard selectable, isChange else { return }
                onTap(line.index, NSEvent.modifierFlags.contains(.shift))
            }
        } else {
            Color.primary.opacity(0.035)
                .frame(width: halfWidth)
                .frame(maxHeight: .infinity)
        }
    }
}

private struct ImageDiffView: View {
    let images: ImagePair

    var body: some View {
        HStack(spacing: 24) {
            ImageBox(title: "Trước", image: images.before, tint: .red)
            Image(systemName: "arrow.right").font(.title).foregroundStyle(.tertiary)
            ImageBox(title: "Sau", image: images.after, tint: .green)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct ImageBox: View {
    let title: String
    let image: NSImage?
    let tint: Color

    var body: some View {
        VStack(spacing: 8) {
            Text(title).font(.headline).foregroundStyle(tint)
            ZStack {
                CheckerboardBackground()
                if let image {
                    // Không phóng to ảnh quá kích thước thật (tránh mờ); icon rất nhỏ thì phóng kiểu pixel.
                    let natural = image.size
                    Image(nsImage: image)
                        .resizable()
                        .interpolation(natural.width < 64 ? .none : .high)
                        .aspectRatio(contentMode: .fit)
                        .frame(maxWidth: max(natural.width, 128), maxHeight: max(natural.height, 128))
                        .padding(8)
                } else {
                    Text("(không có)").foregroundStyle(.secondary)
                }
            }
            .frame(minWidth: 200, maxWidth: 520, minHeight: 200, maxHeight: 520)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(tint.opacity(0.5), lineWidth: 2))
            if let image {
                Text(Self.pixelSize(of: image))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
        }
    }
}

extension ImageBox {
    /// Kích thước thật theo pixel (NSImage.size là point, ảnh @2x sẽ bị chia đôi).
    static func pixelSize(of image: NSImage) -> String {
        let pixels = image.representations.map { ($0.pixelsWide, $0.pixelsHigh) }.max { $0.0 * $0.1 < $1.0 * $1.1 }
        if let (width, height) = pixels, width > 0, height > 0 { return "\(width) × \(height) px" }
        return "\(Int(image.size.width)) × \(Int(image.size.height))"
    }
}

private struct CheckerboardBackground: View {
    var body: some View {
        Canvas { context, size in
            let cell: CGFloat = 10
            for row in 0..<Int(size.height / cell) + 1 {
                for column in 0..<Int(size.width / cell) + 1 where (row + column).isMultiple(of: 2) {
                    context.fill(Path(CGRect(x: CGFloat(column) * cell, y: CGFloat(row) * cell, width: cell, height: cell)),
                                 with: .color(Color.primary.opacity(0.06)))
                }
            }
        }
    }
}
