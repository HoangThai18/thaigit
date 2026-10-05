import AppKit
import NhanhCore
import SwiftUI

/// The sidebar: LOCAL / REMOTE / PULL REQUESTS / TAGS / STASHES like GitKraken. Click to jump to a commit, double-click to
/// check out, drag one branch onto another to merge / rebase / push.
struct SidebarView: View {
    @Bindable var model: RepoModel
    @State private var selection: String?
    @State private var filter = ""
    /// Wait a beat before opening the review of the selected PR / MR: arrowing through many rows must not fetch each one.
    @State private var reviewDebounce = ReviewDebounce()
    @AppStorage("sidebar.showLocal") private var showLocal = true
    @AppStorage("sidebar.showRemote") private var showRemote = true
    @AppStorage("sidebar.showTags") private var showTags = false
    @AppStorage("sidebar.showStashes") private var showStashes = true
    @AppStorage("sidebar.showPullRequests") private var showPullRequests = true
    @AppStorage("sidebar.showMergeRequests") private var showMergeRequests = true
    @AppStorage("sidebar.showSubmodules") private var showSubmodules = true
    @AppStorage("sidebar.showWorktrees") private var showWorktrees = false
    @AppStorage("sidebar.showGitFlow") private var showGitFlow = true

    private var trimmedFilter: String { filter.trimmingCharacters(in: .whitespaces) }
    private var filtering: Bool { !trimmedFilter.isEmpty }

    private func matches(_ text: String) -> Bool {
        !filtering || text.localizedStandardContains(trimmedFilter)
    }

