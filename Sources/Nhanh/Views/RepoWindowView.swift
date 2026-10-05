import AppKit
import NhanhCore
import SwiftUI

/// Bố cục chính giống GitKraken: hàng công cụ của repo ở trên (dưới thanh tab), sidebar nhánh bên trái, graph ở giữa,
/// panel chi tiết bên phải.
struct RepoWindowView: View {
    @Bindable var model: RepoModel
    @State private var columnVisibility = NavigationSplitViewVisibility.all

    var body: some View {
        VStack(spacing: 0) {
            RepoActionBar(model: model, columnVisibility: $columnVisibility)
            Divider()
            NavigationSplitView(columnVisibility: $columnVisibility) {
                SidebarView(model: model)
                    .navigationSplitViewColumnWidth(min: 240, ideal: 260, max: 440)
                    // Cửa sổ không có toolbar của macOS (thanh tab tự vẽ ở trên): nút ẩn/hiện sidebar nằm ở hàng công cụ.
                    .toolbar(removing: .sidebarToggle)
            } detail: {
                // Cột nào cũng co được về 0: nội dung cao hơn cửa sổ thì cắt bớt, không được đẩy cả cửa sổ
                // (NavigationSplitView cao hơn cửa sổ sẽ bị căn giữa → phần trên bị đẩy lên).
                CenterArea(model: model)
                    .frame(minHeight: 0, maxHeight: .infinity, alignment: .top)
                    .inspector(isPresented: $model.showInspector) {
                        InspectorPanel(model: model)
                            .frame(minHeight: 0, maxHeight: .infinity, alignment: .top)
                            .clipped()
                            .inspectorColumnWidth(min: 300, ideal: 380, max: 640)
                    }
            }
        }
        // Tiêu đề cửa sổ (menu Cửa sổ, Mission Control) — thanh tiêu đề đã ẩn.
        .navigationTitle(model.name)
        .sheet(item: $model.sheet) { sheet in
            SheetContent(model: model, sheet: sheet)
        }
        .alert(
            model.confirmation?.title ?? "",
            isPresented: Binding(get: { model.confirmation != nil }, set: { if !$0 { model.confirmation = nil } }),
            presenting: model.confirmation
        ) { confirmation in
            // Nút đầu tiên là nút mặc định (↩).
            Button(confirmation.confirmTitle, role: confirmation.isDestructive ? .destructive : nil) {
                confirmation.action()
            }
            if let secondaryTitle = confirmation.secondaryTitle, let secondaryAction = confirmation.secondaryAction {
                Button(secondaryTitle, action: secondaryAction)
            }
            Button("Huỷ", role: .cancel) {}
        } message: { confirmation in
            Text(confirmation.message)
        }
        .confirmationDialog(
            "Thả \(model.dragRequest?.source.name ?? "") lên \(model.dragRequest?.targetName ?? "")",
            isPresented: Binding(get: { model.dragRequest != nil }, set: { if !$0 { model.dragRequest = nil } }),
            presenting: model.dragRequest
        ) { request in
            MenuSpecContent(items: model.dropOptions(request))
            Button("Huỷ", role: .cancel) {}
        }
        .focusedSceneValue(model)
        .onAppear {
            model.start()
            AutomationHarness.attach(model)
        }
        .onDisappear { model.stop() }
        .onReceive(NotificationCenter.default.publisher(for: .nhanhSettingsChanged)) { _ in
            model.refreshEverything()
        }
    }
}

extension Notification.Name {
    static let nhanhSettingsChanged = Notification.Name("nhanh.settingsChanged")
}

/// Vùng giữa: graph commit, hoặc diff của file đang mở (thay chỗ graph, như GitKraken).
struct CenterArea: View {
    @Bindable var model: RepoModel

