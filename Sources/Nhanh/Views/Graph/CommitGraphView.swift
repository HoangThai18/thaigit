import AppKit
import NhanhCore
import SwiftUI

/// Bảng commit + graph, dùng NSTableView để cuộn mượt với hàng chục nghìn commit.
struct CommitGraphView: View {
    @Bindable var model: RepoModel

    var body: some View {
        ZStack {
            CommitTable(
                model: model,
                entries: model.entries,
                version: model.graphVersion,
                graphWidth: model.graphWidth,
                selectedRow: model.selectedRow,
                compareRows: model.compareRows,
                scrollRequest: model.scrollRequest,
                searchMatches: model.searchMatchSet,
                isSearching: !model.searchText.trimmingCharacters(in: .whitespaces).isEmpty,
                headOID: model.headOID,
                workingTreeSummary: workingTreeSummary,
                isHidden: model.openFile != nil
            )
            if model.hasLoaded && model.entries.isEmpty {
                ContentUnavailableView {
                    Label("Chưa có commit nào", systemImage: "sparkles")
                } description: {
                    Text("Thêm file vào thư mục repository, sau đó stage và tạo commit đầu tiên ở panel bên phải.")
                }
            } else if !model.hasLoaded {
                ProgressView("Đang tải lịch sử…")
            }
        }
        .overlay(alignment: .bottom) {
            if !model.searchText.isEmpty {
                SearchBar(model: model)
                    .padding(.bottom, 12)
            }
        }
    }

    private var workingTreeSummary: String {
        let status = model.status
        var parts: [String] = []
        if !status.conflicts.isEmpty { parts.append(String(localized: "⚠︎ \(status.conflicts.count) xung đột")) }
        let modified = Set(status.unstaged.filter { $0.kind != .untracked }.map(\.path) + status.staged.map(\.path)).count
        let untracked = status.unstaged.filter { $0.kind == .untracked }.count
        if modified > 0 { parts.append(String(localized: "✎ \(modified) file sửa")) }
        if untracked > 0 { parts.append(String(localized: "＋ \(untracked) file mới")) }
        if !status.staged.isEmpty { parts.append(String(localized: "● \(status.staged.count) đã stage")) }
        return parts.joined(separator: "   ")
    }
}

private struct SearchBar: View {
    @Bindable var model: RepoModel

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
            Text(model.searchMatches.isEmpty ? String(localized: "Không tìm thấy commit nào") : String(localized: "\(model.searchMatches.count) commit khớp"))
                .font(.callout)
            Button { model.selectNextSearchMatch(backward: true) } label: { Image(systemName: "chevron.up") }
                .disabled(model.searchMatches.isEmpty)
                .keyboardShortcut("g", modifiers: [.command, .shift])
            Button { model.selectNextSearchMatch() } label: { Image(systemName: "chevron.down") }
                .disabled(model.searchMatches.isEmpty)
                .keyboardShortcut("g", modifiers: [.command])
            Button { model.searchText = "" } label: { Image(systemName: "xmark.circle.fill") }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .glassSurface(in: Capsule())
    }
}

private enum Column {
    static let refs = NSUserInterfaceItemIdentifier("refs")
    static let graph = NSUserInterfaceItemIdentifier("graph")
    static let message = NSUserInterfaceItemIdentifier("message")
    static let author = NSUserInterfaceItemIdentifier("author")
    static let date = NSUserInterfaceItemIdentifier("date")
    static let sha = NSUserInterfaceItemIdentifier("sha")

    /// Cột phụ bật/tắt bằng chuột phải lên tiêu đề cột. Mặc định tắt cả, như GitKraken: tác giả là ảnh đại diện
    /// trên graph, tên và thời gian xem ở panel bên phải.
    static let optional: [(id: NSUserInterfaceItemIdentifier, title: String)] = [(author, String(localized: "Tác giả")), (date, String(localized: "Thời gian")), (sha, "SHA")]
    static let enabledOptionalKey = "graphOptionalColumns"
}

private struct CommitTable: NSViewRepresentable {
    let model: RepoModel
    let entries: [GraphEntry]
    let version: Int
    let graphWidth: Int
    let selectedRow: Int?
    /// Hai dòng đang so sánh (giữ ⌘ bấm 2 commit) — khi đó bảng chọn cả hai dòng.
    let compareRows: IndexSet?
    let scrollRequest: ScrollRequest?
    let searchMatches: Set<Int>
    let isSearching: Bool
    let headOID: String?
    let workingTreeSummary: String
    let isHidden: Bool

