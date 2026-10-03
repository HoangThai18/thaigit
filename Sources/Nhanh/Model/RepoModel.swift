import AppKit
import NhanhCore
import SwiftUI

/// Trạng thái và hành động của một repository đang mở (một tab).
@Observable
final class RepoModel {
    let repository: GitRepository
    let commandLog: CommandLog

    var name: String { repository.name }
    var rootPath: String { repository.root.path }

    // MARK: - Dữ liệu repository

    private(set) var refs: [GitRef] = []
    /// Lọc + sắp xếp sẵn mỗi khi refs đổi (không tính lại trong body của view — repo lớn có hàng nghìn ref).
    private(set) var localBranches: [GitRef] = []
    private(set) var remoteBranches: [GitRef] = []
    private(set) var tags: [GitRef] = []
    private(set) var status = WorkingTreeStatus.empty
    private(set) var stashes: [Stash] = []
    private(set) var remotes: [Remote] = []
    private(set) var operation: RepoOperation?
    /// Tên / email commit đang có hiệu lực (đọc khi mở repo và khi đổi danh tính).
    var committerIdentity: CommitterIdentity?
    private(set) var entries: [GraphEntry] = []
    private(set) var graphVersion = 0
    private(set) var graphWidth = 1
    private(set) var mayHaveMoreCommits = false
    private(set) var isLoadingHistory = false
    private(set) var hasLoaded = false
    var lastFetch: Date? {
        didSet { loadPullRequests() }
    }
    /// Nhánh ẩn / solo trên graph, nhớ riêng cho từng repo (xem RepoModel+GraphFilter.swift).
    var graphFilter = GraphRefFilter() {
        didSet {
            guard graphFilter != oldValue else { return }
            saveGraphFilter()
            requestRefresh(.history)
        }
    }
    /// Pull Request đang mở trên GitHub (xem RepoModel+PullRequests.swift).
    var pullRequests = PullRequestList()
    @ObservationIgnored var pullRequestsTask: Task<Void, Never>?

    @ObservationIgnored private var rowIndex: [String: Int] = [:]
    @ObservationIgnored private var rawCommits: [Commit] = []
    @ObservationIgnored private(set) var commitLimit = Prefs.commitLimitValue
    @ObservationIgnored private var refsFingerprint = ""

    // MARK: - Lựa chọn, chi tiết, diff

    private(set) var selection: RepoSelection = .none
    private(set) var commitDetails: CommitDetails?
    /// Kết quả khi đang so sánh hai commit / nhánh (`selection == .compare`).
    private(set) var comparison: Comparison?
    private(set) var isLoadingDetails = false
    var openFile: OpenFile?
    /// File đang sửa ngay trong app (xem RepoModel+FileEditor.swift).
    var fileEditor: FileEditorSession?
    /// Terminal đơn giản dưới graph (xem TerminalSession.swift), tạo khi mở lần đầu.
    var terminal: TerminalSession?
    /// Submodule, worktree, Git Flow, LFS (xem RepoModel+Advanced.swift).
    var extras = RepoExtras()
    var diffState: DiffState = .idle
    /// Các dòng đang chọn trong diff để stage/unstage/huỷ từng dòng: id hunk → chỉ số dòng.
    var lineSelection: [Int: Set<Int>] = [:]
    var scrollRequest: ScrollRequest?

    // MARK: - Commit đang soạn

    var commitSummary = ""
    var commitBody = ""
    var amendLastCommit = false {
        didSet { if amendLastCommit != oldValue { amendToggled() } }
    }
    var selectedUnstaged: Set<String> = []
    var selectedStaged: Set<String> = []

    // MARK: - Giao diện

    var busy: BusyState?
    var toasts: [Toast] = []
    var sheet: RepoSheet?
    var confirmation: Confirmation?
    var dragRequest: DragRequest?
    var showInspector = true
    var searchText = "" {
        didSet { if searchText != oldValue { updateSearch() } }
    }
    private(set) var searchMatches: [Int] = []
    private(set) var searchMatchSet: Set<Int> = []

    // MARK: - Nội bộ