    var body: some View {
        VStack(spacing: 0) {
            if !model.historyGapsDismissed, !model.remotes.isEmpty, !model.extras.historyGaps.isEmpty {
                HistoryGapsBanner(model: model, gaps: model.extras.historyGaps)
            }
            if let operation = model.operation {
                OperationBanner(model: model, operation: operation)
            }
            ZStack {
                BrandBackground()
                CommitGraphView(model: model)
                    .opacity(model.openFile == nil ? 1 : 0)
                    .allowsHitTesting(model.openFile == nil)
                    .overlay(alignment: .bottom) {
                        if model.openFile == nil, let summary = model.graphFilterSummary {
                            GraphFilterBar(summary: summary) { model.showAllBranchesOnGraph() }
                                .padding(.bottom, 14)
                        }
                    }
                if model.openFile != nil {
                    DiffPane(model: model)
                        .transition(.opacity)
                }
            }
            if let terminal = model.terminal, terminal.isVisible {
                TerminalPanel(model: model, session: terminal)
                    .transition(.move(edge: .bottom))
            }
        }
        .overlay(alignment: .top) {
            if let busy = model.busy {
                BusyBar(busy: busy) { model.cancelCurrentOperation() }
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .overlay(alignment: .bottomTrailing) {
            // Khi đang mở diff/xung đột thì đẩy thông báo lên trên thanh thao tác ở đáy.
            ToastStack(model: model)
                .padding(.horizontal, 16)
                .padding(.bottom, model.openFile == nil ? 16 : 70)
        }
        .animation(.snappy(duration: 0.2), value: model.busy)
        .animation(.easeInOut(duration: 0.15), value: model.openFile)
    }
}

struct InspectorPanel: View {
    @Bindable var model: RepoModel

    var body: some View {
        if model.timeline.isOpen {
            TimelineView(model: model)
        } else {
            selectionPanel
        }
    }

    @ViewBuilder private var selectionPanel: some View {
        switch model.selection {
        case .workingTree:
            StagingView(model: model)
        case .commit:
            CommitDetailView(model: model)
        case .stash(let sha):
            StashDetailView(model: model, sha: sha)
        case .compare(let from, let to):
            ComparisonView(model: model, from: from, to: to)
        case .none:
            ContentUnavailableView("Chọn một commit", systemImage: "point.3.connected.trianglepath.dotted",
                                   description: Text("Bấm vào một commit trên graph để xem chi tiết, hoặc chọn dòng “WIP” để stage và commit."))
        }
    }
}

/// Hàng công cụ của repo (dưới thanh tab, như GitKraken): sidebar, nhánh, Fetch / Pull / Push / Branch / Stash / Pop,
/// ô tìm commit (⌘F) và nút panel chi tiết.
struct RepoActionBar: View {
    @Bindable var model: RepoModel
    @Binding var columnVisibility: NavigationSplitViewVisibility
    @FocusState private var searchFocused: Bool

    var body: some View {
        // Cửa sổ hẹp: các nút chỉ còn biểu tượng (chú thích vẫn hiện khi rê chuột) thay vì tràn ra ngoài.
        ViewThatFits(in: .horizontal) {
            bar(titles: true)
            bar(titles: false)
        }
        .buttonStyle(ToolbarButtonStyle())
        .menuStyle(.borderlessButton)
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .frame(maxWidth: .infinity)
        .background(Color(nsColor: .windowBackgroundColor))
    }

    private func bar(titles: Bool) -> some View {
        HStack(spacing: 8) {
            Button {
                withAnimation { columnVisibility = columnVisibility == .detailOnly ? .all : .detailOnly }
            } label: {
                ToolLabel("Sidebar", systemImage: "sidebar.left", color: ToolColor.neutral).labelStyle(.iconOnly)
            }
            .help("Ẩn/hiện danh sách nhánh")

            BranchSwitcher(model: model)
                .fixedSize()
            if !model.status.isClean {
                WorkingTreeChip(model: model)
                    .fixedSize()
            }

            Spacer(minLength: 8)

            Button { model.undoLast() } label: {
                ToolLabel("Undo", systemImage: "arrow.uturn.backward", color: ToolColor.undo)
            }
            .disabled(!model.canUndoLast)
            .help(model.canUndoLast
                ? String(localized: "Hoàn tác: \(model.lastUndo?.title ?? "")")
                : String(localized: "Hoàn tác thao tác git gần nhất (commit, checkout, pull, huỷ thay đổi…)"))

            Button { model.fetch() } label: {
                ToolLabel("Fetch", systemImage: "arrow.triangle.2.circlepath", color: ToolColor.fetch)
            }
            .help("Lấy thông tin mới từ mọi remote (⌥⌘F)")

            Menu {
                Button("Pull (merge nếu cần)") { model.pull(mode: .merge) }
                Button("Pull (rebase)") { model.pull(mode: .rebase) }
                Button("Pull (chỉ fast-forward)") { model.pull(mode: .fastForwardOnly) }
                Divider()
                Button("Đồng bộ (pull rồi push)") { model.sync() }
                Button("Chỉ fetch") { model.fetch() }
                Divider()
                ForEach(model.savedForeignMergeSources.prefix(3)) { item in
                    Button("Merge lại \(item.label) → \(item.target)") { model.mergeFromRepository(item) }
                }
                Button("Merge từ repository khác…") { model.beginMergeFromRepository() }
            } label: {
                ToolLabel(verbatim: model.status.behind > 0 ? "Pull ↓\(model.status.behind)" : "Pull", systemImage: "arrow.down.circle",
                          color: ToolColor.pull)
                    .foregroundStyle(.primary)
            } primaryAction: {
                model.pull()
            }
            .fixedSize()
            .padding(.horizontal, 8)
            .frame(minHeight: 28)
            .background(ToolbarChrome())
            .help("Lấy commit mới từ remote về nhánh hiện tại (⇧⌘L)")

            Button { model.push() } label: {
                ToolLabel(verbatim: model.status.ahead > 0 ? "Push ↑\(model.status.ahead)" : "Push", systemImage: "arrow.up.circle",
                          color: ToolColor.push)
            }
            .help("Đẩy commit của nhánh hiện tại lên remote (⇧⌘P)")

            Button { model.beginCreateBranchAtHead() } label: {
                ToolLabel("Branch", systemImage: "arrow.triangle.branch", color: ToolColor.branch)
            }
            .help("Tạo nhánh mới từ commit hiện tại (⇧⌘B)")

            Button { model.quickStash() } label: {
                ToolLabel("Stash", systemImage: "archivebox.fill", color: ToolColor.stash)
            }
            .disabled(model.status.isClean)
            .help("Cất tạm mọi thay đổi chưa commit")

            Button { model.popLatestStash() } label: {
                ToolLabel("Pop", systemImage: "tray.and.arrow.up.fill", color: ToolColor.pop)
            }
            .disabled(model.stashes.isEmpty)
            .help("Lấy lại stash mới nhất")

            Menu {
                Button(model.terminal?.isVisible == true ? "Ẩn terminal trong app" : "Terminal trong app") { model.toggleTerminal() }
                Button("Mở trong Terminal") { model.openInTerminal() }
                Button("Mở trong Finder") { model.revealInFinder() }
                Button("Mở bằng trình soạn thảo") { model.openInEditor() }
                Divider()
                Button("Nhật ký lệnh git…") { model.sheet = .commandLog }
                Button("Làm mới") { model.refreshEverything() }
            } label: {
                ToolLabel("Mở", systemImage: "terminal", color: ToolColor.neutral).labelStyle(.iconOnly)
            }
            .fixedSize()
            .padding(.horizontal, 8)
            .frame(minHeight: 28)
            .background(ToolbarChrome())
            .help("Mở repository bằng ứng dụng khác")

            Spacer(minLength: 8)

            searchField

            Button { model.toggleInspector() } label: {
                ToolLabel("Chi tiết", systemImage: "sidebar.trailing", color: ToolColor.neutral).labelStyle(.iconOnly)
            }
            .help("Ẩn/hiện panel chi tiết (⌥⌘I)")

            SettingsToolButton()

            ProfileButton(model: model)
        }
        .labelStyle(titles ? AnyLabelStyle(.titleAndIcon) : AnyLabelStyle(.iconOnly))
    }

    private var searchField: some View {
        HStack(spacing: 5) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(.secondary)
            TextField("Tìm commit, tác giả, SHA…", text: $model.searchText)
                .textFieldStyle(.plain)
                .focused($searchFocused)
                .onSubmit { model.selectNextSearchMatch() }
                .onExitCommand {
                    model.searchText = ""
                    searchFocused = false
                }
            if !model.searchText.isEmpty {
                Button { model.searchText = "" } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 6)
        .frame(minWidth: 110, idealWidth: 170, maxWidth: 200)
        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.primary.opacity(0.06)))
        // ⌘F: tới ô tìm commit (nút ẩn chỉ để nhận phím tắt).
        .background {
            Button("Tìm commit") { searchFocused = true }
                .keyboardShortcut("f")
                .opacity(0)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
    }
}

/// Menu đổi nhánh nhanh trên thanh công cụ.
struct BranchSwitcher: View {
    @Bindable var model: RepoModel

