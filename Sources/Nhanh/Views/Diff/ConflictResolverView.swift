import NhanhCore
import SwiftUI

/// Giải quyết xung đột như GitKraken: mỗi đoạn chọn Current / Incoming / cả hai, hoặc tick từng dòng; khung Kết quả
/// xem trước cả file (sửa tay được trước khi lưu); nút / phím nhảy giữa các đoạn.
struct ConflictResolverView: View {
    @Bindable var model: RepoModel
    let file: ConflictFile
    let entry: ConflictEntry
    @State private var choices: [Int: ConflictFile.Choice] = [:]
    /// Đoạn đang đứng (để nhảy trước / sau).
    @State private var current = 0
    /// Nội dung khung Kết quả khi người dùng sửa tay (nil: kết quả theo các lựa chọn).
    @State private var editedOutput: String?
    @State private var confirmMarkers = false

    private var resolvedCount: Int { choices.count }
    private var total: Int { file.conflictCount }
    private var preview: String { String(decoding: file.previewData(choices: choices), as: UTF8.self) }
    private var canSave: Bool { editedOutput != nil || resolvedCount == total }

    var body: some View {
        VStack(spacing: 0) {
            header
            VSplitView {
                blocks
                    .frame(minHeight: 160)
                OutputPane(text: editedOutput ?? preview, editing: Binding(
                    get: { editedOutput != nil },
                    set: { editedOutput = $0 ? (editedOutput ?? preview) : nil }
                ), edited: Binding(get: { editedOutput ?? "" }, set: { editedOutput = $0 }), unresolved: total - resolvedCount)
                    .frame(minHeight: 110, idealHeight: 200)
            }
            footer
        }
        .onChange(of: file) {
            choices = [:]
            editedOutput = nil
            current = 0
        }
        .alert("Kết quả vẫn còn dấu xung đột", isPresented: $confirmMarkers) {
            Button("Vẫn lưu") { save(force: true) }
            Button("Huỷ", role: .cancel) {}
        } message: {
            Text("Trong khung Kết quả còn dòng <<<<<<< / ======= / >>>>>>>. Lưu như vậy thì file vẫn chứa dấu xung đột.")
        }
    }

