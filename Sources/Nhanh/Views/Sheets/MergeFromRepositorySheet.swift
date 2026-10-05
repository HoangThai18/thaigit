import AppKit
import NhanhCore
import SwiftUI

/// Merges a branch of another repository (a local folder or a URL) into a branch of the open repo — without adding a remote.
/// Reopening prefills the most recently used source and preloads its branch list: usually you just press ↩.
struct MergeFromRepositorySheet: View {
    @Bindable var model: RepoModel
    let initialTarget: String?
    @Environment(\.dismiss) private var dismiss

    @State private var source = ""
    /// The (normalised) source `branches` was loaded for; a different source means reloading.
    @State private var loadedSource: String?
    @State private var branches: [String] = []
    @State private var branch = ""
    /// The branch to preselect once loading finishes (taken from the stored source).
    @State private var preferredBranch: String?
    @State private var target = ""
    @State private var targetEdited = false
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var loadTask: Task<Void, Never>?
    @State private var saved: [ForeignMergeSource] = []

    private var resolvedSource: String {
        GitRepository.resolveRepositorySource(source, relativeTo: model.repository.root)
    }

    private var isLoaded: Bool { loadedSource != nil && loadedSource == resolvedSource }

    private var isCurrentRepository: Bool { isCurrent(resolvedSource) }

    private var targets: [String] {
        var names = model.localBranches.map(\.name)
        if let current = model.currentBranch, !names.contains(current) { names.insert(current, at: 0) }
        return names
    }

    private var recentRepositories: [String] {
        AppState.shared.recentRepositories.filter { !isCurrent($0) }
    }