    // SwiftUI's List re-diffs every row on each update, so only build the rows of the open section,
    // limit the rows per level, and keep this view from reading `status` / `selection` (which change constantly).
    var body: some View {
        List(selection: $selection) {
            Section(isExpanded: $showLocal) {
                if showLocal { localRows }
            } header: {
                SidebarHeader(title: "LOCAL", count: model.localBranches.count, systemImage: "laptopcomputer") {
                    model.beginCreateBranchAtHead()
                }
            }

            Section(isExpanded: $showRemote) {
                if showRemote { remoteRows }
            } header: {
                SidebarHeader(title: "REMOTE", count: model.remoteBranches.count, systemImage: "cloud") {
                    model.sheet = .addRemote
                }
            }

            if model.pullRequests.state != .notGitHub, model.githubRemote != nil {
                Section(isExpanded: $showPullRequests) {
                    if showPullRequests { pullRequestRows }
                } header: {
                    SidebarHeader(title: "PULL REQUESTS", count: model.pullRequests.items.count, systemImage: "arrow.triangle.pull") {
                        model.beginCreatePullRequest()
                    }
                }
            }

            mergeRequestSection

            Section(isExpanded: $showTags) {
                if showTags { tagRows }
            } header: {
                SidebarHeader(title: "TAGS", count: model.tags.count, systemImage: "tag", addAction: nil)
            }

            Section(isExpanded: $showStashes) {
                if showStashes { stashRows }
            } header: {
                SidebarHeader(title: "STASHES", count: model.stashes.count, systemImage: "archivebox") {
                    model.beginStash()
                }
            }

            extraSections
        }
        .listStyle(.sidebar)
        .safeAreaInset(edge: .top, spacing: 0) {
            HStack(spacing: 6) {
                Image(systemName: "line.3.horizontal.decrease")
                    .foregroundStyle(.secondary)
                TextField("Lọc nhánh, tag…", text: $filter)
                    .textFieldStyle(.plain)
                if filtering {
                    Button { filter = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary) }
                        .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .glassSurface(in: Capsule())
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
        }
        .contextMenu(forSelectionType: String.self) { ids in
            if let id = ids.first {
                MenuSpecContent(items: menuItems(for: id))
            }
        } primaryAction: { ids in
            guard let id = ids.first else { return }
            if let ref = ref(for: id) {
                model.checkout(ref)
            } else if let stash = stash(for: id) {
                model.applyStash(stash)
            } else if let pull = pullRequest(for: id) {
                reviewDebounce.task?.cancel()
                model.checkoutPullRequest(pull)
            } else if let request = mergeRequest(for: id) {
                reviewDebounce.task?.cancel()
                model.checkoutMergeRequest(request)
            } else if let path = openablePath(for: id) {
                model.openInNewTab(path)
            }
        }
        .onChange(of: selection) { _, newValue in
            guard let newValue else { return }
            if let ref = ref(for: newValue) {
                model.reveal(ref: ref)
            } else if let stash = stash(for: newValue) {
                model.select(.stash(stash.sha))
            } else if let pull = pullRequest(for: newValue) {
                scheduleReview(pull.forgeRequest, id: newValue)
            } else if let request = mergeRequest(for: newValue) {
                scheduleReview(request, id: newValue)
            }
        }
        .background {
            SidebarSelectionSync(model: model, selection: $selection)
        }
    }

    /// Git Flow, submodules, worktrees — split out of `body` so the List's expressions don't overload the compiler.
    @ViewBuilder
    private var extraSections: some View {
        if let flow = model.extras.gitFlow {
            Section(isExpanded: $showGitFlow) {
                if showGitFlow { gitFlowRows(flow) }
            } header: {
                SidebarHeader(title: "GIT FLOW", count: flowBranches(flow).count, systemImage: "flag") {
                    model.sheet = .gitFlowStart(.feature)
                }
            }
        }

        if !model.extras.submodules.isEmpty {
            Section(isExpanded: $showSubmodules) {
                if showSubmodules { submoduleRows }
            } header: {
                SidebarHeader(title: "SUBMODULES", count: model.extras.submodules.count, systemImage: "shippingbox", addAction: nil)
            }
        }

        Section(isExpanded: $showWorktrees) {
            if showWorktrees { worktreeRows }
        } header: {
            SidebarHeader(title: "WORKTREES", count: model.extras.linkedWorktrees.count, systemImage: "square.on.square") {
                model.sheet = .addWorktree
            }
        }
    }

    @ViewBuilder
    private var localRows: some View {
        let locals = model.localBranches.filter { matches($0.name) }
        if locals.isEmpty {
            PlaceholderRow(text: filtering ? String(localized: "Không có nhánh khớp") : String(localized: "Chưa có nhánh nào"))
        } else if filtering {
            LimitedRows(items: locals, noun: String(localized: "nhánh")) { ref in branchRow(ref, title: ref.name) }
        } else {
            BranchTree(nodes: BranchNode.build(locals, name: \.name)) { ref, title in branchRow(ref, title: title) }
        }
    }

    @ViewBuilder
    private var remoteRows: some View {
        if model.remotes.isEmpty {
            Button {
                model.sheet = .addRemote
            } label: {
                Label("Thêm remote…", systemImage: "plus")
            }
            .buttonStyle(.borderless)
        }
        ForEach(model.remotes) { remote in
            let branches = model.remoteBranches.filter { $0.remoteName == remote.name && matches($0.name) }
            RemoteGroup(remote: remote, model: model, icon: remoteIcon(remote), forceExpanded: filtering) {
                if filtering {
                    LimitedRows(items: branches, noun: String(localized: "nhánh")) { ref in branchRow(ref, title: ref.shortBranchName) }
                } else {
                    BranchTree(nodes: BranchNode.build(branches, name: \.shortBranchName)) { ref, title in
                        branchRow(ref, title: title)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var pullRequestRows: some View {
        let list = model.pullRequests
        let pulls = list.items.filter { matches("#\($0.number) \($0.title) \($0.headBranch) \($0.author)") }
        switch list.state {
        case .needsLogin:
            if GitHubAccountManager.shared.isConfigured {
                Button {
                    model.sheet = .githubLogin
                } label: {
                    Label("Đăng nhập GitHub để xem PR", systemImage: "person.crop.circle.badge.plus")
                }
                .buttonStyle(.borderless)
                .help("Repo riêng tư: cần tài khoản GitHub có quyền xem repo này")
            } else {
                PlaceholderRow(text: String(localized: "Repo riêng tư — cần đăng nhập GitHub"))
            }
        case .failed(let message) where pulls.isEmpty:
            Button {
                model.loadPullRequests(force: true)
            } label: {
                Label("Không tải được PR — thử lại", systemImage: "arrow.clockwise")
            }
            .buttonStyle(.borderless)
            .help(message)
        case .loading where pulls.isEmpty, .idle:
            PlaceholderRow(text: String(localized: "Đang tải…"))
        default:
            if pulls.isEmpty {
                PlaceholderRow(text: filtering ? String(localized: "Không có PR khớp") : String(localized: "Không có PR nào đang mở"))
            }
            LimitedRows(items: pulls, noun: "PR") { pull in
                PullRequestRow(pull: pull, isCurrent: model.currentBranchRef.flatMap { model.pullRequest(for: $0) }?.number == pull.number)
                    .tag("pr:\(pull.number)")
            }
        }
    }

    /// The MERGE REQUESTS section (a repo on GitLab) — split out of `body` so the List's expressions don't overload the compiler.
    @ViewBuilder
    private var mergeRequestSection: some View {
        if model.mergeRequests.state != .notGitLab, model.gitlabRemote != nil {
            Section(isExpanded: $showMergeRequests) {
                if showMergeRequests { mergeRequestRows }
            } header: {
                SidebarHeader(title: "MERGE REQUESTS", count: model.mergeRequests.items.count, systemImage: "arrow.triangle.pull") {
                    model.beginCreatePullRequest()
                }
            }
        }
    }

    @ViewBuilder
    private var mergeRequestRows: some View {
        let list = model.mergeRequests
        let requests = list.items.filter { matches("!\($0.number) \($0.title) \($0.sourceBranch) \($0.author)") }
        switch list.state {
        case .needsAccount:
            PlaceholderRow(text: String(localized: "Thêm tài khoản GitLab trong Cài đặt để xem MR"))
        case .failed(let message) where requests.isEmpty:
            Button {
                model.loadMergeRequests(force: true)
            } label: {
                Label("Không tải được MR — thử lại", systemImage: "arrow.clockwise")
            }
            .buttonStyle(.borderless)
            .help(message)
        case .loading where requests.isEmpty, .idle:
            PlaceholderRow(text: String(localized: "Đang tải…"))
        default:
            if requests.isEmpty {
                PlaceholderRow(text: filtering ? String(localized: "Không có MR khớp") : String(localized: "Không có MR nào đang mở"))
            }
            LimitedRows(items: requests, noun: "MR") { request in
                MergeRequestRow(request: request)
                    .tag("mr:\(request.number)")
            }
        }
    }

    private func flowBranches(_ flow: GitFlowConfig) -> [GitRef] {
        model.localBranches.filter { flow.classify($0.name) != nil && matches($0.name) }
    }

    @ViewBuilder
    private func gitFlowRows(_ flow: GitFlowConfig) -> some View {
        ForEach(flowBranches(flow)) { ref in
            branchRow(ref, title: ref.name)
        }
        HStack(spacing: 10) {
            ForEach(GitFlowKind.allCases) { kind in
                Button("+ \(kind.title)") { model.sheet = .gitFlowStart(kind) }
                    .buttonStyle(.borderless)
                    .font(.caption)
                    .help("Bắt đầu \(kind.title.lowercased()) mới từ \(flow.base(kind))")
            }
        }
    }

    @ViewBuilder
    private var submoduleRows: some View {
        ForEach(model.extras.submodules) { module in
            HStack(spacing: 6) {
                Image(systemName: "shippingbox")
                    .foregroundStyle(.secondary)
                    .frame(width: 16)
                Text(module.path)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .opacity(module.state == .uninitialized ? 0.5 : 1)
                Spacer(minLength: 4)
                if let badge = Self.submoduleBadge(module.state) {
                    Image(systemName: badge.symbol).foregroundStyle(badge.color)
                }
            }
            .help(Self.submoduleTooltip(module))
            .tag("sub:" + module.path)
        }
    }

    private static func submoduleTooltip(_ module: Submodule) -> String {
        let head = module.path + " @ " + String(module.sha.prefix(7))
        guard let hint = submoduleBadge(module.state)?.hint else { return head }
        return head + "\n" + hint
    }

    private static func submoduleBadge(_ state: Submodule.State) -> (symbol: String, color: Color, hint: String)? {
        switch state {
        case .uninitialized: return ("arrow.down.circle", .secondary, String(localized: "Chưa tải về — chuột phải → Tải về"))
        case .modified: return ("exclamationmark.circle", .orange, String(localized: "Đang ở commit khác commit repo này ghi nhận"))
        case .conflicted: return ("exclamationmark.triangle", .red, String(localized: "Xung đột"))
        case .upToDate: return nil
        }
    }

    @ViewBuilder
    private var worktreeRows: some View {
        ForEach(model.extras.worktrees) { worktree in
            HStack(spacing: 6) {
                Image(systemName: worktree.isMain ? "folder.fill" : "folder")
                    .foregroundStyle(.secondary)
                    .frame(width: 16)
                Text(worktree.branch ?? String(localized: "Detached HEAD"))
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: 4)
                if worktree.isMain {
                    Text("chính").font(.caption).foregroundStyle(.secondary)
                }
                if worktree.isLocked {
                    Image(systemName: "lock").foregroundStyle(.secondary).help("Worktree đang bị khoá")
                }
                if worktree.isPrunable {
                    Image(systemName: "exclamationmark.triangle").foregroundStyle(.orange).help("Thư mục không còn — có thể dọn")
                }
            }
            .help((worktree.path as NSString).abbreviatingWithTildeInPath)
            .tag("wt:" + worktree.path)
        }
    }

    @ViewBuilder
    private var tagRows: some View {
        let tags = model.tags.filter { matches($0.name) }
        if tags.isEmpty {
            PlaceholderRow(text: filtering ? String(localized: "Không có tag khớp") : String(localized: "Không có tag"))
        }
        LimitedRows(items: tags, noun: "tag") { ref in
            Label(ref.name, systemImage: "tag")
                .lineLimit(1)
                .tag("ref:" + ref.fullName)
                .help(ref.isAnnotatedTag ? "Annotated tag" : "Tag")
        }
    }

    @ViewBuilder
    private var stashRows: some View {
        if model.stashes.isEmpty {
            PlaceholderRow(text: String(localized: "Không có stash"))
        }
        LimitedRows(items: model.stashes, noun: "stash") { stash in
            StashRow(stash: stash)
                .tag("stash:" + stash.sha)
        }
    }

    @ViewBuilder
    private func branchRow(_ ref: GitRef, title: String) -> some View {
        BranchRow(ref: ref, title: title, isCurrent: ref.kind == .localBranch && ref.isHead,
                  visibility: model.graphVisibility(of: ref), canHide: model.canHideOnGraph(ref)) {
            model.toggleHidden(ref)
        }
            .tag("ref:" + ref.fullName)
            .draggable(ref.fullName) {
                Label(ref.name, systemImage: ref.kind == .remoteBranch ? "cloud" : "arrow.triangle.branch")
                    .padding(6)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 6))
            }
            .dropDestination(for: String.self) { items, _ in
                guard let sourceName = items.first,
                      let source = model.refs.first(where: { $0.fullName == sourceName }),
                      source.fullName != ref.fullName else { return false }
                model.dragRequest = DragRequest(source: source, target: .ref(ref))
                return true
            }
    }

    private func remoteIcon(_ remote: Remote) -> String {
        let url = remote.fetchURL.lowercased()
        if url.contains("github") || url.contains("gitlab") || url.contains("bitbucket") { return "cloud.fill" }
        return "network"
    }

    private func ref(for id: String) -> GitRef? {
        guard id.hasPrefix("ref:") else { return nil }
        let fullName = String(id.dropFirst(4))
        return model.refs.first { $0.fullName == fullName }
    }

    private func stash(for id: String) -> Stash? {
        guard id.hasPrefix("stash:") else { return nil }
        let sha = String(id.dropFirst(6))
        return model.stashes.first { $0.sha == sha }
    }

    private func pullRequest(for id: String) -> GitHubPullRequest? {
        guard id.hasPrefix("pr:"), let number = Int(id.dropFirst(3)) else { return nil }
        return model.pullRequests.items.first { $0.number == number }
    }

    private func scheduleReview(_ request: ForgeRequest, id: String) {
        reviewDebounce.task?.cancel()
        reviewDebounce.task = Task {
            try? await Task.sleep(for: .milliseconds(350))
            guard !Task.isCancelled, selection == id else { return }
            model.openReview(request)
        }
    }

    private func mergeRequest(for id: String) -> ForgeRequest? {
        guard id.hasPrefix("mr:"), let number = Int(id.dropFirst(3)) else { return nil }
        return model.mergeRequests.items.first { $0.number == number }
    }

    /// Paths that can be opened as a tab (a fetched submodule, a worktree outside the open folder).
    private func openablePath(for id: String) -> String? {
        if id.hasPrefix("sub:"), let module = model.extras.submodules.first(where: { "sub:" + $0.path == id }),
           module.state != .uninitialized {
            return model.repository.root.appendingPathComponent(module.path).path
        }
        if id.hasPrefix("wt:"), let worktree = model.extras.worktrees.first(where: { "wt:" + $0.path == id }), !worktree.isMain {
            return worktree.path
        }
        return nil
    }

    private func menuItems(for id: String) -> [MenuItemSpec] {
        if let ref = ref(for: id) { return model.menu(for: ref) }
        if let stash = stash(for: id) { return model.stashMenu(stash) }
        if let pull = pullRequest(for: id) { return model.pullRequestMenu(pull) }
        if let request = mergeRequest(for: id) { return model.mergeRequestMenu(request) }
        if id.hasPrefix("sub:"), let module = model.extras.submodules.first(where: { "sub:" + $0.path == id }) {
            return model.submoduleMenu(module)
        }
        if id.hasPrefix("wt:"), let worktree = model.extras.worktrees.first(where: { "wt:" + $0.path == id }) {
            return model.worktreeMenu(worktree)
        }
        return []
    }
}

private struct SidebarHeader: View {
    let title: String
    let count: Int
    let systemImage: String
    let addAction: (() -> Void)?

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: systemImage)
            Text(title)
            Text("\(count)")
                .font(.caption2.monospacedDigit())
                .padding(.horizontal, 5)
                .padding(.vertical, 1)
                .background(Capsule().fill(Color.primary.opacity(0.08)))
            Spacer()
            if let addAction {
                Button(action: addAction) {
                    Image(systemName: "plus")
                }
                .buttonStyle(.borderless)
                .help("Thêm")
            }
        }
    }
}