    @ObservationIgnored private var watcher: RepoWatcher?
    @ObservationIgnored private var refreshTask: Task<Void, Never>?
    @ObservationIgnored private var pendingRefresh: RefreshScope = []
    @ObservationIgnored private var fileSystemPending: RefreshScope = []
    @ObservationIgnored private var fileSystemDebounce: Task<Void, Never>?
    @ObservationIgnored private var detailsTask: Task<Void, Never>?
    @ObservationIgnored var diffTask: Task<Void, Never>?
    @ObservationIgnored private var operationChain: Task<Void, Never>?
    @ObservationIgnored private var currentOperationTask: Task<Void, Never>?
    @ObservationIgnored private var runningOperations = 0
    @ObservationIgnored private var autoFetchTask: Task<Void, Never>?
    @ObservationIgnored private var lastProgressUpdate = Date.distantPast
    @ObservationIgnored private var isActive = false
    @ObservationIgnored private var didChooseInitialSelection = false
    @ObservationIgnored var savedSummaryBeforeAmend: (String, String)?
    /// Message app tự điền từ MERGE_MSG khi đang merge/revert — để dọn đi khi thao tác kết thúc ngoài ô commit
    /// (nút "Tiếp tục", terminal) mà người dùng chưa sửa gì.
    @ObservationIgnored var prefilledCommitMessage: (summary: String, body: String)?

    init(repository: GitRepository, commandLog: CommandLog) {
        self.repository = repository
        self.commandLog = commandLog
    }

    static func open(path: String, appState: AppState) async throws -> RepoModel {
        let log = CommandLog()
        let repository = try await GitRepository.open(at: URL(fileURLWithPath: path), environment: appState.environment) { record in
            log.append(record)
        }
        let model = RepoModel(repository: repository, commandLog: log)
        // Nạp trước submodule / worktree / Git Flow: sidebar có đủ các mục ngay lần vẽ đầu (chèn mục vào List sau đó
        // làm NSTableView của sidebar cập nhật lồng nhau).
        model.extras = await RepoExtras.load(repository)
        return model
    }

    // MARK: - Vòng đời

    func start() {
        guard !isActive else { return }
        isActive = true
        loadGraphFilter()
        requestRefresh(.all)
        let watcher = RepoWatcher(root: repository.root, gitDir: repository.gitDir, commonDir: repository.commonDir) { [weak self] change in
            Task { @MainActor in self?.handleFileSystemChange(change) }
        }
        watcher.start()
        self.watcher = watcher
        scheduleAutoFetch()
        loadCommitterIdentity()
    }

    func stop() {
        isActive = false
        watcher?.stop()
        watcher = nil
        autoFetchTask?.cancel()
        fileSystemDebounce?.cancel()
    }

    // MARK: - Thuộc tính tiện dụng

    var headOID: String? { status.head.oid }
    var currentBranch: String? { status.head.branchName }
    var currentBranchRef: GitRef? {
        guard let currentBranch else { return nil }
        return refs.first { $0.kind == .localBranch && $0.name == currentBranch }
    }
    /// Nhánh local mới làm việc gần đây nhất (cho menu đổi nhánh nhanh).
    func recentLocalBranches(limit: Int) -> [GitRef] {
        guard localBranches.count > limit else { return localBranches }
        return Array(localBranches.sorted { ($0.isHead ? Date.distantFuture : $0.date ?? .distantPast) > ($1.isHead ? Date.distantFuture : $1.date ?? .distantPast) }
            .prefix(limit))
    }
    var hasWorkingTreeRow: Bool { entries.first?.commit.isWorkingTree == true }
    var shouldShowWorkingTree: Bool { !status.isClean || operation != nil }
    var isBusy: Bool { busy != nil }

    var headDescription: String {
        switch status.head {
        case .branch(let name, _): return name
        case .detached(let oid): return "HEAD tách rời @ \(oid.prefix(7))"
        case .unknown: return ""
        }
    }

    var branchSubtitle: String {
        var parts = [headDescription]
        if status.ahead > 0 { parts.append("↑\(status.ahead)") }
        if status.behind > 0 { parts.append("↓\(status.behind)") }
        if let operation { parts.append("· \(operation.title)") }
        return parts.joined(separator: " ")
    }

