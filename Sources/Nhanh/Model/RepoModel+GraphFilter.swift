import Foundation
import NhanhCore

/// A branch on the graph: shown normally, currently hidden, or part of a "show only" (solo) group.
enum GraphVisibility {
    case normal
    case hidden
    case solo
    /// There is a solo group this branch doesn't belong to.
    case outsideSolo
}

extension RepoModel {
    // MARK: - State

    func graphVisibility(of ref: GitRef) -> GraphVisibility {
        if graphFilter.solo.contains(ref.fullName) { return .solo }
        if !graphFilter.solo.isEmpty { return .outsideSolo }
        return graphFilter.hidden.contains(ref.fullName) ? .hidden : .normal
    }

    /// Hiding / soloing a local branch also hides its upstream (the branch on the remote it tracks) — otherwise the
    /// branch's history would still be on the graph through the remote branch.
    private func filterNames(for ref: GitRef) -> Set<String> {
        var names: Set<String> = [ref.fullName]
        if ref.kind == .localBranch, let upstream = ref.upstream,
           let remote = remoteBranches.first(where: { $0.name == upstream }) {
            names.insert(remote.fullName)
        }
        return names
    }

    /// The checked-out branch (and the remote branch it tracks) is always shown — it can't be hidden. Only reads `refs`,
    /// never `status`, so the sidebar doesn't repaint on every working tree change.
    func canHideOnGraph(_ ref: GitRef) -> Bool {
        switch ref.kind {
        case .tag: return false
        case .localBranch: return !ref.isHead
        case .remoteBranch: return localBranches.first(where: \.isHead)?.upstream != ref.name
        }
    }

    // MARK: - Thao tác

    func toggleHidden(_ ref: GitRef) {
        guard ref.kind != .tag else { return }
        let names = filterNames(for: ref)
        if graphFilter.hidden.contains(ref.fullName) {
            graphFilter.hidden.subtract(names)
        } else {
            guard canHideOnGraph(ref) else {
                toast(.info, String(localized: "Không ẩn được nhánh đang checkout"))
                return
            }
            graphFilter.solo.subtract(names)
            graphFilter.hidden.formUnion(names)
            toast(.info, String(localized: "Đã ẩn \(ref.name) khỏi graph"), actions: [
                ToastAction(title: String(localized: "Hoàn tác")) { [weak self] in self?.graphFilter.hidden.subtract(names) },
            ], tag: "graph-filter")
        }
    }

    /// Add / remove a branch from the "show only" (solo) group: with a solo group the graph keeps only the branches in it plus the checked-out one.
    func toggleSolo(_ ref: GitRef) {
        guard ref.kind != .tag else { return }
        let names = filterNames(for: ref)
        if graphFilter.solo.contains(ref.fullName) {
            graphFilter.solo.subtract(names)
        } else {
            graphFilter.hidden.subtract(names)
            graphFilter.solo.formUnion(names)
        }
    }

    func showAllBranchesOnGraph() {
        graphFilter = GraphRefFilter()
    }

    /// A short description for the strip above the graph, nil when nothing is filtered.
    var graphFilterSummary: String? {
        let existing = Set(refs.map(\.fullName))
        let filter = graphFilter.keeping(existing)
        guard filter.isActive else { return nil }
        func count(_ names: Set<String>) -> Int {
            // Counted per branch the user picked: a remote branch riding along with a local one isn't counted again.
            let locals = refs.filter { $0.kind == .localBranch && names.contains($0.fullName) }
            let paired = Set(locals.compactMap(\.upstream))
            return names.count - refs.filter { $0.kind == .remoteBranch && names.contains($0.fullName) && paired.contains($0.name) }.count
        }
        if !filter.solo.isEmpty { return String(localized: "Chỉ hiện \(count(filter.solo)) nhánh (và nhánh đang checkout)") }
        return String(localized: "Đang ẩn \(count(filter.hidden)) nhánh")
    }

    func graphFilterMenuItems(for ref: GitRef) -> [MenuItemSpec] {
        guard ref.kind != .tag else { return [] }
        let hidden = graphFilter.hidden.contains(ref.fullName)
        let solo = graphFilter.solo.contains(ref.fullName)
        var items: [MenuItemSpec] = [
            .action(hidden ? String(localized: "Hiện lại trên graph") : String(localized: "Ẩn khỏi graph"), systemImage: hidden ? "eye" : "eye.slash",
                    enabled: hidden || canHideOnGraph(ref)) { [weak self] in self?.toggleHidden(ref) },
            .action(solo ? String(localized: "Bỏ khỏi nhóm chỉ hiện (solo)") : String(localized: "Chỉ hiện nhánh này (solo)"), systemImage: "scope") { [weak self] in
                self?.toggleSolo(ref)
            },
        ]
        if graphFilter.isActive {
            items.append(.action(String(localized: "Hiện tất cả nhánh"), systemImage: "eye") { [weak self] in self?.showAllBranchesOnGraph() })
        }
        return items
    }

    // MARK: - Persisted per repo

    private var graphFilterKey: String { "graphFilter." + repository.root.path }

    func loadGraphFilter() {
        guard let data = UserDefaults.standard.data(forKey: graphFilterKey),
              let saved = try? JSONDecoder().decode(GraphRefFilter.self, from: data) else { return }
        graphFilter = saved
    }

    func saveGraphFilter() {
        if graphFilter.isActive, let data = try? JSONEncoder().encode(graphFilter) {
            UserDefaults.standard.set(data, forKey: graphFilterKey)
        } else {
            UserDefaults.standard.removeObject(forKey: graphFilterKey)
        }
    }
}