private struct BranchRow: View {
    let ref: GitRef
    let title: String
    let isCurrent: Bool
    let visibility: GraphVisibility
    let canHide: Bool
    let toggleHidden: () -> Void
    @State private var hovering = false

    /// Dimmed when the branch isn't shown on the graph.
    private var isDimmed: Bool { visibility == .hidden || (visibility == .outsideSolo && !isCurrent) }

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: isCurrent ? "checkmark.circle.fill" : (ref.kind == .remoteBranch ? "cloud" : "arrow.triangle.branch"))
                .foregroundStyle(isCurrent ? Color.accentColor : .secondary)
                .frame(width: 16)
            Text(title)
                .fontWeight(isCurrent ? .bold : .regular)
                .foregroundStyle(isCurrent ? Color.accentColor : .primary)
                .lineLimit(1)
                .truncationMode(.middle)
                .opacity(isDimmed ? 0.45 : 1)
            Spacer(minLength: 4)
            if visibility == .solo {
                Image(systemName: "scope")
                    .foregroundStyle(Color.accentColor)
                    .help("Đang chỉ hiện nhánh này (solo)")
            }
            // Like GitKraken: hovering a branch reveals an eye button to hide / show it on the graph.
            if visibility == .hidden || (hovering && canHide && visibility != .solo && visibility != .outsideSolo) {
                Button(action: toggleHidden) {
                    Image(systemName: visibility == .hidden ? "eye.slash" : "eye")
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.borderless)
                .help(visibility == .hidden ? String(localized: "Hiện lại nhánh trên graph") : String(localized: "Ẩn nhánh khỏi graph"))
            }
            if ref.upstreamGone {
                Image(systemName: "exclamationmark.icloud")
                    .foregroundStyle(.orange)
                    .help("Nhánh trên remote đã bị xoá")
            }
            if ref.ahead > 0 {
                Text("↑\(ref.ahead)")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
                    .help("\(ref.ahead) commit chưa push")
            }
            if ref.behind > 0 {
                Text("↓\(ref.behind)")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.orange)
                    .help("\(ref.behind) commit mới trên remote chưa pull")
            }
        }
        .help(ref.upstream.map { "\(ref.name) → \($0)" } ?? ref.name)
        .background {
            if isCurrent {
                RoundedRectangle(cornerRadius: 6)
                    .fill(Color.accentColor.opacity(0.16))
                    .padding(.horizontal, -6)
                    .padding(.vertical, -3)
            }
        }
        .onHover { hovering = $0 }
    }
}