    func makeCoordinator() -> Coordinator {
        Coordinator(model: model)
    }

    func makeNSView(context: Context) -> NSScrollView {
        let table = CommitNSTableView()
        table.style = .plain
        table.rowHeight = GraphStyle.rowHeight
        table.intercellSpacing = NSSize(width: 0, height: 0)
        table.gridStyleMask = []
        // Giữ ⌘ bấm commit thứ hai để so sánh hai commit (như GitKraken).
        table.allowsMultipleSelection = true
        table.allowsColumnReordering = true
        table.allowsColumnResizing = true
        table.columnAutoresizingStyle = .uniformColumnAutoresizingStyle
        table.usesAlternatingRowBackgroundColors = false
        table.backgroundColor = .clear
        table.focusRingType = .none
        table.headerView = NSTableHeaderView()

        func addColumn(_ id: NSUserInterfaceItemIdentifier, _ title: String, width: CGFloat, min: CGFloat, max: CGFloat, flexible: Bool = false) {
            let column = NSTableColumn(identifier: id)
            column.title = title
            column.width = width
            column.minWidth = min
            column.maxWidth = max
            column.resizingMask = flexible ? [.autoresizingMask, .userResizingMask] : [.userResizingMask]
            table.addTableColumn(column)
        }
        addColumn(Column.refs, String(localized: "Nhánh / Tag"), width: 190, min: 60, max: 600)
        addColumn(Column.graph, "Graph", width: 120, min: 40, max: 900)
        addColumn(Column.message, "Commit", width: 320, min: 160, max: 10_000, flexible: true)
        addColumn(Column.author, String(localized: "Tác giả"), width: 130, min: 60, max: 400)
        addColumn(Column.date, String(localized: "Thời gian"), width: 122, min: 60, max: 300)
        addColumn(Column.sha, "SHA", width: 74, min: 50, max: 160)
        table.autosaveName = "NhanhCommitTable"
        table.autosaveTableColumns = true

        table.dataSource = context.coordinator
        table.delegate = context.coordinator
        table.target = context.coordinator
        table.doubleAction = #selector(Coordinator.doubleClicked(_:))
        let menu = NSMenu()
        menu.autoenablesItems = false
        menu.delegate = context.coordinator
        table.menu = menu
        let headerMenu = context.coordinator.headerMenu
        headerMenu.autoenablesItems = false
        headerMenu.delegate = context.coordinator
        table.headerView?.menu = headerMenu
        table.onReturn = { [weak coordinator = context.coordinator] in coordinator?.activateSelectedRow() }
        // Kéo nhãn nhánh thả lên nhánh khác để merge/rebase/push (giống GitKraken).
        table.registerForDraggedTypes([.string])
        table.setDraggingSourceOperationMask([.move, .copy, .generic], forLocal: true)
        table.setDraggingSourceOperationMask(.copy, forLocal: false)
        table.draggingDestinationFeedbackStyle = .regular
        table.verticalMotionCanBeginDrag = true

        let scrollView = NSScrollView()
        scrollView.documentView = table
        scrollView.hasVerticalScroller = true
        scrollView.hasHorizontalScroller = true
        scrollView.autohidesScrollers = true
        scrollView.drawsBackground = false
        scrollView.contentView.postsBoundsChangedNotifications = true
        context.coordinator.table = table
        context.coordinator.observeScrolling(scrollView)
        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        let coordinator = context.coordinator
        guard let table = coordinator.table else { return }
        coordinator.model = model
        coordinator.githubRepo = model.githubRepo
        coordinator.headOID = headOID
        coordinator.workingTreeSummary = workingTreeSummary

        var needsReload = false
        if coordinator.version != version {
            coordinator.version = version
            coordinator.entries = entries
            needsReload = true
            if let graphColumn = table.tableColumn(withIdentifier: Column.graph) {
                let width = min(max(GraphStyle.width(forLanes: min(graphWidth, 40)), 64), 640)
                if abs(graphColumn.width - width) > 1 {
                    graphColumn.width = width
                    // Cột Commit co giãn bù lại để bảng vẫn vừa khung (không đẩy cột SHA ra ngoài).
                    if coordinator.didInitialSizing { coordinator.scheduleColumnFit() }
                }
            }
        }
        if coordinator.searchMatches != searchMatches || coordinator.isSearching != isSearching {
            coordinator.searchMatches = searchMatches
            coordinator.isSearching = isSearching
            needsReload = true
        }
        if coordinator.lastWorkingTreeSummary != workingTreeSummary {
            coordinator.lastWorkingTreeSummary = workingTreeSummary
            if !needsReload, !entries.isEmpty, entries[0].commit.isWorkingTree {
                table.reloadData(forRowIndexes: IndexSet(integer: 0), columnIndexes: IndexSet(integersIn: 0..<table.numberOfColumns))
            }
        }
        if needsReload {
            coordinator.isUpdatingSelection = true
            table.reloadData()
            coordinator.isUpdatingSelection = false
        }

        if !coordinator.didInitialSizing, scrollView.frame.width > 0 {
            coordinator.didInitialSizing = true
            coordinator.scheduleColumnFit()
        }

        let wantedRows = (compareRows ?? selectedRow.map { IndexSet(integer: $0) } ?? IndexSet())
            .filteredIndexSet { $0 < table.numberOfRows }
        if coordinator.pendingSelection == nil, table.selectedRowIndexes != wantedRows {
            coordinator.isUpdatingSelection = true
            table.selectRowIndexes(wantedRows, byExtendingSelection: false)
            coordinator.isUpdatingSelection = false
        }

        if let scrollRequest, scrollRequest != coordinator.lastScrollRequest {
            coordinator.lastScrollRequest = scrollRequest
            coordinator.scrollToCenter(row: scrollRequest.row)
        }

        if scrollView.isHidden != isHidden {
            scrollView.isHidden = isHidden
            if isHidden, table.window?.firstResponder === table {
                table.window?.makeFirstResponder(nil)
            } else if !isHidden {
                table.window?.makeFirstResponder(table)
            }
        }
    }

