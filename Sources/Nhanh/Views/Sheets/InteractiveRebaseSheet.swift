import NhanhCore
import SwiftUI

extension RebaseAction: Identifiable {
    public var id: String { rawValue }

    var title: String {
        switch self {
        case .pick: return "Giữ"
        case .reword: return "Sửa lời"
        case .squash: return "Gộp"
        case .fixup: return "Gộp, bỏ lời"
        case .drop: return "Bỏ"
        }
    }

    var systemImage: String {
        switch self {
        case .pick: return "checkmark.circle"
        case .reword: return "pencil"
        case .squash: return "arrow.down.to.line"
        case .fixup: return "arrow.down.to.line.compact"
        case .drop: return "trash"
        }
    }

    /// Phím tắt khi đang chọn một dòng (như GitKraken).
    var shortcut: Character {
        switch self {
        case .pick: return "p"
        case .reword: return "r"
        case .squash: return "s"
        case .fixup: return "f"
        case .drop: return "d"
        }
    }
}

/// Interactive rebase như GitKraken: các commit sau `base` (mới ở trên, cũ ở dưới — như graph); mỗi commit chọn
/// Giữ / Sửa lời / Gộp / Gộp bỏ lời / Bỏ, kéo để đổi thứ tự, phím P R S F D cho dòng đang chọn.
struct InteractiveRebaseSheet: View {
    @Bindable var model: RepoModel
    let base: String
    let baseLabel: String
    @Environment(\.dismiss) private var dismiss

    @State private var original: [Commit] = []
    /// Kế hoạch theo thứ tự git áp dụng (cũ → mới); danh sách hiển thị đảo ngược.
    @State private var steps: [RebaseStep] = []
    @State private var selection: String?
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var alreadyPushed = false

    private var problem: String? { RebasePlan.problem(steps, original: original) }
    private var branch: String { model.currentBranch ?? "HEAD" }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Label("Interactive rebase \(branch)", systemImage: "list.bullet.indent")
                    .font(.title3.bold())
                Text("Viết lại \(steps.count) commit sau \(baseLabel). Commit mới ở trên, cũ ở dưới; “Gộp” là gộp vào commit ngay bên dưới.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if isLoading {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let errorMessage {
                Text(errorMessage)
                    .foregroundStyle(.red)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List(selection: $selection) {
                    ForEach(steps.reversed()) { step in
                        RebaseStepRow(step: binding(step.id), repository: model.repository)
                            .tag(step.id)
                    }
                    .onMove(perform: move)
                }
                .listStyle(.inset(alternatesRowBackgrounds: true))
                .onKeyPress(characters: CharacterSet(charactersIn: "prsfdPRSFD"), phases: .down) { press in
                    guard let id = selection, let index = steps.firstIndex(where: { $0.id == id }),
                          let action = RebaseAction.allCases.first(where: { String($0.shortcut) == press.characters.lowercased() })
                    else { return .ignored }
                    steps[index].action = action
                    return .handled
                }
            }

            if alreadyPushed {
                Label("Các commit này đã có trên remote: rebase xong cần force push, người khác đang dùng nhánh sẽ bị lệch.",
                      systemImage: "exclamationmark.triangle.fill")
                    .font(.callout)
                    .foregroundStyle(.orange)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack {
                let warning = problem.flatMap { $0 == RebasePlan.unchanged || isLoading ? nil : $0 }
                Text(warning ?? "P giữ · R sửa lời · S gộp · F gộp bỏ lời · D bỏ · kéo để đổi thứ tự")
                    .font(.caption)
                    .foregroundStyle(warning == nil ? AnyShapeStyle(.secondary) : AnyShapeStyle(.orange))
                    .lineLimit(2)
                Spacer()
                Button("Huỷ") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button("Bắt đầu rebase") {
                    let plan = steps
                    dismiss()
                    model.interactiveRebase(base: base, steps: plan)
                }
                .keyboardShortcut(.defaultAction)
                .disabled(isLoading || problem != nil)
            }
        }
        .padding(20)
        .frame(width: 760, height: 580)
        .task { await load() }
    }

    private func binding(_ id: String) -> Binding<RebaseStep> {
        Binding(
            get: { steps.first { $0.id == id } ?? RebaseStep(commit: original[0]) },
            set: { newValue in
                if let index = steps.firstIndex(where: { $0.id == id }) { steps[index] = newValue }
            }
        )
    }

    /// Kéo thả trên danh sách đảo ngược (mới → cũ) rồi đổi lại thứ tự git áp dụng.
    private func move(from source: IndexSet, to destination: Int) {
        var shown = Array(steps.reversed())
        shown.move(fromOffsets: source, toOffset: destination)
        steps = shown.reversed()
    }

    private func load() async {
        do {
            let commits = try await model.repository.rebaseCommits(after: base)
            original = commits
            steps = commits.map { RebaseStep(commit: $0) }
            selection = commits.last?.id
            if commits.isEmpty { errorMessage = "Không có commit nào sau \(baseLabel) trên nhánh hiện tại." }
            if let upstream = model.currentBranchRef?.upstream, let oldest = commits.first {
                alreadyPushed = await model.repository.isAncestor(oldest.id, of: upstream)
            }
        } catch {
            errorMessage = FriendlyError.message(for: error)
        }
        isLoading = false
    }
}

private struct RebaseStepRow: View {
    @Binding var step: RebaseStep
    let repository: GitRepository

    private var tint: Color {
        switch step.action {
        case .pick: return .secondary
        case .reword: return Brand.blue
        case .squash, .fixup: return .purple
        case .drop: return .red
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 10) {
                Image(systemName: "line.3.horizontal")
                    .foregroundStyle(.tertiary)
                    .help("Kéo để đổi thứ tự")
                Picker("Việc", selection: $step.action) {
                    ForEach(RebaseAction.allCases) { action in
                        Label(action.title, systemImage: action.systemImage).tag(action)
                    }
                }
                .labelsHidden()
                .frame(width: 140)
                .tint(tint)
                AvatarView(name: step.commit.authorName, email: step.commit.authorEmail, size: 20)
                Text(step.commit.subject)
                    .strikethrough(step.action == .drop)
                    .foregroundStyle(step.action == .drop ? .secondary : .primary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Spacer(minLength: 8)
                if step.action == .squash || step.action == .fixup {
                    Label("vào commit dưới", systemImage: "arrow.turn.right.down")
                        .font(.caption)
                        .foregroundStyle(.purple)
                }
                Text(step.commit.shortSHA)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
            }
            if step.action == .reword {
                TextField("Lời commit mới", text: Binding(get: { step.message ?? "" }, set: { step.message = $0 }), axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(2...6)
                    .padding(.leading, 30)
            }
        }
        .padding(.vertical, 3)
        .onChange(of: step.action) {
            // Sửa lời: điền sẵn lời cũ (đầy đủ cả phần thân) để sửa tiếp.
            guard step.action == .reword, step.message == nil else { return }
            let sha = step.commit.id
            Task {
                let message = try? await repository.commitMessage(sha)
                if step.action == .reword, step.message == nil {
                    step.message = (message ?? step.commit.subject).trimmingCharacters(in: .whitespacesAndNewlines)
                }
            }
        }
    }
}