private struct PullRequestRow: View {
    let pull: GitHubPullRequest
    /// The PRs of the checked-out branch.
    let isCurrent: Bool

    /// Split out of `body`: writing everything inline in `.help(...)` makes the CI compiler run out of type-inference time.
    private var tooltip: String {
        var title = "#\(pull.number) \(pull.title)"
        if pull.isDraft { title += String(localized: " (nháp)") }
        var branches = ""
        if let repository = pull.headRepository, let owner = repository.split(separator: "/").first {
            branches = String(owner) + ":"
        }
        branches += pull.headBranch + " → " + pull.baseBranch
        var author = String(localized: "Tác giả: @") + pull.author
        if let updated = pull.updatedAt { author += String(localized: " · cập nhật ") + VietnameseDate.relative(updated) }
        return title + "\n" + branches + "\n" + author
    }

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "arrow.triangle.pull")
                .foregroundStyle(pull.isDraft ? Color.secondary : Color.green)
                .frame(width: 16)
            Text("#\(pull.number)")
                .font(.callout.monospacedDigit())
                .foregroundStyle(.secondary)
            Text(pull.title)
                .fontWeight(isCurrent ? .semibold : .regular)
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: 0)
        }
        .help(tooltip)
    }
}

/// Keeps the pending "open review" task in a reference object: assigning a value to `@State` would rebuild the sidebar's whole
/// List on every PR / MR click, whereas mutating a property of this object does not.
private final class ReviewDebounce {
    var task: Task<Void, Never>?
}