    final class Coordinator: NSObject, NSTableViewDataSource, NSTableViewDelegate, NSMenuDelegate {
        var model: RepoModel
        weak var table: NSTableView?
        var entries: [GraphEntry] = []
        var version = -1
        var searchMatches: Set<Int> = []
        var isSearching = false
        var headOID: String?
        var workingTreeSummary = ""
        var lastWorkingTreeSummary = ""
        var isUpdatingSelection = false
        var didInitialSizing = false
        /// Dòng người dùng vừa chọn nhưng chưa báo cho model (báo ở vòng lặp sau để tránh gọi lồng vào NSTableView).
        var pendingSelection: String?
        var lastScrollRequest: ScrollRequest?
        private var scrollObserver: NSObjectProtocol?
        private var frameObserver: NSObjectProtocol?
        /// Độ rộng người dùng muốn cho các cột phụ; bị co tạm khi thiếu chỗ, nới lại khi đủ chỗ.
        private var preferredWidths: [NSUserInterfaceItemIdentifier: CGFloat] = [:]
        private var isFittingColumns = false
        private var fitScheduled = false
        /// Cột phụ người dùng đã bật; cột chưa bật luôn ẩn.
        private var enabledOptional: Set<NSUserInterfaceItemIdentifier>
        let headerMenu = NSMenu()
        /// Repo GitHub của remote mặc định — giúp tìm ảnh đại diện qua API commit.
        var githubRepo: GitHubRepoRef?
        /// Gỡ khi coordinator bị huỷ (đóng tab / repo) — observer kiểu block không tự gỡ. `nonisolated(unsafe)` để deinit
        /// (không chạy trên MainActor) đọc được; chỉ ghi một lần trong init.
        nonisolated(unsafe) private var avatarObserver: NSObjectProtocol?

        private static let messageFont = NSFont.systemFont(ofSize: 13)
        private static let secondaryFont = NSFont.systemFont(ofSize: 12)
        private static let shaFont = NSFont.monospacedSystemFont(ofSize: 11.5, weight: .regular)

        /// Độ rộng do người dùng kéo được lưu riêng: autosave của NSTableView sẽ lưu cả độ rộng đang bị co tạm.
        private static let preferredWidthsKey = "graphColumnWidths"
        private static let defaultWidths: [NSUserInterfaceItemIdentifier: CGFloat] = [
            Column.refs: 190, Column.author: 130, Column.date: 122,
        ]

        init(model: RepoModel) {
            self.model = model
            let saved = UserDefaults.standard.dictionary(forKey: Self.preferredWidthsKey) as? [String: Double] ?? [:]
            for (id, width) in Self.defaultWidths {
                preferredWidths[id] = saved[id.rawValue].map { CGFloat($0) } ?? width
            }
            enabledOptional = Set((UserDefaults.standard.stringArray(forKey: Column.enabledOptionalKey) ?? [])
                .map { NSUserInterfaceItemIdentifier($0) })
            super.init()
            avatarObserver = NotificationCenter.default.addObserver(forName: AvatarStore.didChange, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.refreshAvatars() }
            }
        }

