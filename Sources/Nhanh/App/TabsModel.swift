import AppKit
import NhanhCore
import SwiftUI

/// A tab in a window (like GitKraken): Home (always first, can't be closed), a new tab for choosing a repository, a
/// repository, or "What's New".
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
    /// The finished open repo (nil while loading, or when the tab isn't a repo).
    var model: RepoModel?
    var isLoading = false
    /// The error from the last attempt to open a repo — shown on this tab's repository picker screen.
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
        case .home: return String(localized: "Trang chủ")
        case .welcome: return String(localized: "Tab mới")
        case .releaseNotes: return String(localized: "Có gì mới")
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

/// The tabs of one window. The first window at launch restores the previously open repos and remembers them again.
@Observable
final class TabsModel {
    private(set) var tabs: [AppTab]
    private(set) var selectedID: UUID
    @ObservationIgnored private var persists = false

    private static let savedTabsKey = "openTabs"
    private static let savedSelectionKey = "openTabsSelected"
    private static var didRestore = false
    /// How many Thaigit windows are open (the menu opens a repo when no window is in use).
    static var liveWindows = 0
    private static var isAutomation: Bool { ProcessInfo.processInfo.environment["NHANH_SNAPSHOT_DIR"] != nil }

    /// No side effects: SwiftUI may create this several times and keep only the first (`@State`).
    init() {
        let home = AppTab(kind: .home)
        tabs = [home]
        selectedID = home.id
    }

    /// The Home tab always sits first.
    var home: AppTab { tabs[0] }

    var selected: AppTab { tabs.first { $0.id == selectedID } ?? tabs[0] }
    var selectedIndex: Int { tabs.firstIndex { $0.id == selectedID } ?? 0 }

    /// The first window of this launch reopens the previous session's repos (like GitKraken).
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

    // MARK: - Open / close

    /// Open a repository: already open in another tab → switch to that tab; from the empty "new tab" → open it right there;
    /// otherwise open a new tab — from Home it's appended at the end, from a repo tab it's inserted right of that tab.
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

    /// Close a tab (Home can't be closed); closing the selected tab selects the one to its right, or the left one when there is none.
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

    /// Close the repo but keep the tab: return to the repository picker screen.
    func closeRepository(in tab: AppTab) {
        tab.loadTask?.cancel()
        tab.model?.stop()
        tab.model = nil
        tab.isLoading = false
        tab.kind = .welcome
        save()
    }

    // MARK: - Selection / reordering

    func select(_ id: UUID) {
        guard tabs.contains(where: { $0.id == id }), selectedID != id else { return }
        selectedID = id
        save()
    }

    /// ⌘1…⌘8 select a tab by position, ⌘9 is always the last tab (like Chrome).
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

    /// Drag a tab onto another: the dragged tab takes the other's place (like Chrome).
    func move(_ id: UUID, onto target: UUID) {
        guard id != target, let from = tabs.firstIndex(where: { $0.id == id }),
              let to = tabs.firstIndex(where: { $0.id == target }), from > 0, to > 0 else { return }
        let tab = tabs.remove(at: from)
        tabs.insert(tab, at: to)
        save()
    }

    // MARK: - Loading a repo

    private func load(_ tab: AppTab) {
        guard case .repository(let path) = tab.kind else { return }
        tab.loadTask?.cancel()
        tab.isLoading = true
        tab.loadError = nil
        tab.loadTask = Task {
            do {
                let model = try await RepoModel.open(path: path, appState: AppState.shared)
                guard !Task.isCancelled, tab.kind == .repository(path) else { return }
                // Opening a subfolder of a repo that already has a tab: switch to that tab.
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
                tab.loadError = FriendlyError.message(for: error)
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