private struct MergeRequestRow: View {
    let request: ForgeRequest

    /// Split out of `body` so the compiler doesn't have to infer types for one long expression.
    private var tooltip: String {
        var title = request.reference + " " + request.title
        if request.isDraft { title += String(localized: " (nháp)") }
        let branches = request.sourceBranch + " → " + request.targetBranch
        var author = String(localized: "Tác giả: @") + request.author
        if let updated = request.updatedAt { author += String(localized: " · cập nhật ") + VietnameseDate.relative(updated) }
        return title + "\n" + branches + "\n" + author
    }

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "arrow.triangle.pull")
                .foregroundStyle(request.isDraft ? Color.secondary : Color.orange)
                .frame(width: 16)
            Text(request.reference)
                .font(.callout.monospacedDigit())
                .foregroundStyle(.secondary)
            Text(request.title)
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: 0)
        }
        .help(tooltip)
    }
}

private struct StashRow: View {
    let stash: Stash

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "archivebox")
                .foregroundStyle(.secondary)
                .frame(width: 16)
            Text(stash.displayMessage.isEmpty ? stash.selector : stash.displayMessage)
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: 0)
        }
        .help([stash.message, stash.branchName.map { String(localized: "Nhánh: \($0)") }, VietnameseDate.absolute(stash.date)]
            .compactMap { $0 }.joined(separator: "\n"))
    }
}

