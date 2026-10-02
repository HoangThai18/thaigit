import Foundation
import NhanhCore

/// Nhánh trên graph: hiện bình thường, đang ẩn, hoặc nằm trong nhóm "chỉ hiện" (solo).
enum GraphVisibility {
    case normal
    case hidden
    case solo
    /// Có nhóm solo mà nhánh này không thuộc nhóm đó.
    case outsideSolo
}

extension RepoModel {
    // MARK: - Trạng thái

    func graphVisibility(of ref: GitRef) -> GraphVisibility {
        if graphFilter.solo.contains(ref.fullName) { return .solo }
        if !graphFilter.solo.isEmpty { return .outsideSolo }
        return graphFilter.hidden.contains(ref.fullName) ? .hidden : .normal
    }

    /// Ẩn / solo nhánh local thì nhánh upstream (nhánh trên remote nó theo dõi) đi cùng — không thì đường lịch sử
    /// của nhánh vẫn còn trên graph qua nhánh remote.
    private func filterNames(for ref: GitRef) -> Set<String> {
        var names: Set<String> = [ref.fullName]
        if ref.kind == .localBranch, let upstream = ref.upstream,
           let remote = remoteBranches.first(where: { $0.name == upstream }) {
            names.insert(remote.fullName)
        }
        return names
    }

    /// Nhánh đang checkout (và nhánh remote nó theo dõi) luôn hiện — không cho ẩn. Chỉ đọc `refs`, không đọc `status`,
    /// để sidebar không phải vẽ lại mỗi khi working tree đổi.
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
                toast(.info, "Không ẩn được nhánh đang checkout")
                return
            }
            graphFilter.solo.subtract(names)
            graphFilter.hidden.formUnion(names)
            toast(.info, "Đã ẩn \(ref.name) khỏi graph", actions: [
                ToastAction(title: "Hoàn tác") { [weak self] in self?.graphFilter.hidden.subtract(names) },
            ], tag: "graph-filter")
        }
    }

    /// Thêm / bỏ nhánh khỏi nhóm "chỉ hiện" (solo): có nhóm solo thì graph chỉ còn các nhánh trong nhóm và nhánh đang checkout.
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

    /// Mô tả ngắn cho dải báo trên graph, nil khi không lọc gì.
    var graphFilterSummary: String? {
        let existing = Set(refs.map(\.fullName))
        let filter = graphFilter.keeping(existing)
        guard filter.isActive else { return nil }
        func count(_ names: Set<String>) -> Int {
            // Đếm theo nhánh người dùng chọn: nhánh remote đi kèm nhánh local không đếm thêm.
            let locals = refs.filter { $0.kind == .localBranch && names.contains($0.fullName) }
            let paired = Set(locals.compactMap(\.upstream))
            return names.count - refs.filter { $0.kind == .remoteBranch && names.contains($0.fullName) && paired.contains($0.name) }.count
        }
        if !filter.solo.isEmpty { return "Chỉ hiện \(count(filter.solo)) nhánh (và nhánh đang checkout)" }
        return "Đang ẩn \(count(filter.hidden)) nhánh"
    }

    func graphFilterMenuItems(for ref: GitRef) -> [MenuItemSpec] {
        guard ref.kind != .tag else { return [] }
        let hidden = graphFilter.hidden.contains(ref.fullName)
        let solo = graphFilter.solo.contains(ref.fullName)
        var items: [MenuItemSpec] = [
            .action(hidden ? "Hiện lại trên graph" : "Ẩn khỏi graph", systemImage: hidden ? "eye" : "eye.slash",
                    enabled: hidden || canHideOnGraph(ref)) { [weak self] in self?.toggleHidden(ref) },
            .action(solo ? "Bỏ khỏi nhóm chỉ hiện (solo)" : "Chỉ hiện nhánh này (solo)", systemImage: "scope") { [weak self] in
                self?.toggleSolo(ref)
            },
        ]
        if graphFilter.isActive {
            items.append(.action("Hiện tất cả nhánh", systemImage: "eye") { [weak self] in self?.showAllBranchesOnGraph() })
        }
        return items
    }

    // MARK: - Lưu theo repo

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