    private var canMerge: Bool {
        isLoaded && !isLoading && branches.contains(branch) && targets.contains(target)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Label("Merge từ repository khác", systemImage: "arrow.triangle.merge")
                .font(.title3.bold())
            Text("Lấy một nhánh của repo khác rồi merge vào \(model.name), không thêm remote. Nguồn là thư mục trên máy thì không cần đăng nhập.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            if !saved.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Đã dùng gần đây").font(.subheadline.weight(.medium))
                    ForEach(saved) { item in
                        HStack(spacing: 6) {
                            Button { use(item) } label: {
                                Label("\(item.label) → \(item.target)", systemImage: item.isLocal ? "folder" : "network")
                                    .lineLimit(1)
                                    .truncationMode(.middle)
                            }
                            .buttonStyle(.borderless)
                            .help(GitRepository.anonymizedSource(item.source))
                            Spacer()
                            Button {
                                model.forgetForeignMergeSource(item)
                                saved.removeAll { $0 == item }
                            } label: { Image(systemName: "xmark") }
                                .buttonStyle(.borderless)
                                .foregroundStyle(.secondary)
                                .help("Bỏ khỏi danh sách")
                        }
                    }
                }
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("Repository nguồn").font(.subheadline.weight(.medium))
                TextField("", text: $source, prompt: Text("~/code/du-an-a hoặc https://github.com/cong-ty/du-an.git"))
                    .textFieldStyle(.roundedBorder)
                    .onSubmit(loadBranches)
                HStack {
                    Button("Chọn thư mục…", action: chooseFolder)
                    Menu("Repo đã mở") {
                        ForEach(recentRepositories, id: \.self) { path in
                            Button((path as NSString).lastPathComponent + "  —  " + (path as NSString).deletingLastPathComponent) {
                                source = path
                                loadBranches()
                            }
                        }
                    }
                    .fixedSize()
                    .disabled(recentRepositories.isEmpty)
                    Spacer()
                    if isLoading { ProgressView().controlSize(.small) }
                    Button("Xem nhánh", action: loadBranches)
                        .disabled(resolvedSource.isEmpty || isLoading || isCurrentRepository)
                }
                if isCurrentRepository {
                    Text("Đây chính là repository đang mở — kéo nhánh thả lên nhánh để merge.")
                        .font(.caption)
                        .foregroundStyle(.red)
                } else if let errorMessage {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundStyle(.red)
                        .textSelection(.enabled)
                        .lineLimit(5)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            if isLoaded {
                if branches.isEmpty {
                    Text("Repository này chưa có nhánh nào.").font(.callout).foregroundStyle(.secondary)
                } else {
                    VStack(alignment: .leading, spacing: 8) {
                        Picker("Nhánh nguồn", selection: $branch) {
                            ForEach(branches, id: \.self) { Text($0).tag($0) }
                        }
                        Picker("Merge vào", selection: Binding(get: { target }, set: { target = $0; targetEdited = true })) {
                            ForEach(targets, id: \.self) { name in
                                Text(name == model.currentBranch ? String(localized: "\(name) (đang checkout)") : name).tag(name)
                            }
                        }
                        if !target.isEmpty, target != model.currentBranch {
                            Text("Sẽ checkout \(target) trước khi merge.").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }

            HStack {
                Spacer()
                Button("Huỷ") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button("Merge", action: merge)
                    .keyboardShortcut(.defaultAction)
                    .disabled(!canMerge)
            }
        }
        .padding(22)
        .frame(width: 520)
        .onAppear(perform: prefill)
        .onDisappear { loadTask?.cancel() }
        .onChange(of: branch) {
            if !targetEdited { target = defaultTarget(for: branch) }
        }
    }

    private func isCurrent(_ path: String) -> Bool {
        guard path.hasPrefix("/") else { return false }
        let url = URL(fileURLWithPath: path).resolvingSymlinksInPath().standardizedFileURL
        return [model.repository.root, model.repository.gitDir].contains { $0.resolvingSymlinksInPath().standardizedFileURL == url }
    }

    /// Prefill the most recently used source (preferring one that was merged into the selected branch) and preload its branches.
    private func prefill() {
        saved = model.savedForeignMergeSources
        if let initialTarget {
            target = initialTarget
            targetEdited = true
        }
        let candidate = saved.first { initialTarget == nil || $0.target == initialTarget } ?? saved.first
        if let candidate {
            use(candidate, keepTarget: initialTarget != nil)
        } else if target.isEmpty {
            target = model.currentBranch ?? targets.first ?? ""
        }
    }

    private func use(_ item: ForeignMergeSource, keepTarget: Bool = false) {
        source = item.source
        // A source previously merged into a branch other than the selected one: let the "same branch name" rule pick the source branch.
        preferredBranch = keepTarget && item.target != target ? nil : item.branch
        if !keepTarget, targets.contains(item.target) {
            target = item.target
            targetEdited = true
        }
        loadBranches()
    }

    private func chooseFolder() {
        guard let path = AppState.shared.chooseRepositoryFolder(prompt: String(localized: "Chọn")) else { return }
        source = path
        loadBranches()
    }

    private func loadBranches() {
        let resolved = resolvedSource
        guard !resolved.isEmpty, !isCurrentRepository else { return }
        loadTask?.cancel()
        isLoading = true
        errorMessage = nil
        let repo = model.repository
        loadTask = Task {
            do {
                let result = try await repo.branches(ofRepository: resolved)
                guard !Task.isCancelled else { return }
                apply(result, for: resolved)
            } catch {
                guard !Task.isCancelled else { return }
                loadedSource = nil
                errorMessage = describe(error, source: resolved)
            }
            isLoading = false
        }
    }

    private func apply(_ result: ForeignBranches, for resolved: String) {
        branches = result.names
        loadedSource = resolved
        // "Branch A of that repo into branch A of this one": prefer the branch matching the target's name.
        let candidates = [preferredBranch, targetEdited ? target : nil, initialTarget, model.currentBranch, result.defaultBranch]
        let chosen = candidates.compactMap { $0 }.first { result.names.contains($0) } ?? result.names.first ?? ""
        preferredBranch = nil
        if chosen == branch, !targetEdited { target = defaultTarget(for: chosen) }
        branch = chosen
    }

    private func defaultTarget(for branch: String) -> String {
        if targets.contains(branch) { return branch }
        return initialTarget ?? model.currentBranch ?? targets.first ?? ""
    }

    private func describe(_ error: any Error, source rawSource: String) -> String {
        // Never show a "user:password@" the user typed into the URL.
        let source = GitRepository.anonymizedSource(rawSource)
        if let gitError = error as? GitError {
            if gitError.contains("does not appear to be a git repository") || gitError.contains("not a git repository") {
                return String(localized: "“\(source)” không phải Git repository — hãy chọn thư mục gốc của repo (nơi có thư mục .git).")
            }
            if gitError.contains("Authentication failed") || gitError.contains("could not read Username")
                || gitError.contains("Permission denied") {
                return String(localized: "Không đăng nhập được vào \(source). Kiểm tra tài khoản / token, hoặc dùng bản clone của repo đó trên máy (không cần đăng nhập).")
            }
        }
        return FriendlyError.message(for: error)
    }

    private func merge() {
        guard canMerge, let loadedSource else { return }
        let request = ForeignMergeSource(source: loadedSource, branch: branch, target: target)
        dismiss()
        model.mergeFromRepository(request)
    }
}