/// The branch tree keyed on "/" (feature/a, feature/b → folder feature).
struct BranchNode: Identifiable {
    let id: String
    let name: String
    var ref: GitRef?
    var children: [BranchNode]

    /// How many branches are inside (child folders included).
    var leafCount: Int { ref != nil ? 1 : children.reduce(0) { $0 + $1.leafCount } }

    static func build(_ refs: [GitRef], name: KeyPath<GitRef, String>) -> [BranchNode] {
        final class Folder {
            var folders: [String: Folder] = [:]
            var order: [String] = []
            var leaves: [(String, GitRef)] = []
        }
        let root = Folder()
        for ref in refs {
            let parts = ref[keyPath: name].split(separator: "/").map(String.init)
            var folder = root
            for part in parts.dropLast() {
                if folder.folders[part] == nil {
                    folder.folders[part] = Folder()
                    folder.order.append(part)
                }
                folder = folder.folders[part]!
            }
            folder.leaves.append((parts.last ?? ref[keyPath: name], ref))
        }
        func convert(_ folder: Folder, prefix: String) -> [BranchNode] {
            var nodes: [BranchNode] = folder.order.map { key in
                let path = prefix.isEmpty ? key : prefix + "/" + key
                return BranchNode(id: "folder:" + path, name: key, ref: nil, children: convert(folder.folders[key]!, prefix: path))
            }
            nodes += folder.leaves.map { BranchNode(id: $0.1.fullName, name: $0.0, ref: $0.1, children: []) }
            return nodes
        }
        return convert(root, prefix: "")
    }
}

struct BranchTree<Row: View>: View {
    let nodes: [BranchNode]
    let row: (GitRef, String) -> Row