    var defaultRemote: String? {
        if let upstream = currentBranchRef?.upstream, let remote = upstream.split(separator: "/").first.map(String.init),
           remotes.contains(where: { $0.name == remote }) {
            return remote
        }
        return remotes.first { $0.name == "origin" }?.name ?? remotes.first?.name
    }

    func entry(at row: Int) -> GraphEntry? {
        entries.indices.contains(row) ? entries[row] : nil
    }

    func commit(for sha: String) -> Commit? {
        guard let row = rowIndex[sha] else { return nil }
        return entries[row].commit
    }

    func row(for selection: RepoSelection) -> Int? {
        switch selection {
        case .workingTree: return hasWorkingTreeRow ? 0 : nil
        case .commit(let sha): return rowIndex[sha]
        default: return nil
        }
    }

    var selectedRow: Int? { row(for: selection) }

    // MARK: - Làm mới dữ liệu

    func refreshEverything() {
        requestRefresh(.all)
    }

    func requestRefresh(_ scope: RefreshScope) {
        pendingRefresh.formUnion(scope)
        guard refreshTask == nil else { return }
        refreshTask = Task {
            while !pendingRefresh.isEmpty {
                let next = pendingRefresh
                pendingRefresh = []
                await performRefresh(next)
            }
            refreshTask = nil
        }
    }

    func refreshAndWait(_ scope: RefreshScope) async {
        requestRefresh(scope)
        if let refreshTask { await refreshTask.value }
    }

    private nonisolated static func load<T: Sendable>(_ enabled: Bool, _ body: @Sendable () async throws -> T) async -> Result<T, any Error>? {
        guard enabled else { return nil }
        do {
            return .success(try await body())
        } catch {
            return .failure(error)
        }
    }

    private func performRefresh(_ scope: RefreshScope) async {
        let repo = repository
        let wantsRefs = scope.contains(.refs) || !hasLoaded
        let wantsStatus = scope.contains(.status) || !hasLoaded
        async let statusResult = Self.load(wantsStatus) { try await repo.status() }
        async let refsResult = Self.load(wantsRefs) { try await repo.refs() }
        async let stashResult = Self.load(wantsRefs) { try await repo.stashes() }
        async let remoteResult = Self.load(wantsRefs) { try await repo.remotes() }
        let (newStatus, newRefs, newStashes, newRemotes) = await (statusResult, refsResult, stashResult, remoteResult)

        var statusChanged = false
        switch newStatus {
        case .success(let value)?:
            if value != status {
                status = value
                statusChanged = true
            }
        case .failure(let error)?:
            if !FileManager.default.fileExists(atPath: repository.root.path) {
                toast(.error, "Không tìm thấy thư mục repository", message: repository.root.path)
                return
            }
            showError("Không đọc được trạng thái repository", error)
        case nil:
            break
        }
        if case .success(let value)? = newRefs, value != refs { updateRefs(value) }
        if case .success(let value)? = newStashes, value != stashes {
            stashes = value
            if case .stash(let sha) = selection, !value.contains(where: { $0.sha == sha }) { select(.none) }
        }
        if case .success(let value)? = newRemotes, value != remotes {
            remotes = value
            loadPullRequests()
        }
        if wantsRefs { loadExtras() }
        let newOperation = repository.operationState()
        if newOperation != operation { operation = newOperation }
        // Hết xung đột thì ẩn các cảnh báo xung đột cũ.
        if status.conflicts.isEmpty, toasts.contains(where: { $0.tag == "conflict" }) {
            withAnimation(.snappy) { toasts.removeAll { $0.tag == "conflict" } }
        }

        let fingerprint = makeFingerprint()
        if scope.contains(.history) || fingerprint != refsFingerprint || !hasLoaded {
            refsFingerprint = fingerprint
            await reloadHistory()
        } else if shouldShowWorkingTree != hasWorkingTreeRow {
            await relayoutGraph()
        } else if wantsRefs {
            refreshLabels()
        }
        hasLoaded = true

        if statusChanged || scope.contains(.status) {
            statusDidChange()
        }
    }