        deinit {
            if let avatarObserver { NotificationCenter.default.removeObserver(avatarObserver) }
        }

        /// Ảnh đại diện vừa tải xong: vẽ lại cột graph của các dòng đang hiện.
        private func refreshAvatars() {
            guard let table, let column = table.tableColumns.firstIndex(where: { $0.identifier == Column.graph }) else { return }
            let visible = table.rows(in: table.visibleRect)
            guard visible.length > 0 else { return }
            table.reloadData(forRowIndexes: IndexSet(integersIn: visible.location..<(visible.location + visible.length)),
                             columnIndexes: IndexSet(integer: column))
        }

        private func toggleColumn(_ id: NSUserInterfaceItemIdentifier) {
            if enabledOptional.contains(id) { enabledOptional.remove(id) } else { enabledOptional.insert(id) }
            UserDefaults.standard.set(enabledOptional.map(\.rawValue).sorted(), forKey: Column.enabledOptionalKey)
            scheduleColumnFit()
        }

        private func buildHeaderMenu(_ menu: NSMenu) {
            menu.addItem(.sectionHeader(title: String(localized: "Hiện cột")))
            for column in Column.optional {
                let item = MenuActionTarget.item(title: column.title) { [weak self] in self?.toggleColumn(column.id) }
                item.state = enabledOptional.contains(column.id) ? .on : .off
                menu.addItem(item)
            }
            menu.addItem(.separator())
            let avatars = MenuActionTarget.item(title: String(localized: "Ảnh đại diện thật (GitHub / Gravatar)")) { AvatarStore.shared.isEnabled.toggle() }
            avatars.state = AvatarStore.shared.isEnabled ? .on : .off
            avatars.toolTip = String(localized: "Tắt thì graph chỉ hiện chữ viết tắt và app không gửi gì ra mạng để tìm ảnh.")
            menu.addItem(avatars)
        }

        func observeScrolling(_ scrollView: NSScrollView) {
            scrollObserver = NotificationCenter.default.addObserver(
                forName: NSView.boundsDidChangeNotification, object: scrollView.contentView, queue: .main
            ) { [weak self] _ in
                MainActor.assumeIsolated { self?.checkLoadMore() }
            }
            scrollView.contentView.postsFrameChangedNotifications = true
            frameObserver = NotificationCenter.default.addObserver(
                forName: NSView.frameDidChangeNotification, object: scrollView.contentView, queue: .main
            ) { [weak self] _ in
                MainActor.assumeIsolated { self?.scheduleColumnFit() }
            }
        }

        /// Gom nhiều lần đổi kích thước thành một lần tính lại, sau vòng layout hiện tại.
        func scheduleColumnFit() {
            guard !fitScheduled else { return }
            fitScheduled = true
            DispatchQueue.main.async { [weak self] in
                MainActor.assumeIsolated {
                    self?.fitScheduled = false
                    self?.fitColumns()
                }
            }
        }

        /// Cột Commit lấp phần còn lại. Thiếu chỗ thì co tạm các cột phụ, hẹp quá nữa thì ẩn bớt
        /// SHA → Thời gian → Tác giả (hiện lại khi cửa sổ rộng ra) thay vì bắt cuộn ngang. Cột phụ chưa bật thì luôn ẩn.
        private func fitColumns() {
            guard let table, let clip = table.enclosingScrollView?.contentView, clip.bounds.width > 0,
                  let message = table.tableColumn(withIdentifier: Column.message) else { return }
            isFittingColumns = true
            defer { isFittingColumns = false }
            let available = clip.bounds.width
            let shrinkable: [(id: NSUserInterfaceItemIdentifier, floor: CGFloat)] = [
                (Column.author, 90), (Column.date, 116), (Column.refs, 110),
            ]
            for column in Column.optional where !enabledOptional.contains(column.id) {
                if let tableColumn = table.tableColumn(withIdentifier: column.id), !tableColumn.isHidden { tableColumn.isHidden = true }
            }
            let hideOrder = [Column.sha, Column.date, Column.author].filter { enabledOptional.contains($0) }
            func othersWidth() -> CGFloat {
                table.tableColumns.filter { $0 !== message && !$0.isHidden }.reduce(0) { $0 + $1.width }
            }
            for level in 0...hideOrder.count {
                for (index, id) in hideOrder.enumerated() {
                    let hidden = index < level
                    if let column = table.tableColumn(withIdentifier: id), column.isHidden != hidden { column.isHidden = hidden }
                }
                for item in shrinkable {
                    if let column = table.tableColumn(withIdentifier: item.id), let preferred = preferredWidths[item.id],
                       column.width != preferred {
                        column.width = preferred
                    }
                }
                var deficit = message.minWidth - (available - othersWidth())
                for item in shrinkable where deficit > 0 {
                    guard let column = table.tableColumn(withIdentifier: item.id), !column.isHidden else { continue }
                    let shrink = min(deficit, max(0, column.width - item.floor))
                    column.width -= shrink
                    deficit -= shrink
                }
                if deficit <= 0 { break }
            }
            let target = max(message.minWidth, available - othersWidth())
            if abs(message.width - target) > 0.5 { message.width = target }
        }