    private var header: some View {
        HStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
            VStack(alignment: .leading, spacing: 2) {
                Text("\(total) đoạn xung đột")
                    .font(.headline)
                Text("“Current” là bản trên nhánh hiện tại (HEAD), “Incoming” là bản đang được đưa vào. Bấm vào từng dòng để chọn dòng đó.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            Spacer()
            ControlGroup {
                Button { jump(-1) } label: { Image(systemName: "chevron.up") }
                    .help("Đoạn xung đột trước (⌥⌘↑)")
                    .keyboardShortcut(.upArrow, modifiers: [.command, .option])
                    .disabled(current <= 0)
                Text("\(min(current + 1, total))/\(total)")
                    .font(.callout.monospacedDigit())
                    .padding(.horizontal, 6)
                Button { jump(1) } label: { Image(systemName: "chevron.down") }
                    .help("Đoạn xung đột sau (⌥⌘↓)")
                    .keyboardShortcut(.downArrow, modifiers: [.command, .option])
                    .disabled(current >= total - 1)
            }
            .fixedSize()
            Menu {
                Button("Dùng toàn bộ Current") { model.resolveConflict(entry, useOurs: true) }
                Button("Dùng toàn bộ Incoming") { model.resolveConflict(entry, useOurs: false) }
                Divider()
                Button("Mọi đoạn chưa chọn: giữ Current") { fillRemaining(.ours) }
                Button("Mọi đoạn chưa chọn: giữ Incoming") { fillRemaining(.theirs) }
                Button("Mọi đoạn chưa chọn: giữ cả hai") { fillRemaining(.oursThenTheirs) }
            } label: {
                Label("Chọn nhanh", systemImage: "wand.and.stars")
            }
            .fixedSize()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .glassSurface(in: RoundedRectangle(cornerRadius: 16), tint: Brand.orange.opacity(0.18))
        .padding([.horizontal, .top], 10)
    }

    private var blocks: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    ForEach(Array(file.segments.enumerated()), id: \.offset) { _, segment in
                        switch segment {
                        case .common(let lines):
                            CommonSegment(lines: lines)
                        case .conflict(let block):
                            ConflictBlockView(block: block, total: total, isCurrent: block.id == current,
                                              choice: Binding(get: { choices[block.id] }, set: { select(block.id, $0) }))
                                .id(block.id)
                                .onTapGesture { current = block.id }
                        }
                    }
                }
                .padding(16)
            }
            .onChange(of: current) { _, target in
                withAnimation(.easeInOut(duration: 0.2)) { proxy.scrollTo(target, anchor: .top) }
            }
        }
    }

    private var footer: some View {
        HStack(spacing: 12) {
            ProgressView(value: Double(resolvedCount), total: Double(max(total, 1)))
                .frame(width: 120)
            Text(editedOutput != nil ? String(localized: "Đang sửa tay kết quả") : String(localized: "Đã chọn \(resolvedCount)/\(total)"))
                .font(.callout.monospacedDigit())
            Spacer()
            Button("Mở bằng trình soạn thảo") { model.openInEditor(path: entry.path) }
                .glassButtonStyle()
            Button("Chọn lại") {
                choices = [:]
                editedOutput = nil
            }
            .glassButtonStyle()
            .disabled(choices.isEmpty && editedOutput == nil)
            Button {
                save(force: false)
            } label: {
                Label("Lưu & đánh dấu đã giải quyết", systemImage: "checkmark.circle.fill")
            }
            .glassButtonStyle(prominent: true)
            .disabled(!canSave)
            .keyboardShortcut(.return, modifiers: .command)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .glassSurface(in: Capsule())
        .padding(10)
    }

    /// Chọn cho một đoạn rồi tự sang đoạn chưa chọn kế tiếp (như GitKraken) — chỉ khi vừa chọn cả phía.
    private func select(_ id: Int, _ choice: ConflictFile.Choice?) {
        choices[id] = choice
        editedOutput = nil
        current = id
        if case .side = choice, let next = file.blocks.first(where: { $0.id > id && choices[$0.id] == nil }) {
            current = next.id
        }
    }

    private func jump(_ step: Int) {
        current = min(max(current + step, 0), max(total - 1, 0))
    }

    private func fillRemaining(_ resolution: ConflictFile.Resolution) {
        for block in file.blocks where choices[block.id] == nil {
            choices[block.id] = .side(resolution)
        }
        editedOutput = nil
    }

    private func save(force: Bool) {
        let data: Data?
        if let editedOutput {
            if !force, ConflictFile.parse(editedOutput).conflictCount > 0 {
                confirmMarkers = true
                return
            }
            data = Data(editedOutput.utf8)
        } else {
            data = file.resolvedData(choices: choices)
        }
        guard let data else { return }
        model.saveConflictResolution(entry, file: file, content: data)
    }
}

