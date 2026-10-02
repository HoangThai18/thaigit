import AppKit
import NhanhCore
import SwiftUI

/// Nội dung một cửa sổ/tab: màn hình chào khi chưa mở repo, hoặc giao diện repo.
struct RootView: View {
    @Binding var repoPath: String?
    @Environment(AppState.self) private var appState
    @Environment(\.openWindow) private var openWindow
    @State private var model: RepoModel?
    @State private var loadError: String?
    @State private var isLoading = false
    @State private var windowActions = WindowActions()
    @State private var showClone = false

    var body: some View {
        // ZStack (không dùng Group): modifier .task/.onAppear phải gắn vào một view cố định,
        // nếu không SwiftUI chạy lại chúng mỗi khi nội dung đổi (chào → đang tải → repo).
        ZStack {
            if let model {
                RepoWindowView(model: model)
            } else if isLoading || repoPath != nil {
                ProgressView("Đang mở repository…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                WelcomeView(
                    error: loadError,
                    onOpen: { open($0) },
                    onClone: { showClone = true },
                    onInit: initializeRepository
                )
            }
        }
        .frame(minWidth: 980, minHeight: 620)
        .overlay(alignment: .bottomLeading) {
            UpdateBanner()
                .padding(14)
        }
        .animation(.snappy(duration: 0.25), value: AppUpdater.shared.phase)
        .animation(.snappy(duration: 0.25), value: AppUpdater.shared.bannerHidden)
        .background(WindowConfigurator())
        .focusedSceneValue(windowActions)
        .task(id: repoPath) { await load() }
        .onAppear {
            configureWindowActions()
            consumePendingOpens()
            if model == nil && repoPath == nil {
                AutomationHarness.welcomeActions = windowActions
                AutomationHarness.attachWelcome()
            }
        }
        .onChange(of: appState.pendingOpenPaths) { consumePendingOpens() }
        .sheet(isPresented: $showClone) {
            CloneSheet { path in open(path) }
                .environment(appState)
        }
    }

    private func configureWindowActions() {
        windowActions.openPath = { path in open(path) }
        windowActions.showClone = { showClone = true }
        windowActions.showInit = { initializeRepository() }
    }

    /// Mở repo ngay trong tab này nếu đang ở màn hình chào, ngược lại mở tab mới.
    private func open(_ path: String) {
        if model == nil && !isLoading && repoPath == nil {
            repoPath = path
        } else if path != model?.rootPath {
            openWindow(id: "repo", value: path)
        }
    }

    private func consumePendingOpens() {
        let paths = appState.pendingOpenPaths
        guard !paths.isEmpty else { return }
        appState.pendingOpenPaths = []
        var usedThisWindow = model != nil || repoPath != nil
        for path in paths {
            if !usedThisWindow {
                usedThisWindow = true
                repoPath = path
            } else {
                openWindow(id: "repo", value: path)
            }
        }
    }

    private func load() async {
        guard let path = repoPath else {
            model?.stop()
            model = nil
            return
        }
        if model?.rootPath == path { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let newModel = try await RepoModel.open(path: path, appState: appState)
            model?.stop()
            model = newModel
            loadError = nil
            appState.noteRecent(newModel.rootPath)
            newModel.start()
            if newModel.rootPath != path { repoPath = newModel.rootPath }
        } catch {
            // Bị huỷ vì đường dẫn đổi giữa chừng: lần tải mới sẽ lo.
            if Task.isCancelled || error is CancellationError { return }
            loadError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            repoPath = nil
        }
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
                open(url.path)
            } catch {
                loadError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            }
        }
    }
}

/// Cấu hình NSWindow bên dưới: mở repo mới thành tab.
struct WindowConfigurator: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView {
        let view = ConfiguratorView()
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {}

    final class ConfiguratorView: NSView {
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            guard let window else { return }
            window.tabbingMode = .preferred
            window.tabbingIdentifier = "nhanh.repository"
        }
    }
}
