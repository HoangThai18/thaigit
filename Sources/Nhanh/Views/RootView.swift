import AppKit
import NhanhCore
import SwiftUI

/// A window's content, like GitKraken: a hand-drawn tab bar on the top row (next to the red/yellow/green buttons), and below it the
/// selected tab — the repository picker, a repository, or "What's New".
struct RootView: View {
    @Environment(AppState.self) private var appState
    @State private var tabs = TabsModel()
    @State private var windowActions = WindowActions()
    @State private var showClone = false
    @State private var showPalette = false

    var body: some View {
        GeometryReader { proxy in
            // A window with a hidden title bar (the content overflows upwards): the top safe-area inset is exactly the title bar's
            // height, where the red/yellow/green buttons sit — the tab row is made exactly that tall so the buttons end up centred in it.
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
            AutomationHarness.windowActions = windowActions
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
        .sheet(isPresented: $showPalette) {
            CommandPaletteSheet(tabs: tabs, windowActions: windowActions)
                .environment(appState)
        }
    }

    private func configureWindowActions() {
        windowActions.openPath = { [tabs] path in tabs.open(path: path) }
        windowActions.showClone = { showClone = true }
        windowActions.showInit = { initializeRepository() }
        windowActions.showPalette = { showPalette = true }
    }

    /// The first launch after an update: open the "What's New" tab by itself once (like GitKraken's Release Notes).
    private func showReleaseNotesIfJustUpdated() {
        guard AppUpdater.shared.justUpdated != nil, !Self.didAutoShowReleaseNotes else { return }
        Self.didAutoShowReleaseNotes = true
        tabs.openReleaseNotes()
    }

    private static var didAutoShowReleaseNotes = false

    /// A folder opened from Finder / Dock / the command line: one tab per folder, in the window in use.
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
        panel.prompt = String(localized: "Tạo repository")
        panel.message = String(localized: "Chọn hoặc tạo thư mục cho repository mới")
        guard panel.runModal() == .OK, let url = panel.url else { return }
        let environment = appState.environment
        Task {
            do {
                try await GitRepository.initialize(at: url, environment: environment)
                tabs.open(path: url.path)
            } catch {
                tabs.selected.loadError = FriendlyError.message(for: error)
            }
        }
    }
}

/// The content of the selected tab.
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

/// The NSWindow configuration underneath: macOS tabs are turned off (Thaigit draws its own tab bar) so opening a repo doesn't spawn another window.
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
