import AppKit
import NhanhCore
import SwiftUI

/// Một tab trong cửa sổ (như GitKraken): Trang chủ (luôn ở đầu, không đóng được), tab mới để chọn repository,
/// một repository, hoặc "Có gì mới".
@Observable
final class AppTab: Identifiable {
    enum Kind: Equatable {
        case home
        case welcome
        case repository(String)
        case releaseNotes
    }

    let id = UUID()
    var kind: Kind
    /// Repo đã mở xong (nil khi đang tải hoặc tab không phải repo).
    var model: RepoModel?
    var isLoading = false
    /// Lỗi mở repo lần trước — hiện trên màn hình chọn repository của tab này.
    var loadError: String?
    @ObservationIgnored var loadTask: Task<Void, Never>?

    init(kind: Kind) {
        self.kind = kind
    }

    var repositoryPath: String? {
        if case .repository(let path) = kind { return model?.rootPath ?? path }
        return nil
    }

    var title: String {
        switch kind {
        case .home: return "Trang chủ"
        case .welcome: return "Tab mới"
        case .releaseNotes: return "Có gì mới"
        case .repository(let path): return model?.name ?? (path as NSString).lastPathComponent
        }
    }

    var systemImage: String {
        switch kind {
        case .home: return "house.fill"
        case .welcome: return "square.grid.2x2"
        case .releaseNotes: return "sparkles"
        case .repository: return "folder.fill"
        }
    }
}

/// Các tab của một cửa sổ. Cửa sổ đầu tiên khi mở app khôi phục các repo đang mở lần trước và ghi nhớ lại.
@Observable
final class TabsModel {
    private(set) var tabs: [AppTab]
    private(set) var selectedID: UUID
    @ObservationIgnored private var persists = false

    private static let savedTabsKey = "openTabs"
    private static let savedSelectionKey = "openTabsSelected"
    private static var didRestore = false
    /// Số cửa sổ Thaigit đang mở (menu mở repo khi không cửa sổ nào đang dùng).
    static var liveWindows = 0
    private static var isAutomation: Bool { ProcessInfo.processInfo.environment["NHANH_SNAPSHOT_DIR"] != nil }

    /// Không có tác dụng phụ: SwiftUI có thể tạo nhiều lần rồi chỉ giữ bản đầu (`@State`).
    init() {
        let home = AppTab(kind: .home)
        tabs = [home]
        selectedID = home.id
    }

    /// Tab Trang chủ luôn ở vị trí đầu.
    var home: AppTab { tabs[0] }

    var selected: AppTab { tabs.first { $0.id == selectedID } ?? tabs[0] }
    var selectedIndex: Int { tabs.firstIndex { $0.id == selectedID } ?? 0 }

    /// Cửa sổ đầu tiên của lần chạy này mở lại các repo của lần trước (như GitKraken).
    func restoreIfFirstWindow() {
        guard !Self.didRestore else { return }
        Self.didRestore = true
        guard !Self.isAutomation else { return }
        persists = true
        let defaults = UserDefaults.standard
        let paths = (defaults.stringArray(forKey: Self.savedTabsKey) ?? []).filter { FileManager.default.fileExists(atPath: $0) }
        guard !paths.isEmpty, tabs.count == 1 else { return }
        let restored = paths.map { AppTab(kind: .repository($0)) }
        tabs = [home] + restored
        let saved = defaults.string(forKey: Self.savedSelectionKey)
        selectedID = (restored.first { $0.repositoryPath == saved } ?? home).id
        restored.forEach(load)
    }

    // MARK: - Mở / đóng

    /// Mở repository: đã mở ở tab khác thì chuyển sang tab đó; đang ở tab mới (trống) thì mở ngay tại đây; còn lại mở
    /// tab mới — từ Trang chủ thì thêm vào cuối, từ tab repo thì ngay bên phải tab đó.
    func open(path: String) {
        let path = URL(fileURLWithPath: path).standardizedFileURL.path
        if let existing = tabs.first(where: { $0.repositoryPath == path }) {
            select(existing.id)
            return
        }
        let tab: AppTab
        if selected.kind == .welcome {
            tab = selected
        } else {
            tab = AppTab(kind: .welcome)
            tabs.insert(tab, at: selected.kind == .home ? tabs.count : selectedIndex + 1)
        }
        tab.kind = .repository(path)
        selectedID = tab.id
        load(tab)
    }

