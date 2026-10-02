import AppKit
import NhanhCore
import SwiftUI

/// Bố cục chính giống GitKraken: sidebar nhánh bên trái, graph ở giữa, panel chi tiết bên phải.
struct RepoWindowView: View {
    @Bindable var model: RepoModel
    @State private var columnVisibility = NavigationSplitViewVisibility.all

    var body: some View {
        NavigationSplitView(columnVisibility: $columnVisibility) {
            SidebarView(model: model)
                .navigationSplitViewColumnWidth(min: 210, ideal: 260, max: 440)
        } detail: {
            CenterArea(model: model)
                .inspector(isPresented: $model.showInspector) {
                    InspectorPanel(model: model)
                        .inspectorColumnWidth(min: 300, ideal: 380, max: 640)
                }
        }
        .navigationTitle(model.name)
        .navigationSubtitle(model.branchSubtitle)
        .toolbar { RepoToolbar(model: model) }
        .searchable(text: $model.searchText, placement: .toolbar, prompt: "Tìm commit, tác giả, SHA…")
        .onSubmit(of: .search) { model.selectNextSearchMatch() }
        .sheet(item: $model.sheet) { sheet in
            SheetContent(model: model, sheet: sheet)
        }
        .alert(
            model.confirmation?.title ?? "",
            isPresented: Binding(get: { model.confirmation != nil }, set: { if !$0 { model.confirmation = nil } }),
            presenting: model.confirmation
        ) { confirmation in
            Button(confirmation.confirmTitle, role: confirmation.isDestructive ? .destructive : nil) {
                confirmation.action()
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
            if let operation = model.operation {
                OperationBanner(model: model, operation: operation)
            }
            ZStack {
                BrandBackground()
                CommitGraphView(model: model)
                    .opacity(model.openFile == nil ? 1 : 0)
                    .allowsHitTesting(model.openFile == nil)
                if model.openFile != nil {
                    DiffPane(model: model)
                        .transition(.opacity)
                }
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
        switch model.selection {
        case .workingTree:
            StagingView(model: model)
        case .commit:
            CommitDetailView(model: model)
        case .stash(let sha):
            StashDetailView(model: model, sha: sha)
        case .none:
            ContentUnavailableView("Chọn một commit", systemImage: "point.3.connected.trianglepath.dotted",
                                   description: Text("Bấm vào một commit trên graph để xem chi tiết, hoặc chọn dòng “WIP” để stage và commit."))
        }
    }
}

struct RepoToolbar: ToolbarContent {
    @Bindable var model: RepoModel

    var body: some ToolbarContent {
        ToolbarItem(placement: .navigation) {
            BranchSwitcher(model: model)
        }
        ToolbarItemGroup(placement: .primaryAction) {
            Button { model.fetch() } label: {
                Label("Fetch", systemImage: "arrow.triangle.2.circlepath")
                    .labelStyle(.titleAndIcon)
            }
            .help("Lấy thông tin mới từ mọi remote (⌥⌘F)")

            Menu {
                Button("Pull (merge nếu cần)") { model.pull(mode: .merge) }
                Button("Pull (rebase)") { model.pull(mode: .rebase) }
                Button("Pull (chỉ fast-forward)") { model.pull(mode: .fastForwardOnly) }
                Divider()
                Button("Chỉ fetch") { model.fetch() }
            } label: {
                Label(model.status.behind > 0 ? "Pull ↓\(model.status.behind)" : "Pull", systemImage: "arrow.down.circle")
                    .labelStyle(.titleAndIcon)
            } primaryAction: {
                model.pull()
            }
            .help("Kéo commit mới từ remote về nhánh hiện tại (⇧⌘L)")

            Button { model.push() } label: {
                Label(model.status.ahead > 0 ? "Push ↑\(model.status.ahead)" : "Push", systemImage: "arrow.up.circle")
                    .labelStyle(.titleAndIcon)
            }
            .help("Đẩy commit của nhánh hiện tại lên remote (⇧⌘P)")

            Button { model.beginCreateBranchAtHead() } label: {
                Label("Branch", systemImage: "arrow.triangle.branch")
                    .labelStyle(.titleAndIcon)
            }
            .help("Tạo nhánh mới từ commit hiện tại (⇧⌘B)")

            Button { model.quickStash() } label: {
                Label("Stash", systemImage: "archivebox")
                    .labelStyle(.titleAndIcon)
            }
            .disabled(model.status.isClean)
            .help("Cất tạm mọi thay đổi chưa commit")

            Button { model.popLatestStash() } label: {
                Label("Pop", systemImage: "archivebox.circle")
                    .labelStyle(.titleAndIcon)
            }
            .disabled(model.stashes.isEmpty)
            .help("Lấy lại stash mới nhất")

            Menu {
                Button("Mở trong Terminal") { model.openInTerminal() }
                Button("Mở trong Finder") { model.revealInFinder() }
                Button("Mở bằng trình soạn thảo") { model.openInEditor() }
                Divider()
                Button("Nhật ký lệnh git…") { model.sheet = .commandLog }
                Button("Làm mới") { model.refreshEverything() }
            } label: {
                Label("Mở", systemImage: "terminal")
            }
            .help("Mở repository bằng ứng dụng khác")

            Button { model.toggleInspector() } label: {
                Label("Chi tiết", systemImage: "sidebar.trailing")
            }
            .help("Ẩn/hiện panel chi tiết (⌥⌘I)")
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
            Section(branches.count < model.localBranches.count ? "Nhánh gần đây" : "Nhánh local") {
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
            Label(model.headDescription.isEmpty ? "—" : model.headDescription, systemImage: "arrow.triangle.branch")
                .labelStyle(.titleAndIcon)
        }
        .help("Chuyển nhánh")
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
                        Button(expanded ? "Thu gọn" : "Xem đầy đủ") { expanded.toggle() }
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