    private func updateRefs(_ value: [GitRef]) {
        refs = value
        func sorted(_ kind: RefKind, _ order: ComparisonResult) -> [GitRef] {
            value.filter { $0.kind == kind }.sorted { $0.name.localizedStandardCompare($1.name) == order }
        }
        localBranches = sorted(.localBranch, .orderedAscending)
        remoteBranches = sorted(.remoteBranch, .orderedAscending)
        tags = sorted(.tag, .orderedDescending)
    }

    private func makeFingerprint() -> String {
        var parts = refs.map { $0.fullName + "=" + $0.target }
        parts.append("HEAD=\(status.head.oid ?? "-")@\(status.head.branchName ?? "-")")
        parts.append("remotes=\(Prefs.showRemoteBranchesValue),tags=\(Prefs.showTagsValue),order=\(Prefs.logOrderValue.rawValue)")
        return parts.joined(separator: "\n")
    }

    private func reloadHistory() async {
        isLoadingHistory = true
        defer { isLoadingHistory = false }
        let repo = repository
        let limit = commitLimit
        let order = Prefs.logOrderValue
        let head = status.head
        let showWIP = shouldShowWorkingTree
        let includeRemotes = Prefs.showRemoteBranchesValue
        let includeTags = Prefs.showTagsValue
        let filter = graphFilter.keeping(Set(refs.map(\.fullName)))
        do {
            let history = try await repo.history(limit: limit, order: order, head: head, showWorkingTree: showWIP,
                                                 includeRemotes: includeRemotes, includeTags: includeTags, filter: filter)
            rawCommits = showWIP ? Array(history.commits.dropFirst()) : history.commits
            mayHaveMoreCommits = history.mayHaveMore
            applyGraph(commits: history.commits, rows: history.rows)
        } catch {
            showError("Không tải được lịch sử commit", error)
        }
    }

    private func relayoutGraph() async {
        var commits = rawCommits
        if shouldShowWorkingTree { commits.insert(.workingTree(parent: status.head.oid), at: 0) }
        let rows = await GitRepository.layout(commits)
        applyGraph(commits: commits, rows: rows)
    }

    /// Tải thêm commit cũ hơn khi cuộn tới cuối graph.
    func loadMoreHistory() {
        guard mayHaveMoreCommits, !isLoadingHistory else { return }
        commitLimit += max(2000, commitLimit / 2)
        isLoadingHistory = true
        Task { await reloadHistory() }
    }

    private func applyGraph(commits: [Commit], rows: [GraphRow]) {
        let labels = labelsByCommit()
        var newEntries: [GraphEntry] = []
        newEntries.reserveCapacity(commits.count)
        var index: [String: Int] = [:]
        index.reserveCapacity(commits.count)
        var width = 1
        for (position, commit) in commits.enumerated() {
            let row = rows[position]
            newEntries.append(GraphEntry(commit: commit, row: row, labels: labels[commit.id] ?? []))
            index[commit.id] = position
            width = max(width, row.width)
        }
        entries = newEntries
        rowIndex = index
        graphWidth = width
        graphVersion += 1
        updateSearch()
        validateSelection()
    }

    func refreshLabels() {
        let labels = labelsByCommit()
        var changed = false
        for position in entries.indices {
            let newLabels = labels[entries[position].commit.id] ?? []
            if newLabels != entries[position].labels {
                entries[position].labels = newLabels
                changed = true
            }
        }
        if changed { graphVersion += 1 }
    }

    private func validateSelection() {
        if !didChooseInitialSelection, hasLoaded || !entries.isEmpty {
            didChooseInitialSelection = true
            if hasWorkingTreeRow {
                select(.workingTree, reveal: true)
            } else if let head = headOID, rowIndex[head] != nil {
                select(.commit(head), reveal: true)
            }
            return
        }
        switch selection {
        case .workingTree where !hasWorkingTreeRow:
            if let head = headOID, rowIndex[head] != nil { select(.commit(head)) } else { select(.none) }
        case .commit(let sha) where rowIndex[sha] == nil:
            select(.none)
        default:
            break
        }
    }