        func tableViewColumnDidResize(_ notification: Notification) {
            // Chỉ ghi nhớ khi chính người dùng đang kéo mép cột (không phải do tự co giãn).
            guard !isFittingColumns, let table, let header = table.headerView, header.resizedColumn >= 0,
                  header.resizedColumn < table.tableColumns.count,
                  let column = notification.userInfo?["NSTableColumn"] as? NSTableColumn,
                  table.tableColumns[header.resizedColumn] === column,
                  Self.defaultWidths[column.identifier] != nil else { return }
            preferredWidths[column.identifier] = column.width
            let saved = Dictionary(uniqueKeysWithValues: preferredWidths.map { ($0.key.rawValue, Double($0.value)) })
            UserDefaults.standard.set(saved, forKey: Self.preferredWidthsKey)
        }

        private func checkLoadMore() {
            guard let table, model.mayHaveMoreCommits, !model.isLoadingHistory, !entries.isEmpty else { return }
            let visible = table.rows(in: table.visibleRect)
            if visible.location + visible.length >= entries.count - 30 {
                model.loadMoreHistory()
            }
        }

        // MARK: Data source

        func numberOfRows(in tableView: NSTableView) -> Int {
            entries.count
        }

        func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
            guard let column = tableColumn, entries.indices.contains(row) else { return nil }
            let entry = entries[row]
            let dimmed = isSearching && !searchMatches.contains(row) && !entry.commit.isWorkingTree