    var body: some View {
        Menu {
            // Repo có hàng trăm nhánh: menu chỉ liệt kê nhánh gần đây, còn lại tìm trong "Chuyển nhánh…".
            let branches = model.recentLocalBranches(limit: 15)
            Section(branches.count < model.localBranches.count ? String(localized: "Nhánh gần đây") : String(localized: "Nhánh local")) {
                ForEach(branches) { ref in
                    Button {
                        model.checkout(ref)
                    } label: {
                        if ref.isHead {
                            Label(ref.name, systemImage: "checkmark")
                        } else {
                            Text(ref.name)
                        }
                    }
                }
            }
            Divider()
            Button("Tìm & chuyển nhánh…") { model.sheet = .switchBranch }
            Button("Tạo nhánh mới…") { model.beginCreateBranchAtHead() }
        } label: {
            ToolLabel(verbatim: model.headDescription.isEmpty ? "—" : model.headDescription, systemImage: "arrow.triangle.branch",
                      color: ToolColor.branch)
                .labelStyle(.titleAndIcon)
                .fontWeight(.semibold)
        }
        .padding(.horizontal, 8)
        .frame(minHeight: 28)
        .background(ToolbarChrome())
        .help(branchHelp)
    }

    private var branchHelp: String {
        guard let branch = model.currentBranch else { return String(localized: "Chuyển nhánh") }
        if let upstream = model.currentBranchRef?.upstream {
            return String(localized: "Đang ở nhánh \(branch), theo dõi \(upstream) — bấm để chuyển nhánh")
        }
        return String(localized: "Đang ở nhánh \(branch) (chưa có trên remote) — bấm để chuyển nhánh")
    }
}

/// Số file chưa commit cạnh tên nhánh: luôn thấy còn gì chưa commit dù đang xem commit khác; bấm để về WIP (⌘0).
struct WorkingTreeChip: View {
    @Bindable var model: RepoModel