    @discardableResult
    func newTab() -> AppTab {
        let tab = AppTab(kind: .welcome)
        tabs.append(tab)
        selectedID = tab.id
        return tab
    }

    func openReleaseNotes() {
        if let existing = tabs.first(where: { $0.kind == .releaseNotes }) {
            select(existing.id)
        } else {
            let tab = AppTab(kind: .releaseNotes)
            tabs.insert(tab, at: selectedIndex + 1)
            selectedID = tab.id
        }
    }

    /// Đóng tab (Trang chủ không đóng được); đóng tab đang chọn thì chọn tab bên phải, hết thì tab bên trái.
    func close(_ id: UUID) {
        guard let index = tabs.firstIndex(where: { $0.id == id }), tabs[index].kind != .home else { return }
        let tab = tabs.remove(at: index)
        tab.loadTask?.cancel()
        tab.model?.stop()
        if selectedID == id { selectedID = tabs[min(index, tabs.count - 1)].id }
        save()
    }

    func closeOthers(than id: UUID) {
        for tab in tabs where tab.id != id { close(tab.id) }
    }

    func closeToTheRight(of id: UUID) {
        guard let index = tabs.firstIndex(where: { $0.id == id }) else { return }
        for tab in tabs[(index + 1)...] { close(tab.id) }
    }

    /// Đóng repo nhưng giữ tab: quay về màn hình chọn repository.
    func closeRepository(in tab: AppTab) {
        tab.loadTask?.cancel()
        tab.model?.stop()
        tab.model = nil
        tab.isLoading = false
        tab.kind = .welcome
        save()
    }

    // MARK: - Chọn / sắp xếp

    func select(_ id: UUID) {
        guard tabs.contains(where: { $0.id == id }), selectedID != id else { return }
        selectedID = id
        save()
    }

    /// ⌘1…⌘8 chọn tab theo thứ tự, ⌘9 luôn là tab cuối (như Chrome).
    func select(number: Int) {
        let index = number == 9 ? tabs.count - 1 : number - 1
        guard tabs.indices.contains(index) else { return }
        select(tabs[index].id)
    }

    func selectNext(_ step: Int) {
        guard tabs.count > 1 else { return }
        let index = (selectedIndex + step + tabs.count) % tabs.count
        select(tabs[index].id)
    }

    /// Kéo tab thả lên tab khác: tab được kéo chiếm chỗ của tab kia (như Chrome).
    func move(_ id: UUID, onto target: UUID) {
        guard id != target, let from = tabs.firstIndex(where: { $0.id == id }),
              let to = tabs.firstIndex(where: { $0.id == target }), from > 0, to > 0 else { return }
        let tab = tabs.remove(at: from)
        tabs.insert(tab, at: to)
        save()
    }

    // MARK: - Tải repo

    private func load(_ tab: AppTab) {
        guard case .repository(let path) = tab.kind else { return }
        tab.loadTask?.cancel()
        tab.isLoading = true
        tab.loadError = nil
        tab.loadTask = Task {
            do {
                let model = try await RepoModel.open(path: path, appState: AppState.shared)
                guard !Task.isCancelled, tab.kind == .repository(path) else { return }
                // Mở thư mục con của repo đã có tab: chuyển sang tab đó.
                if let existing = tabs.first(where: { $0 !== tab && $0.repositoryPath == model.rootPath }) {
                    let wasSelected = selectedID == tab.id
                    close(tab.id)
                    if wasSelected { select(existing.id) }
                    return
                }
                tab.kind = .repository(model.rootPath)
                tab.model = model
                tab.isLoading = false
                AppState.shared.noteRecent(model.rootPath)
                save()
            } catch {
                guard !Task.isCancelled, tab.kind == .repository(path) else { return }
                tab.isLoading = false
                tab.kind = .welcome
                tab.loadError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                save()
            }
        }
    }

    private func save() {
        guard persists else { return }
        let defaults = UserDefaults.standard
        defaults.set(tabs.compactMap(\.repositoryPath), forKey: Self.savedTabsKey)
        defaults.set(selected.repositoryPath, forKey: Self.savedSelectionKey)
    }
}
