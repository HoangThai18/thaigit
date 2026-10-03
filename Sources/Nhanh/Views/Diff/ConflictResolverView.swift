import NhanhCore
import SwiftUI

/// Giải quyết xung đột từng đoạn: chọn bản Current, Incoming hoặc cả hai — không cần mở editor.
struct ConflictResolverView: View {
    @Bindable var model: RepoModel
    let file: ConflictFile
    let entry: ConflictEntry
    @State private var choices: [Int: ConflictFile.Resolution] = [:]

    private var resolvedCount: Int { choices.count }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(file.conflictCount) đoạn xung đột")
                        .font(.headline)
                    Text("“Current” là bản trên nhánh hiện tại (HEAD), “Incoming” là bản đang được đưa vào.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button("Dùng toàn bộ Current") { model.resolveConflict(entry, useOurs: true) }
                    .glassButtonStyle()
                Button("Dùng toàn bộ Incoming") { model.resolveConflict(entry, useOurs: false) }
                    .glassButtonStyle()
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .glassSurface(in: RoundedRectangle(cornerRadius: 16), tint: Brand.orange.opacity(0.18))
            .padding([.horizontal, .top], 10)

            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    ForEach(Array(file.segments.enumerated()), id: \.offset) { _, segment in
                        switch segment {
                        case .common(let lines):
                            CommonSegment(lines: lines)
                        case .conflict(let block):
                            ConflictBlockView(block: block, total: file.conflictCount, choice: $choices[block.id])
                        }
                    }
                }
                .padding(16)
            }

            HStack(spacing: 12) {
                ProgressView(value: Double(resolvedCount), total: Double(max(file.conflictCount, 1)))
                    .frame(width: 120)
                Text("Đã chọn \(resolvedCount)/\(file.conflictCount)")
                    .font(.callout.monospacedDigit())
                Spacer()
                Button("Mở bằng trình soạn thảo") { model.openInEditor(path: entry.path) }
                    .glassButtonStyle()
                Button("Chọn lại") { choices = [:] }
                    .glassButtonStyle()
                    .disabled(choices.isEmpty)
                Button {
                    model.saveConflictResolution(entry, file: file, choices: choices)
                } label: {
                    Label("Lưu & đánh dấu đã giải quyết", systemImage: "checkmark.circle.fill")
                }
                .glassButtonStyle(prominent: true)
                .disabled(resolvedCount < file.conflictCount)
                .keyboardShortcut(.return, modifiers: .command)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .glassSurface(in: Capsule())
            .padding(10)
        }
        .onChange(of: file) { choices = [:] }
    }
}

private struct CommonSegment: View {
    let lines: [String]
    @State private var expanded = false

    var body: some View {
        if lines.count <= 8 || expanded {
            CodeLines(lines: lines)
                .foregroundStyle(.secondary)
        } else {
            VStack(alignment: .leading, spacing: 0) {
                CodeLines(lines: Array(lines.prefix(3)))
                Button("… \(lines.count - 6) dòng không đổi — bấm để xem") { expanded = true }
                    .buttonStyle(.link)
                    .font(.caption)
                    .padding(.vertical, 4)
                CodeLines(lines: Array(lines.suffix(3)))
            }
            .foregroundStyle(.secondary)
        }
    }
}

private struct ConflictBlockView: View {
    let block: ConflictFile.Block
    let total: Int
    @Binding var choice: ConflictFile.Resolution?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text("Xung đột \(block.id + 1)/\(total)")
                    .font(.subheadline.weight(.semibold))
                if choice != nil {
                    Label("Đã chọn", systemImage: "checkmark.circle.fill")
                        .font(.caption)
                        .foregroundStyle(.green)
                }
                Spacer()
                ChoiceButton(title: String(localized: "Giữ Current"), isOn: choice == .ours, tint: .blue) { choice = .ours }
                ChoiceButton(title: String(localized: "Giữ Incoming"), isOn: choice == .theirs, tint: .purple) { choice = .theirs }
                ChoiceButton(title: String(localized: "Giữ cả hai"), isOn: choice == .oursThenTheirs, tint: .teal) { choice = .oursThenTheirs }
                Menu {
                    Button("Cả hai (Incoming trước)") { choice = .theirsThenOurs }
                    if block.base != nil {
                        Button("Bản gốc (base)") { choice = .base }
                    }
                    Button("Bỏ cả hai") { choice = .neither }
                    if choice != nil {
                        Divider()
                        Button("Bỏ chọn") { choice = nil }
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                .menuStyle(.borderlessButton)
                .fixedSize()
            }
            HStack(alignment: .top, spacing: 8) {
                SideColumn(title: "Current", label: block.oursLabel, lines: block.ours, tint: .blue,
                           highlighted: choice == .ours || choice == .oursThenTheirs || choice == .theirsThenOurs) {
                    choice = .ours
                }
                SideColumn(title: "Incoming", label: block.theirsLabel, lines: block.theirs, tint: .purple,
                           highlighted: choice == .theirs || choice == .oursThenTheirs || choice == .theirsThenOurs) {
                    choice = .theirs
                }
            }
            if let choice {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Kết quả").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    CodeLines(lines: result(for: choice), emptyText: String(localized: "(trống — đoạn này sẽ bị xoá)"))
                        .padding(8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 6).fill(Color.green.opacity(0.08)))
                }
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 10).fill(Color.primary.opacity(0.03)))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(choice == nil ? Color.orange.opacity(0.6) : Color.green.opacity(0.5), lineWidth: 1.5))
    }

    private func result(for choice: ConflictFile.Resolution) -> [String] {
        switch choice {
        case .ours: return block.ours
        case .theirs: return block.theirs
        case .oursThenTheirs: return block.ours + block.theirs
        case .theirsThenOurs: return block.theirs + block.ours
        case .base: return block.base ?? []
        case .neither: return []
        }
    }
}