    private var count: Int {
        Set(model.status.staged.map(\.path) + model.status.unstaged.map(\.path) + model.status.conflicts.map(\.path)).count
    }

    var body: some View {
        Button { model.selectWorkingTree() } label: {
            ToolLabel(verbatim: String(localized: "\(count) file chưa commit"),
                      systemImage: model.status.conflicts.isEmpty ? "pencil.circle" : "exclamationmark.triangle",
                      color: model.status.conflicts.isEmpty ? ToolColor.stash : Color(nsColor: .systemRed))
                .labelStyle(.titleAndIcon)
        }
        .buttonStyle(ToolbarButtonStyle())
        .help("Xem thay đổi chưa commit (⌘0)")
    }
}

/// Repo clone chỉ một nhánh (`--single-branch`) hoặc clone nông (`--depth`): nhánh khác / commit cũ trên remote không bao giờ
/// về máy, kể cả khi Fetch — mời người dùng lấy đủ.
struct HistoryGapsBanner: View {
    @Bindable var model: RepoModel
    let gaps: HistoryGaps

    private var detail: String {
        var parts: [String] = []
        if !gaps.narrowRemotes.isEmpty {
            parts.append(String(localized: "Repo chỉ đang lấy một vài nhánh của \(gaps.narrowRemotes.joined(separator: ", ")) nên các nhánh khác trên remote không hiện, kể cả khi Fetch."))
        }
        if gaps.shallow { parts.append(String(localized: "Đây là shallow clone nên còn thiếu các commit cũ.")) }
        return parts.joined(separator: " ")
    }

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "info.circle.fill")
                .font(.title2)
                .foregroundStyle(Brand.blue)
            VStack(alignment: .leading, spacing: 2) {
                Text(gaps.narrowRemotes.isEmpty ? String(localized: "Repo chưa có đủ lịch sử từ remote") : String(localized: "Repo chưa có đủ nhánh từ remote"))
                    .font(.headline)
                Text(detail)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
            Button("Để sau") { model.historyGapsDismissed = true }
                .glassButtonStyle()
            Button("Lấy đầy đủ từ remote") { model.completeHistory() }
                .glassButtonStyle(prominent: true)
                .help("Theo dõi mọi nhánh của remote, tải các commit còn thiếu rồi fetch")
                .disabled(model.busy != nil)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .glassSurface(in: RoundedRectangle(cornerRadius: 16), tint: Brand.blue.opacity(0.18))
        .padding(.horizontal, 10)
        .padding(.top, 8)
    }
}

