import AppKit
import NhanhCore
import SwiftUI

/// Nội dung một cửa sổ, như GitKraken: thanh tab tự vẽ ở hàng trên cùng (cạnh 3 nút đỏ/vàng/xanh), bên dưới là tab
/// đang chọn — màn hình chọn repository, một repository, hoặc "Có gì mới".
struct RootView: View {
    @Environment(AppState.self) private var appState
    @State private var tabs = TabsModel()
    @State private var windowActions = WindowActions()
    @State private var showClone = false

    var body: some View {
        GeometryReader { proxy in
            // Cửa sổ ẩn thanh tiêu đề (nội dung tràn lên trên): khoảng an toàn phía trên chính là chiều cao thanh tiêu đề,
            // nơi đặt 3 nút đỏ/vàng/xanh — hàng tab cao đúng bằng nó để các nút nằm giữa hàng.
            let stripHeight = max(proxy.safeAreaInsets.top, 30)
            VStack(spacing: 0) {
                TabStrip(tabs: tabs, height: stripHeight)
                TabContentView(tab: tabs.selected, tabs: tabs, onClone: { showClone = true }, onInit: initializeRepository)
                    .id(tabs.selectedID)
            }
            .ignoresSafeArea(.container, edges: .top)
        }
        .frame(minWidth: 980, minHeight: 620)
        .overlay(alignment: .bottomLeading) {
            UpdateBanner()
                .padding(14)
        }
        .animation(.snappy(duration: 0.25), value: AppUpdater.shared.phase)
        .animation(.snappy(duration: 0.25), value: AppUpdater.shared.bannerHidden)
        .background(WindowConfigurator())
        .environment(tabs)
        .focusedSceneValue(tabs)
        .focusedSceneValue(windowActions)
        .onAppear {
            TabsModel.liveWindows += 1
            configureWindowActions()
            tabs.restoreIfFirstWindow()
            consumePendingOpens()
            showReleaseNotesIfJustUpdated()
            AutomationHarness.tabs = tabs
            if tabs.selected.kind == .home || tabs.selected.kind == .welcome {
                AutomationHarness.welcomeActions = windowActions
                AutomationHarness.attachWelcome()
            }
        }
        .onDisappear { TabsModel.liveWindows -= 1 }
        .onChange(of: appState.pendingOpenPaths) { consumePendingOpens() }
        .onChange(of: AppUpdater.shared.justUpdated) { showReleaseNotesIfJustUpdated() }
        .sheet(isPresented: $showClone) {
            CloneSheet { path in tabs.open(path: path) }
                .environment(appState)
        }
    }

    private func configureWindowActions() {
        windowActions.openPath = { [tabs] path in tabs.open(path: path) }
        windowActions.showClone = { showClone = true }
        windowActions.showInit = { initializeRepository() }
    }

    /// Lần mở đầu tiên sau khi cập nhật: tự mở tab "Có gì mới" (như Release Notes của GitKraken), một lần.
    private func showReleaseNotesIfJustUpdated() {
        guard AppUpdater.shared.justUpdated != nil, !Self.didAutoShowReleaseNotes else { return }
        Self.didAutoShowReleaseNotes = true
        tabs.openReleaseNotes()
    }

    private static var didAutoShowReleaseNotes = false

    /// Thư mục mở từ Finder / Dock / dòng lệnh: mỗi thư mục một tab trong cửa sổ đang dùng.
    private func consumePendingOpens() {
        let paths = appState.pendingOpenPaths
        guard !paths.isEmpty else { return }
        appState.pendingOpenPaths = []
        for path in paths { tabs.open(path: path) }
    }

    private func initializeRepository() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.prompt = "Tạo repository"
        panel.message = "Chọn hoặc tạo thư mục cho repository mới"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        let environment = appState.environment
        Task {
            do {
                try await GitRepository.initialize(at: url, environment: environment)
                tabs.open(path: url.path)
            } catch {
                tabs.selected.loadError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            }
        }
    }
}

/// Nội dung của tab đang chọn.
private struct TabContentView: View {
    let tab: AppTab
    let tabs: TabsModel
    let onClone: () -> Void
    let onInit: () -> Void

    var body: some View {
        switch tab.kind {
        case .releaseNotes:
            ReleaseNotesView()
        case .repository:
            if let model = tab.model {
                RepoWindowView(model: model)
            } else {
                ProgressView("Đang mở repository…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        case .home, .welcome:
            WelcomeView(error: tab.loadError, onOpen: { tabs.open(path: $0) }, onClone: onClone, onInit: onInit)
        }
    }
}

/// Cấu hình NSWindow bên dưới: tắt tab của macOS (Thaigit tự vẽ thanh tab) để mở repo không sinh thêm cửa sổ.
struct WindowConfigurator: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView {
        ConfiguratorView()
    }

    func updateNSView(_ nsView: NSView, context: Context) {}

    final class ConfiguratorView: NSView {
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            guard let window else { return }
            window.tabbingMode = .disallowed
        }
    }
}