            switch column.identifier {
            case Column.refs:
                let cell = tableView.makeView(withIdentifier: Column.refs, owner: nil) as? RefsCellView ?? {
                    let view = RefsCellView()
                    view.identifier = Column.refs
                    return view
                }()
                cell.laneColor = GraphStyle.color(entry.row.color)
                cell.dimmed = dimmed
                cell.labels = entry.labels
                return cell
            case Column.graph:
                let cell = tableView.makeView(withIdentifier: Column.graph, owner: nil) as? GraphCellView ?? {
                    let view = GraphCellView()
                    view.identifier = Column.graph
                    return view
                }()
                cell.isHead = entry.commit.id == headOID
                cell.dimmed = dimmed
                cell.avatar = entry.commit.isWorkingTree || entry.commit.isMerge ? nil
                    : AvatarStore.shared.image(email: entry.commit.authorEmail, repo: githubRepo)
                cell.entry = entry
                return cell
            case Column.message:
                let cell = textCell(tableView, Column.message, font: Self.messageFont)
                if entry.commit.isWorkingTree {
                    let paragraph = NSMutableParagraphStyle()
                    paragraph.lineBreakMode = .byTruncatingTail
                    let text = NSMutableAttributedString(string: "// WIP", attributes: [
                        .font: NSFontManager.shared.convert(Self.messageFont, toHaveTrait: .italicFontMask),
                        .foregroundColor: NSColor.secondaryLabelColor,
                        .paragraphStyle: paragraph,
                    ])
                    if !workingTreeSummary.isEmpty {
                        text.append(NSAttributedString(string: "    " + workingTreeSummary, attributes: [
                            .font: Self.secondaryFont,
                            .foregroundColor: NSColor.tertiaryLabelColor,
                            .paragraphStyle: paragraph,
                        ]))
                    }
                    cell.label.attributedStringValue = text
                } else {
                    cell.label.stringValue = entry.commit.subject
                    cell.label.textColor = dimmed ? .tertiaryLabelColor : .labelColor
                    cell.label.font = entry.commit.isMerge ? NSFont.systemFont(ofSize: 13, weight: .regular) : Self.messageFont
                    if entry.commit.isMerge { cell.label.textColor = dimmed ? .tertiaryLabelColor : .secondaryLabelColor }
                }
                cell.toolTip = entry.commit.isWorkingTree ? String(localized: "Thay đổi chưa commit — bấm để stage & commit") : entry.commit.subject
                return cell
            case Column.author:
                let cell = textCell(tableView, Column.author, font: Self.secondaryFont)
                cell.label.stringValue = entry.commit.isWorkingTree ? "" : entry.commit.authorName
                cell.label.textColor = dimmed ? .tertiaryLabelColor : .secondaryLabelColor
                cell.toolTip = entry.commit.isWorkingTree ? nil : "\(entry.commit.authorName) <\(entry.commit.authorEmail)>"
                return cell
            case Column.date:
                let cell = textCell(tableView, Column.date, font: Self.secondaryFont)
                cell.label.stringValue = entry.commit.isWorkingTree ? "" : Self.format(entry.commit.authorDate)
                cell.label.textColor = dimmed ? .tertiaryLabelColor : .secondaryLabelColor
                cell.toolTip = entry.commit.isWorkingTree ? nil : VietnameseDate.absolute(entry.commit.authorDate)
                return cell
            case Column.sha:
                let cell = textCell(tableView, Column.sha, font: Self.shaFont)
                cell.label.stringValue = entry.commit.isWorkingTree ? "" : entry.commit.shortSHA
                cell.label.textColor = dimmed ? .tertiaryLabelColor : .secondaryLabelColor
                return cell
            default:
                return nil
            }
        }

        private func textCell(_ tableView: NSTableView, _ identifier: NSUserInterfaceItemIdentifier, font: NSFont) -> TextCellView {
            if let cell = tableView.makeView(withIdentifier: identifier, owner: nil) as? TextCellView {
                cell.label.font = font
                cell.label.attributedStringValue = NSAttributedString(string: "")
                return cell
            }
            return TextCellView(identifier: identifier, font: font)
        }

        static func format(_ date: Date) -> String {
            let interval = Date().timeIntervalSince(date)
            if UserDefaults.standard.bool(forKey: Prefs.relativeDates), interval < 7 * 24 * 3600, interval > -60 {
                return VietnameseDate.relative(date)
            }
            return VietnameseDate.absolute(date)
        }

        // MARK: Delegate

        func tableViewSelectionDidChange(_ notification: Notification) {
            guard !isUpdatingSelection, let table else { return }
            // Chọn từ 2 commit trở lên: so sánh commit cũ nhất (dưới) với commit mới nhất (trên).
            let commits = table.selectedRowIndexes.filter { entries.indices.contains($0) && !entries[$0].commit.isWorkingTree }
            if commits.count >= 2, let newest = commits.min(), let oldest = commits.max() {
                let from = entries[oldest].commit.id
                let to = entries[newest].commit.id
                let marker = "compare:\(from):\(to)"
                pendingSelection = marker
                Task { @MainActor [weak self] in
                    guard let self, pendingSelection == marker else { return }
                    pendingSelection = nil
                    model.select(.compare(from: from, to: to))
                }
                return
            }
            let row = table.selectedRow
            guard entries.indices.contains(row) else { return }
            let id = entries[row].commit.id
            let isWorkingTree = entries[row].commit.isWorkingTree
            pendingSelection = id
            Task { @MainActor [weak self] in
                guard let self, pendingSelection == id else { return }
                pendingSelection = nil
                model.select(isWorkingTree ? .workingTree : .commit(id))
            }
        }

        func tableView(_ tableView: NSTableView, rowViewForRow row: Int) -> NSTableRowView? {
            let identifier = NSUserInterfaceItemIdentifier("commitRow")
            if let view = tableView.makeView(withIdentifier: identifier, owner: nil) as? CommitRowView { return view }
            let view = CommitRowView()
            view.identifier = identifier
            return view
        }

        @objc func doubleClicked(_ sender: Any?) {
            guard let table, entries.indices.contains(table.clickedRow) else { return }
            activate(entries[table.clickedRow])
        }

        func activateSelectedRow() {
            guard let table, entries.indices.contains(table.selectedRow) else { return }
            activate(entries[table.selectedRow])
        }

        /// Double-click: checkout nhánh trên dòng đó (như GitKraken); dòng WIP thì không làm gì.
        private func activate(_ entry: GraphEntry) {
            guard !entry.commit.isWorkingTree else { return }
            let current = model.currentBranch
            if let local = entry.labels.compactMap(\.localRef).first(where: { $0.name != current }) {
                model.checkout(local)
            } else if entry.labels.contains(where: { $0.localRef?.name == current && current != nil }) {
                model.toast(.info, String(localized: "Đang ở nhánh \(current ?? "")"))
            } else if let remote = entry.labels.flatMap(\.remoteRefs).first {
                model.checkout(remote)
            }
        }

        // MARK: Kéo-thả nhánh

        private var draggingRef: GitRef?

        /// Nhãn dưới điểm `point` (toạ độ bảng) ở dòng `row`, chỉ khi điểm nằm trong cột nhãn.
        private func label(at point: NSPoint, row: Int) -> RefLabel? {
            guard let table else { return nil }
            let column = table.column(at: point)
            guard column >= 0, table.tableColumns[column].identifier == Column.refs,
                  let cell = table.view(atColumn: column, row: row, makeIfNecessary: false) as? RefsCellView else { return nil }
            return cell.label(at: cell.convert(point, from: table))
        }

        func tableView(_ tableView: NSTableView, pasteboardWriterForRow row: Int) -> (any NSPasteboardWriting)? {
            guard let table = tableView as? CommitNSTableView, entries.indices.contains(row),
                  let point = table.lastMouseDownPoint, table.row(at: point) == row,
                  let label = label(at: point, row: row), !label.isDetachedHead else {
                draggingRef = nil
                return nil
            }
            guard let ref = label.localRef ?? label.remoteRefs.first ?? label.tagRef else { return nil }
            draggingRef = ref
            let item = NSPasteboardItem()
            item.setString(ref.fullName, forType: .string)
            return item
        }

        func tableView(_ tableView: NSTableView, draggingSession session: NSDraggingSession,
                       willBeginAt screenPoint: NSPoint, forRowIndexes rowIndexes: IndexSet) {
            guard let ref = draggingRef, let row = rowIndexes.first, entries.indices.contains(row) else { return }
            let symbol = ref.kind == .tag ? "tag.fill" : (ref.kind == .remoteBranch ? "cloud.fill" : "arrow.triangle.branch")
            let image = RefsCellView.dragImage(text: ref.name, symbol: symbol, color: GraphStyle.color(entries[row].row.color))
            let point = (tableView as? CommitNSTableView)?.lastMouseDownPoint ?? .zero
            session.enumerateDraggingItems(options: [], for: tableView, classes: [NSPasteboardItem.self], searchOptions: [:]) { item, _, _ in
                item.setDraggingFrame(NSRect(x: point.x - 12, y: point.y - image.size.height / 2,
                                             width: image.size.width, height: image.size.height), contents: image)
            }
        }

        func tableView(_ tableView: NSTableView, draggingSession session: NSDraggingSession,
                       endedAt screenPoint: NSPoint, operation: NSDragOperation) {
            draggingRef = nil
        }

        private func sourceRef(from info: any NSDraggingInfo) -> GitRef? {
            guard let name = info.draggingPasteboard.string(forType: .string) else { return nil }
            return model.refs.first { $0.fullName == name }
        }

        /// Nhánh đích: nhãn dưới con trỏ, hoặc nhánh đầu tiên trên dòng (ưu tiên nhánh local).
        private func targetRef(for info: any NSDraggingInfo, row: Int, source: GitRef) -> GitRef? {
            guard let table, entries.indices.contains(row) else { return nil }
            let point = table.convert(info.draggingLocation, from: nil)
            let candidates = label(at: point, row: row)?.refs ?? entries[row].labels.flatMap(\.refs)
            let usable = candidates.filter { $0.fullName != source.fullName && $0.kind != .tag }
            return usable.first { $0.kind == .localBranch } ?? usable.first
        }

        func tableView(_ tableView: NSTableView, validateDrop info: any NSDraggingInfo, proposedRow row: Int,
                       proposedDropOperation dropOperation: NSTableView.DropOperation) -> NSDragOperation {
            guard let source = sourceRef(from: info), entries.indices.contains(row),
                  targetRef(for: info, row: row, source: source) != nil else { return [] }
            if dropOperation != .on { tableView.setDropRow(row, dropOperation: .on) }
            return .generic
        }

        func tableView(_ tableView: NSTableView, acceptDrop info: any NSDraggingInfo, row: Int,
                       dropOperation: NSTableView.DropOperation) -> Bool {
            guard let source = sourceRef(from: info), let target = targetRef(for: info, row: row, source: source) else { return false }
            model.dragRequest = DragRequest(source: source, target: .ref(target))
            return true
        }

        // MARK: Context menu

        func menuNeedsUpdate(_ menu: NSMenu) {
            menu.removeAllItems()
            if menu === headerMenu {
                buildHeaderMenu(menu)
                return
            }
            guard let table, entries.indices.contains(table.clickedRow) else { return }
            let entry = entries[table.clickedRow]
            for item in Self.makeItems(model.menu(for: entry)) {
                menu.addItem(item)
            }
        }

        static func makeItems(_ specs: [MenuItemSpec]) -> [NSMenuItem] {
            specs.map { spec in
                switch spec {
                case .action(let title, let systemImage, let destructive, let enabled, let handler):
                    let item = MenuActionTarget.item(title: title, handler: handler)
                    item.isEnabled = enabled
                    if let systemImage { item.image = NSImage(systemSymbolName: systemImage, accessibilityDescription: nil) }
                    if destructive {
                        item.attributedTitle = NSAttributedString(string: title, attributes: [
                            .foregroundColor: NSColor.systemRed,
                            .font: NSFont.menuFont(ofSize: 0),
                        ])
                    }
                    return item
                case .submenu(let title, let systemImage, let children):
                    let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
                    if let systemImage { item.image = NSImage(systemSymbolName: systemImage, accessibilityDescription: nil) }
                    let submenu = NSMenu(title: title)
                    submenu.autoenablesItems = false
                    for child in makeItems(children) { submenu.addItem(child) }
                    item.submenu = submenu
                    return item
                case .separator:
                    return NSMenuItem.separator()
                }
            }
        }

        func scrollToCenter(row: Int) {
            guard let table, row >= 0, row < table.numberOfRows, let scrollView = table.enclosingScrollView else { return }
            let rowRect = table.rect(ofRow: row)
            let visible = scrollView.contentView.bounds
            if visible.contains(rowRect) { return }
            let headerHeight = table.headerView?.frame.height ?? 0
            let targetY = max(-headerHeight, rowRect.midY - visible.height / 2)
            scrollView.contentView.scroll(to: NSPoint(x: visible.origin.x, y: targetY))
            scrollView.reflectScrolledClipView(scrollView.contentView)
        }
    }
}