struct OperationBanner: View {
    @Bindable var model: RepoModel
    let operation: RepoOperation

    var body: some View {
        let conflicts = model.status.conflicts.count
        HStack(spacing: 12) {
            Image(systemName: conflicts > 0 ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                .font(.title2)
                .foregroundStyle(conflicts > 0 ? .orange : .green)
            VStack(alignment: .leading, spacing: 2) {
                Text(operation.title).font(.headline)
                Text(conflicts > 0
                     ? "Còn \(conflicts) file xung đột — bấm vào từng file ở panel bên phải để chọn bản giữ lại."
                     : operation == .reverting
                     // Revert chưa commit: thay đổi đảo ngược đã stage, message gợi ý đã điền sẵn trong ô commit.
                     ? "Thay đổi đảo ngược đã được stage — xem lại, rồi commit ở panel bên phải hoặc bấm “Tiếp tục”."
                     : "Đã giải quyết hết xung đột. Bấm “Tiếp tục” để hoàn tất.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if operation.canSkip {
                Button("Bỏ qua commit này") { model.skipOperation() }
                    .glassButtonStyle()
            }
            Button("Huỷ \(operation.shortName)", role: .destructive) { model.abortOperation() }
                .glassButtonStyle()
            if operation.canContinue {
                Button("Tiếp tục") { model.continueOperation() }
                    .glassButtonStyle(prominent: true)
                    .disabled(conflicts > 0)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .glassSurface(in: RoundedRectangle(cornerRadius: 16), tint: Brand.orange.opacity(0.22))
        .padding(.horizontal, 10)
        .padding(.top, 8)
    }
}

struct BusyBar: View {
    let busy: BusyState
    let cancel: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            if let fraction = busy.fraction {
                ProgressView(value: fraction)
                    .frame(width: 110)
            } else {
                ProgressView().controlSize(.small)
            }
            Text(busy.title).font(.callout.weight(.semibold))
            if !busy.detail.isEmpty {
                Text(busy.detail)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            if busy.canCancel {
                Button("Huỷ", action: cancel).controlSize(.small)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .frame(maxWidth: 620)
        .glassSurface(in: Capsule())
        .padding(.top, 10)
    }
}

struct ToastStack: View {
    @Bindable var model: RepoModel

    var body: some View {
        VStack(alignment: .trailing, spacing: 8) {
            ForEach(model.toasts) { toast in
                ToastView(toast: toast) { model.dismissToast(toast.id) }
                    .transition(.move(edge: .trailing).combined(with: .opacity))
            }
        }
        .frame(maxWidth: 440, alignment: .trailing)
    }
}

struct ToastView: View {
    let toast: Toast
    let dismiss: () -> Void
    @State private var expanded = false

    private var tint: Color {
        switch toast.style {
        case .info: return .blue
        case .success: return .green
        case .warning: return .orange
        case .error: return .red
        }
    }

    private var icon: String {
        switch toast.style {
        case .info: return "info.circle.fill"
        case .success: return "checkmark.circle.fill"
        case .warning: return "exclamationmark.triangle.fill"
        case .error: return "xmark.octagon.fill"
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(tint)
            VStack(alignment: .leading, spacing: 6) {
                Text(toast.title)
                    .font(.callout.weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)
                if let message = toast.message, !message.isEmpty {
                    Text(message)
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                        .lineLimit(expanded ? 40 : 4)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                    if message.count > 220 || message.filter({ $0 == "\n" }).count > 3 {
                        Button(expanded ? String(localized: "Thu gọn") : String(localized: "Xem đầy đủ")) { expanded.toggle() }
                            .buttonStyle(.link)
                            .font(.caption)
                    }
                }
                if !toast.actions.isEmpty {
                    HStack(spacing: 8) {
                        ForEach(toast.actions) { action in
                            Button(action.title) {
                                dismiss()
                                action.handler()
                            }
                            .controlSize(.small)
                            .glassButtonStyle()
                        }
                    }
                }
            }
            Spacer(minLength: 0)
            Button(action: dismiss) {
                Image(systemName: "xmark")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
        }
        .padding(12)
        .frame(width: 400, alignment: .leading)
        .glassSurface(in: RoundedRectangle(cornerRadius: 18), tint: tint.opacity(0.14))
    }
}

/// Hiển thị danh sách MenuItemSpec thành các nút/menu SwiftUI.
struct MenuSpecContent: View {
    let items: [MenuItemSpec]

    var body: some View {
        ForEach(Array(items.enumerated()), id: \.offset) { _, item in
            switch item {
            case .action(let title, let systemImage, let destructive, let enabled, let handler):
                Button(role: destructive ? .destructive : nil, action: handler) {
                    if let systemImage {
                        Label(title, systemImage: systemImage)
                    } else {
                        Text(title)
                    }
                }
                .disabled(!enabled)
            case .submenu(let title, let systemImage, let children):
                Menu {
                    MenuSpecContent(items: children)
                } label: {
                    if let systemImage {
                        Label(title, systemImage: systemImage)
                    } else {
                        Text(title)
                    }
                }
            case .separator:
                Divider()
            }
        }
    }
}

/// Đổi kiểu nhãn theo điều kiện (nhãn đầy đủ hay chỉ biểu tượng).
struct AnyLabelStyle: LabelStyle {
    private let make: (Configuration) -> AnyView

    init<S: LabelStyle>(_ style: S) {
        make = { AnyView(style.makeBody(configuration: $0)) }
    }

    func makeBody(configuration: Configuration) -> some View {
        make(configuration)
    }
}

/// Dải báo đang ẩn / solo nhánh trên graph, kèm nút hiện lại tất cả.
private struct GraphFilterBar: View {
    let summary: String
    let showAll: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "eye.slash")
                .foregroundStyle(.secondary)
            Text(summary)
                .font(.callout)
            Button("Hiện tất cả", action: showAll)
                .buttonStyle(.borderless)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 7)
        .glassSurface(in: Capsule())
    }
}

/// Nút Cài đặt trên hàng công cụ (⌘,).
private struct SettingsToolButton: View {
    @Environment(\.openSettings) private var openSettings

    var body: some View {
        Button { openSettings() } label: {
            ToolLabel("Cài đặt", systemImage: "gearshape", color: ToolColor.neutral).labelStyle(.iconOnly)
        }
        .help("Cài đặt (⌘,)")
    }
}

/// Profile (như GitKraken): ảnh đại diện của tên / email đang dùng để commit; bấm để xem, đổi danh tính Git, tài khoản
/// GitHub / GitLab của repo và mở Cài đặt.
private struct ProfileButton: View {
    @Bindable var model: RepoModel
    @Environment(\.openSettings) private var openSettings
    @State private var showing = false

    private var name: String { model.committerIdentity?.name ?? "" }
    private var email: String? { model.committerIdentity?.email }

    var body: some View {
        Button { showing.toggle() } label: {
            AvatarView(name: name.isEmpty ? "?" : name, email: email, size: 24)
        }
        .buttonStyle(.plain)
        .help(name.isEmpty ? String(localized: "Chưa đặt tên & email Git") : "\(name) <\(email ?? "")>")
        .popover(isPresented: $showing, arrowEdge: .bottom) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 10) {
                    AvatarView(name: name.isEmpty ? "?" : name, email: email, size: 40)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(name.isEmpty ? String(localized: "Chưa đặt tên Git") : name)
                            .font(.headline)
                        Text(email ?? String(localized: "Chưa đặt email Git"))
                            .font(.callout)
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                    }
                }
                Text("Tên & email này được ghi vào mọi commit bạn tạo trong repo này.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                Divider()
                VStack(alignment: .leading, spacing: 4) {
                    profileRow("Đổi tên & email Git…", systemImage: "person.text.rectangle") { model.sheet = .identity }
                    profileRow("Tài khoản GitHub / GitLab cho repo này…", systemImage: "person.crop.circle.badge.checkmark") {
                        model.sheet = .githubAccount(owner: nil)
                    }
                    profileRow("Cài đặt…", systemImage: "gearshape") { openSettings() }
                }
            }
            .padding(14)
            .frame(width: 300)
        }
        .onAppear { if model.committerIdentity == nil { model.loadCommitterIdentity() } }
    }

    private func profileRow(_ title: LocalizedStringKey, systemImage: String, action: @escaping () -> Void) -> some View {
        Button {
            showing = false
            action()
        } label: {
            Label(title, systemImage: systemImage)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 4)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