    init(nodes: [BranchNode], @ViewBuilder row: @escaping (GitRef, String) -> Row) {
        self.nodes = nodes
        self.row = row
    }

    var body: some View {
        LimitedRows(items: nodes, noun: String(localized: "nhánh")) { node in
            if let ref = node.ref {
                row(ref, node.name)
            } else {
                BranchFolder(name: node.name, count: node.leafCount) {
                    BranchTree(nodes: node.children, row: row)
                }
            }
        }
    }
}

/// Rows pre-built per level, and rows added per "Show more" click.
private let sidebarPageSize = 50
private let sidebarPageStep = 200

/// Only part of a long list is built; the rest appears when "Show more…" is clicked.
private struct LimitedRows<Item: Identifiable, Row: View>: View {
    let items: [Item]
    let noun: String
    @ViewBuilder let row: (Item) -> Row
    @State private var limit = sidebarPageSize

    var body: some View {
        ForEach(items.prefix(limit)) { item in
            row(item)
        }
        if items.count > limit {
            let remaining = items.count - limit
            Button {
                limit += sidebarPageStep
            } label: {
                Label("Hiện thêm \(min(remaining, sidebarPageStep)) \(noun) (còn \(remaining))", systemImage: "ellipsis.circle")
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.borderless)
        }
    }
}

private struct PlaceholderRow: View {
    let text: String

    var body: some View {
        Text(text)
            .foregroundStyle(.tertiary)
            .font(.callout)
    }
}

/// A branch folder. Small folders start expanded so branches are visible at once; bigger ones collapse to stay cheap.
private struct BranchFolder<Content: View>: View {
    let name: String
    let count: Int
    let content: () -> Content
    @State private var expanded: Bool

    init(name: String, count: Int, @ViewBuilder content: @escaping () -> Content) {
        self.name = name
        self.count = count
        self.content = content
        _expanded = State(initialValue: count <= 30)
    }

    var body: some View {
        DisclosureGroup(isExpanded: $expanded) {
            if expanded { content() }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "folder")
                    .foregroundStyle(.secondary)
                    .frame(width: 16)
                Text(name)
                    .lineLimit(1)
                Spacer(minLength: 4)
                if !expanded {
                    Text("\(count)")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.tertiary)
                }
            }
        }
    }
}

/// A remote in the REMOTE section: drop a local branch onto it to push.
private struct RemoteGroup<Content: View>: View {
    let remote: Remote
    let model: RepoModel
    let icon: String
    let forceExpanded: Bool
    @ViewBuilder let content: () -> Content
    @State private var expanded = false

    var body: some View {
        let isExpanded = expanded || forceExpanded
        DisclosureGroup(isExpanded: Binding(get: { isExpanded }, set: { expanded = $0 })) {
            if isExpanded { content() }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .foregroundStyle(.secondary)
                    .frame(width: 16)
                Text(remote.name)
                    .lineLimit(1)
            }
            .help(remote.fetchURL + String(localized: "\nKéo một nhánh local thả vào đây để push lên \(remote.name)"))
            .dropDestination(for: String.self) { items, _ in
                guard let name = items.first, let source = model.refs.first(where: { $0.fullName == name }) else { return false }
                model.dragRequest = DragRequest(source: source, target: .remote(remote))
                return true
            }
            .contextMenu {
                Button("Fetch") { model.fetch() }
                Button("Sao chép URL") { model.copy(remote.fetchURL, label: "URL") }
                Divider()
                Button("Xoá remote…", role: .destructive) { model.removeRemote(remote) }
            }
        }
    }
}

/// Clear the sidebar selection when the user picks another commit on the graph. Split out so SidebarView doesn't depend
/// on `model.selection` (changing the selected commit doesn't rebuild the whole branch list).
private struct SidebarSelectionSync: View {
    let model: RepoModel
    @Binding var selection: String?

    var body: some View {
        Color.clear
            .onChange(of: model.selection) { _, newValue in
                guard let current = selection else { return }
                switch newValue {
                case .commit(let sha):
                    let fullName = current.hasPrefix("ref:") ? String(current.dropFirst(4)) : ""
                    if model.refs.first(where: { $0.fullName == fullName })?.target != sha { selection = nil }
                case .stash(let sha):
                    if current != "stash:" + sha { selection = nil }
                default:
                    selection = nil
                }
            }
    }
}