/// Khung Kết quả: cả file sau khi áp các lựa chọn (đoạn chưa chọn vẫn hiện dấu xung đột). Bật "Sửa" để sửa tay.
private struct OutputPane: View {
    let text: String
    @Binding var editing: Bool
    @Binding var edited: String
    let unresolved: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Text("Kết quả").font(.subheadline.weight(.semibold))
                if unresolved > 0 && !editing {
                    Text("còn \(unresolved) đoạn chưa chọn")
                        .font(.caption)
                        .foregroundStyle(.orange)
                }
                Spacer()
                Toggle(isOn: $editing) {
                    Label("Sửa tay", systemImage: "pencil")
                }
                .toggleStyle(.button)
                .controlSize(.small)
                .help("Sửa trực tiếp nội dung sẽ được lưu")
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 6)
            .background(Color.green.opacity(0.08))
            if editing {
                TextEditor(text: $edited)
                    .font(.system(size: 12, design: .monospaced))
                    .autocorrectionDisabled()
                    .scrollContentBackground(.hidden)
                    .padding(6)
            } else {
                ScrollView([.vertical, .horizontal]) {
                    Text(text.replacingOccurrences(of: "\t", with: "    "))
                        .font(.system(size: 12, design: .monospaced))
                        .textSelection(.enabled)
                        .fixedSize()
                        .padding(10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .background(Color(nsColor: .textBackgroundColor).opacity(0.5))
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
    let isCurrent: Bool
    @Binding var choice: ConflictFile.Choice?

    private var picked: (ours: Set<Int>, theirs: Set<Int>) { choice?.lineSets(block) ?? ([], []) }

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
                ChoiceButton(title: String(localized: "Giữ Current"), isOn: choice == .side(.ours), tint: .blue) { choice = .side(.ours) }
                ChoiceButton(title: String(localized: "Giữ Incoming"), isOn: choice == .side(.theirs), tint: .purple) { choice = .side(.theirs) }
                ChoiceButton(title: String(localized: "Giữ cả hai"), isOn: choice == .side(.oursThenTheirs), tint: .teal) { choice = .side(.oursThenTheirs) }
                Menu {
                    Button("Cả hai (Incoming trước)") { choice = .side(.theirsThenOurs) }
                    if block.base != nil {
                        Button("Bản gốc (base)") { choice = .side(.base) }
                    }
                    Button("Bỏ cả hai") { choice = .side(.neither) }
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
                SideColumn(title: "Current", label: block.oursLabel, lines: block.ours, tint: .blue, picked: picked.ours,
                           onSelectAll: { choice = .side(.ours) },
                           onToggle: { choice = .toggling(choice, ours: true, line: $0, block: block) })
                SideColumn(title: "Incoming", label: block.theirsLabel, lines: block.theirs, tint: .purple, picked: picked.theirs,
                           onSelectAll: { choice = .side(.theirs) },
                           onToggle: { choice = .toggling(choice, ours: false, line: $0, block: block) })
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 10).fill(Color.primary.opacity(isCurrent ? 0.06 : 0.03)))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(choice == nil ? Color.orange.opacity(isCurrent ? 0.9 : 0.5) : Color.green.opacity(0.5),
                                                           lineWidth: isCurrent ? 2.5 : 1.5))
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

/// Một phía của đoạn xung đột: mỗi dòng có ô tick (bấm dòng để chọn / bỏ), nhấp đúp tiêu đề để giữ cả phía.
private struct SideColumn: View {
    let title: String
    let label: String
    let lines: [String]
    let tint: Color
    let picked: Set<Int>
    let onSelectAll: () -> Void
    let onToggle: (Int) -> Void

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
            .contentShape(Rectangle())
            .onTapGesture(count: 2, perform: onSelectAll)
            .help("Double-click để giữ cả bản \(title)")
            if lines.isEmpty {
                Text("(trống)")
                    .font(.caption.italic())
                    .foregroundStyle(.tertiary)
                    .padding(8)
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(lines.enumerated()), id: \.offset) { index, line in
                        let on = picked.contains(index)
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Image(systemName: on ? "checkmark.square.fill" : "square")
                                .font(.system(size: 11))
                                .foregroundStyle(on ? tint : Color.secondary.opacity(0.6))
                            Text(line.replacingOccurrences(of: "\t", with: "    "))
                                .font(.system(size: 12, design: .monospaced))
                                .fixedSize(horizontal: false, vertical: true)
                            Spacer(minLength: 0)
                        }
                        .padding(.horizontal, 8)
                        .padding(.vertical, 1)
                        .background(on ? tint.opacity(0.14) : Color.clear)
                        .contentShape(Rectangle())
                        .onTapGesture { onToggle(index) }
                    }
                }
                .padding(.vertical, 6)
            }
        }
        .background(RoundedRectangle(cornerRadius: 6).fill(tint.opacity(picked.isEmpty ? 0.03 : 0.06)))
        .overlay(RoundedRectangle(cornerRadius: 6).stroke(tint.opacity(picked.isEmpty ? 0.25 : 0.7), lineWidth: picked.isEmpty ? 1 : 1.5))
        .clipShape(RoundedRectangle(cornerRadius: 6))
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