    /// Nhãn nhánh/tag theo commit.
    private func labelsByCommit() -> [String: [RefLabel]] {
        let showRemotes = Prefs.showRemoteBranchesValue
        let showTags = Prefs.showTagsValue
        let singleRemote = Set(refs.compactMap(\.remoteName)).count <= 1
        let current = status.head.branchName
        var byTarget: [String: [GitRef]] = [:]
        // Nhánh đang ẩn (hoặc ngoài nhóm solo) không có nhãn; nhánh đang checkout và tag luôn hiện.
        for ref in refs where ref.kind == .tag || graphFilter.isVisible(ref.fullName) || (ref.kind == .localBranch && ref.name == current) {
            byTarget[ref.target, default: []].append(ref)
        }

        var result: [String: [RefLabel]] = [:]
        for (target, group) in byTarget {
            var labels: [RefLabel] = []
            var usedRemotes = Set<String>()
            let remoteRefs = group.filter { $0.kind == .remoteBranch }.sorted { $0.name < $1.name }
            for local in group.filter({ $0.kind == .localBranch }).sorted(by: { $0.name < $1.name }) {
                var label = RefLabel(text: local.name, isCurrentBranch: local.name == current, hasLocal: true, refs: [local])
                for remote in remoteRefs where !usedRemotes.contains(remote.fullName)
                    && (remote.name == local.upstream || remote.shortBranchName == local.name) {
                    label.remoteCount += 1
                    label.refs.append(remote)
                    usedRemotes.insert(remote.fullName)
                }
                labels.append(label)
            }
            if showRemotes {
                for remote in remoteRefs where !usedRemotes.contains(remote.fullName) {
                    labels.append(RefLabel(text: singleRemote ? remote.shortBranchName : remote.name, remoteCount: 1, refs: [remote]))
                }
            }
            if showTags {
                for tag in group.filter({ $0.kind == .tag }).sorted(by: { $0.name < $1.name }) {
                    labels.append(RefLabel(text: tag.name, isTag: true, refs: [tag]))
                }
            }
            labels.sort { rank($0) < rank($1) }
            markPullRequests(in: &labels)
            if !labels.isEmpty { result[target] = labels }
        }
        if case .detached(let oid) = status.head {
            result[oid, default: []].insert(RefLabel(text: "HEAD", isDetachedHead: true), at: 0)
        }
        return result
    }

    private func rank(_ label: RefLabel) -> Int {
        if label.isDetachedHead || label.isCurrentBranch { return 0 }
        if label.hasLocal { return 1 }
        if label.isTag { return 3 }
        return 2
    }

    // MARK: - Theo dõi file

    private func handleFileSystemChange(_ change: RepoWatcher.Change) {
        guard isActive else { return }
        if change.contains(.workingTree) { fileSystemPending.insert(.status) }
        if change.contains(.refs) { fileSystemPending.formUnion([.refs, .status]) }
        // Khi đang chạy thao tác, việc làm mới sẽ diễn ra sau khi thao tác xong.
        guard runningOperations == 0, fileSystemDebounce == nil else { return }
        fileSystemDebounce = Task {
            try? await Task.sleep(for: .milliseconds(300))
            fileSystemDebounce = nil
            guard runningOperations == 0 else { return }
            let scope = fileSystemPending
            fileSystemPending = []
            if !scope.isEmpty { requestRefresh(scope) }
        }
    }