private struct ChoiceButton: View {
    let title: String
    let isOn: Bool
    let tint: Color
    let action: () -> Void

    var body: some View {
        if isOn {
            Button(action: action) { Label(title, systemImage: "checkmark") }
                .glassButtonStyle(prominent: true)
                .tint(tint)
                .controlSize(.small)
        } else {
            Button(title, action: action)
                .glassButtonStyle()
                .controlSize(.small)
        }
    }
}

private struct SideColumn: View {
    let title: String
    let label: String
    let lines: [String]
    let tint: Color
    let highlighted: Bool
    let onSelect: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                Text(title).font(.caption.weight(.bold)).foregroundStyle(tint)
                Text(label).font(.caption).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
                Spacer()
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(tint.opacity(0.12))
            CodeLines(lines: lines, emptyText: String(localized: "(trống)"))
                .padding(8)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(RoundedRectangle(cornerRadius: 6).fill(tint.opacity(highlighted ? 0.1 : 0.03)))
        .overlay(RoundedRectangle(cornerRadius: 6).stroke(tint.opacity(highlighted ? 0.8 : 0.25), lineWidth: highlighted ? 2 : 1))
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .contentShape(Rectangle())
        .onTapGesture(count: 2, perform: onSelect)
        .help("Double-click để giữ bản \(title)")
    }
}

private struct CodeLines: View {
    let lines: [String]
    var emptyText: String = ""

    var body: some View {
        if lines.isEmpty {
            Text(emptyText)
                .font(.caption.italic())
                .foregroundStyle(.tertiary)
        } else {
            Text(lines.map { $0.replacingOccurrences(of: "\t", with: "    ") }.joined(separator: "\n"))
                .font(.system(size: 12, design: .monospaced))
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// Xung đột trong file không phải UTF-8 (Latin-1, CP1258…): không giải từng đoạn trong app vì ghi lại qua chuỗi sẽ
/// làm hỏng mọi ký tự không phải ASCII — chỉ chọn nguyên bản một bên (`git checkout`, giữ nguyên byte) hoặc mở editor.
struct ConflictNotUTF8View: View {
    @Bindable var model: RepoModel
    let entry: ConflictEntry

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 40))
                .foregroundStyle(.orange)
            Text((entry.path as NSString).lastPathComponent).font(.title2.bold())
            Text("File không phải UTF-8").font(.headline).foregroundStyle(.secondary)
            Text("File có ký tự không phải UTF-8 (ví dụ Latin-1, CP1258) nên Thaigit không giải từng đoạn xung đột trong app — lưu lại sẽ làm hỏng các ký tự đó. Chọn toàn bộ bản của một bên, hoặc mở bằng trình soạn thảo để sửa.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
                .frame(maxWidth: 460)
            HStack {
                Button("Dùng toàn bộ Current") { model.resolveConflict(entry, useOurs: true) }
                    .glassButtonStyle()
                Button("Dùng toàn bộ Incoming") { model.resolveConflict(entry, useOurs: false) }
                    .glassButtonStyle()
            }
            Button("Mở bằng trình soạn thảo") { model.openInEditor(path: entry.path) }
                .buttonStyle(.link)
        }
        .padding(30)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// Xung đột không có dấu <<<<<<< (file bị xoá ở một bên, hoặc đã sửa tay xong).
struct ConflictWithoutMarkersView: View {
    @Bindable var model: RepoModel
    let entry: ConflictEntry

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 40))
                .foregroundStyle(.orange)
            Text((entry.path as NSString).lastPathComponent).font(.title2.bold())
            Text(entry.kind.description).font(.headline).foregroundStyle(.secondary)
            if entry.kind.hasMarkers {
                Text("Không còn dấu xung đột trong file — có thể bạn đã sửa xong bằng trình soạn thảo.")
                    .foregroundStyle(.secondary)
                Button("Đánh dấu đã giải quyết") { model.markResolved([entry.path]) }
                    .glassButtonStyle(prominent: true)
            } else {
                Text(explanation)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: 460)
                HStack {
                    Button("Dùng bản Current") { model.resolveConflict(entry, useOurs: true) }
                        .glassButtonStyle()
                    Button("Dùng bản Incoming") { model.resolveConflict(entry, useOurs: false) }
                        .glassButtonStyle(prominent: true)
                }
            }
            Button("Mở bằng trình soạn thảo") { model.openInEditor(path: entry.path) }
                .buttonStyle(.link)
        }
        .padding(30)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var explanation: String {
        switch entry.kind {
        case .deletedByUs: return String(localized: "Nhánh hiện tại đã xoá file này, còn bên kia thì sửa nó. Chọn “Current” để xoá file, “Incoming” để giữ bản đã sửa.")
        case .deletedByThem: return String(localized: "Bên kia đã xoá file này, còn nhánh hiện tại thì sửa nó. Chọn “Current” để giữ file, “Incoming” để xoá.")
        case .addedByUs: return String(localized: "Chỉ nhánh hiện tại có file này. “Current” giữ file, “Incoming” xoá nó.")
        case .addedByThem: return String(localized: "Chỉ bên kia có file này. “Incoming” giữ file, “Current” xoá nó.")
        case .bothDeleted: return String(localized: "Cả hai bên đều xoá file này. Chọn bất kỳ để xác nhận xoá.")
        default: return String(localized: "Chọn bản muốn giữ.")
        }
    }
}