/// NSTableView chấp nhận phím Return để kích hoạt dòng đang chọn.
final class CommitNSTableView: NSTableView {
    var onReturn: (() -> Void)?
    /// Vị trí bấm chuột gần nhất (toạ độ bảng) — để biết người dùng bắt đầu kéo từ nhãn nào.
    private(set) var lastMouseDownPoint: NSPoint?

    override func mouseDown(with event: NSEvent) {
        lastMouseDownPoint = convert(event.locationInWindow, from: nil)
        super.mouseDown(with: event)
    }

    override func keyDown(with event: NSEvent) {
        if event.keyCode == 36 || event.keyCode == 76 {
            onReturn?()
        } else {
            super.keyDown(with: event)
        }
    }

    override func menu(for event: NSEvent) -> NSMenu? {
        // Chọn luôn dòng được bấm chuột phải cho rõ ràng.
        let point = convert(event.locationInWindow, from: nil)
        let row = self.row(at: point)
        if row >= 0, !selectedRowIndexes.contains(row) {
            selectRowIndexes(IndexSet(integer: row), byExtendingSelection: false)
        }
        return super.menu(for: event)
    }
}

final class CommitRowView: NSTableRowView {
    override func drawSelection(in dirtyRect: NSRect) {
        guard selectionHighlightStyle != .none else { return }
        let color: NSColor = isEmphasized ? .selectedContentBackgroundColor : .unemphasizedSelectedContentBackgroundColor
        color.withAlphaComponent(isEmphasized ? 0.85 : 1).setFill()
        bounds.fill()
    }
}

/// Đích nhận action của NSMenuItem để gọi closure (được giữ trong `representedObject`).
final class MenuActionTarget: NSObject {
    private let handler: () -> Void

    init(handler: @escaping () -> Void) {
        self.handler = handler
    }

    @objc func fire(_ sender: Any?) {
        handler()
    }

    static func item(title: String, handler: @escaping () -> Void) -> NSMenuItem {
        let target = MenuActionTarget(handler: handler)
        let item = NSMenuItem(title: title, action: #selector(fire(_:)), keyEquivalent: "")
        item.target = target
        item.representedObject = target
        return item
    }
}