    private func scheduleAutoFetch() {
        autoFetchTask?.cancel()
        autoFetchTask = Task {
            var waited = 0
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(60))
                guard !Task.isCancelled else { return }
                waited += 1
                let minutes = Prefs.autoFetchMinutesValue
                guard minutes > 0, waited >= minutes else { continue }
                waited = 0
                guard !remotes.isEmpty, busy == nil, runningOperations == 0 else { continue }
                await silentFetch()
            }
        }
    }

    private func silentFetch() async {
        let repo = repository
        do {
            // Không bật hộp thoại xác thực khi tự động fetch.
            try await repo.fetch(remote: nil, prune: Prefs.fetchPruneValue,
                                 environment: ["GIT_ASKPASS": "/usr/bin/false", "SSH_ASKPASS": "/usr/bin/false"])
            lastFetch = Date()
            requestRefresh([.refs, .status])
        } catch {
            // Bỏ qua lỗi mạng khi fetch nền.
        }
    }

    // MARK: - Chọn commit

    func select(_ newSelection: RepoSelection, reveal: Bool = false) {
        if newSelection != selection {
            selection = newSelection
            closeFile()
            loadDetails()
        }
        if reveal, let row = row(for: newSelection) {
            scrollRequest = ScrollRequest(row: row)
        }
    }

    func selectWorkingTree() {
        if hasWorkingTreeRow {
            select(.workingTree, reveal: true)
        } else {
            toast(.info, "Không có thay đổi nào chưa commit")
        }
    }

    func revealHead() {
        guard let head = headOID else { return }
        reveal(commit: head)
    }

    func reveal(commit sha: String) {
        if rowIndex[sha] != nil {
            select(.commit(sha), reveal: true)
        } else {
            toast(.info, "Commit \(sha.prefix(7)) nằm ngoài \(commitLimit) commit đã tải",
                  actions: mayHaveMoreCommits ? [ToastAction(title: "Tải thêm") { [weak self] in self?.loadMoreHistory() }] : [])
        }
    }

    func reveal(ref: GitRef) {
        reveal(commit: ref.target)
    }

    private func loadDetails() {
        detailsTask?.cancel()
        switch selection {
        case .commit(let sha):
            guard let commit = commit(for: sha) else {
                commitDetails = nil
                return
            }
            if commitDetails?.commit.id == sha { return }
            isLoadingDetails = true
            let repo = repository
            detailsTask = Task {
                // Trễ một chút để lướt nhanh bằng phím mũi tên không tạo quá nhiều lệnh git.
                try? await Task.sleep(for: .milliseconds(35))
                guard !Task.isCancelled else { return }
                do {
                    async let message = repo.commitMessage(sha)
                    async let files = repo.changedFiles(commit: sha, parent: commit.parents.first)
                    let details = CommitDetails(commit: commit, message: try await message, files: try await files)
                    guard !Task.isCancelled else { return }
                    commitDetails = details
                } catch {
                    guard !Task.isCancelled else { return }
                    commitDetails = nil
                    showError("Không tải được chi tiết commit", error)
                }
                isLoadingDetails = false
            }
        case .stash(let sha):
            guard let stash = stashes.first(where: { $0.sha == sha }) else {
                commitDetails = nil
                return
            }
            isLoadingDetails = true
            let repo = repository
            detailsTask = Task {
                do {
                    let files = try await repo.stashFiles(stash)
                    guard !Task.isCancelled else { return }
                    let commit = Commit(id: stash.sha, parents: stash.parents, authorName: "", authorEmail: "",
                                        authorDate: stash.date, committerName: "", committerEmail: "",
                                        commitDate: stash.date, subject: stash.displayMessage)
                    commitDetails = CommitDetails(commit: commit, message: stash.message, files: files)
                } catch {
                    guard !Task.isCancelled else { return }
                    showError("Không tải được nội dung stash", error)
                }
                isLoadingDetails = false
            }
        case .compare(let from, let to):
            commitDetails = nil
            if comparison?.from == from, comparison?.to == to { return }
            comparison = nil
            isLoadingDetails = true
            let repo = repository
            let fromLabel = compareLabel(for: from)
            let toLabel = compareLabel(for: to)
            detailsTask = Task {
                do {
                    async let files = repo.changedFiles(commit: to, parent: from)
                    async let commits = repo.commits(from: from, to: to)
                    let result = Comparison(from: from, to: to, fromLabel: fromLabel, toLabel: toLabel,
                                            files: try await files, commits: try await commits)
                    guard !Task.isCancelled else { return }
                    comparison = result
                } catch {
                    guard !Task.isCancelled else { return }
                    showError("Không so sánh được", error)
                }
                isLoadingDetails = false
            }
        case .workingTree, .none:
            commitDetails = nil
            isLoadingDetails = false
        }
    }

    // MARK: - Tìm kiếm

    private func updateSearch() {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else {
            if !searchMatches.isEmpty {
                searchMatches = []
                searchMatchSet = []
            }
            return
        }
        var matches: [Int] = []
        for (position, entry) in entries.enumerated() where !entry.commit.isWorkingTree {
            let commit = entry.commit
            if commit.subject.localizedStandardContains(query)
                || commit.authorName.localizedStandardContains(query)
                || commit.authorEmail.localizedStandardContains(query)
                || commit.id.hasPrefix(query.lowercased())
                || entry.labels.contains(where: { $0.text.localizedStandardContains(query) }) {
                matches.append(position)
            }
        }
        searchMatches = matches
        searchMatchSet = Set(matches)
    }

    func selectNextSearchMatch(backward: Bool = false) {
        guard !searchMatches.isEmpty else { return }
        let current = selectedRow ?? (backward ? Int.max : -1)
        let target: Int
        if backward {
            target = searchMatches.last(where: { $0 < current }) ?? searchMatches.last!
        } else {
            target = searchMatches.first(where: { $0 > current }) ?? searchMatches.first!
        }
        if let entry = entry(at: target) {
            select(.commit(entry.commit.id), reveal: true)
        }
    }

    // MARK: - Thông báo

    func toast(_ style: Toast.Style, _ title: String, message: String? = nil, actions: [ToastAction] = [], tag: String? = nil) {
        let toast = Toast(style: style, title: title, message: message, actions: actions, tag: tag)
        withAnimation(.snappy) {
            toasts.append(toast)
            if toasts.count > 4 { toasts.removeFirst(toasts.count - 4) }
        }
        if !toast.isPersistent {
            Task {
                try? await Task.sleep(for: .seconds(toast.lifetime))
                dismissToast(toast.id)
            }
        }
    }

    func dismissToast(_ id: UUID) {
        withAnimation(.snappy) { toasts.removeAll { $0.id == id } }
    }

    /// Toast lỗi: chỉ câu thân thiện (FriendlyError) — không bao giờ hiện stderr / mô tả lỗi hệ thống.
    func showError(_ title: String, _ error: any Error, actions: [ToastAction] = []) {
        let message = FriendlyError.message(for: error)
        toast(.error, title, message: message == title ? nil : message, actions: actions)
    }

    func toggleInspector() {
        withAnimation { showInspector.toggle() }
    }

    // MARK: - Chạy thao tác git

    /// Chạy một thao tác git: các thao tác được xếp hàng tuần tự (tránh tranh chấp index.lock),
    /// tự làm mới dữ liệu khi xong và hiện lỗi dạng thông báo.
    func perform(
        _ title: String,
        showsProgress: Bool = false,
        cancellable: Bool = false,
        refresh: RefreshScope = .all,
        _ work: @escaping (GitRepository) async throws -> Void,
        onSuccess: (() -> Void)? = nil,
        onError: ((any Error) -> Bool)? = nil
    ) {
        let previous = operationChain
        runningOperations += 1
        let task = Task {
            await previous?.value
            if showsProgress {
                busy = BusyState(title: title, canCancel: cancellable)
            }
            do {
                try Task.checkCancellation()
                try await work(repository)
                onSuccess?()
            } catch is CancellationError {
                toast(.info, "Đã huỷ: \(title)")
            } catch {
                if Task.isCancelled {
                    toast(.info, "Đã huỷ: \(title)")
                } else if !(onError?(error) ?? false) {
                    showError(title, error)
                }
            }
            if showsProgress { busy = nil }
            runningOperations -= 1
            let scope = refresh.union(fileSystemPending)
            fileSystemPending = []
            await refreshAndWait(scope)
        }
        currentOperationTask = task
        operationChain = task
    }

    func cancelCurrentOperation() {
        currentOperationTask?.cancel()
    }

    /// Hàm báo tiến độ cho lệnh mạng (fetch/pull/push/clone).
    func progressReporter() -> @Sendable (String) -> Void {
        { [weak self] line in
            Task { @MainActor in self?.updateProgress(line) }
        }
    }

    private func updateProgress(_ line: String) {
        guard busy != nil else { return }
        let now = Date()
        let fraction = GitParsers.progressFraction(line)
        guard now.timeIntervalSince(lastProgressUpdate) > 0.08 || fraction == 1 else { return }
        lastProgressUpdate = now
        busy?.detail = line
        if let fraction { busy?.fraction = fraction }
    }
}
