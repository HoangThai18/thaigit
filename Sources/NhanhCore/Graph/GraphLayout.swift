import Foundation

/// Một đoạn đường cần vẽ trong một hàng của graph.
public struct GraphLine: Sendable, Hashable {
    public enum Kind: UInt8, Sendable {
        /// Đường đi thẳng qua cả hàng trong làn `lane`.
        case pass
        /// Nửa trên: từ đỉnh làn `lane` đi vào node của hàng.
        case toNode
        /// Nửa dưới: từ node đi xuống đáy làn `lane`.
        case fromNode
    }

    public let kind: Kind
    public let lane: Int
    /// Chỉ số màu; `GraphLayout.workingTreeColor` là đường nét đứt của WIP.
    public let color: Int

    public init(kind: Kind, lane: Int, color: Int) {
        self.kind = kind
        self.lane = lane
        self.color = color
    }
}

public struct GraphRow: Sendable, Hashable {
    public let lane: Int
    public let color: Int
    public let lines: [GraphLine]
    /// Số làn cần để vẽ hàng này.
    public let width: Int

    public init(lane: Int, color: Int, lines: [GraphLine], width: Int) {
        self.lane = lane
        self.color = color
        self.lines = lines
        self.width = width
    }
}

/// Xếp các commit (đã sắp con trước cha, như `git log --date-order/--topo-order`) vào các làn.
///
/// Mỗi làn chờ một commit cha. Nhánh giữ nguyên làn cho tới điểm rẽ nhánh, rồi uốn cong
/// vào node cha (giống GitKraken), nên các đường thẳng và ít cắt nhau.
/// Màu theo cột (làn): làn 0 luôn một màu, hai làn cạnh nhau luôn khác màu, và màu không
/// nhảy lung tung khi lịch sử thay đổi.
public enum GraphLayout {
    public static let workingTreeColor = -1

    public static func compute(_ commits: [Commit]) -> [GraphRow] {
        struct Lane {
            var sha: String
            /// Đường nét đứt từ node WIP xuống HEAD.
            var isWorkingTree: Bool
        }

        var lanes: [Lane?] = []
        var rows: [GraphRow] = []
        rows.reserveCapacity(commits.count)

        func color(of index: Int) -> Int {
            lanes[index]?.isWorkingTree == true ? workingTreeColor : index
        }

        func freeSlot() -> Int {
            if let index = lanes.firstIndex(where: { $0 == nil }) { return index }
            lanes.append(nil)
            return lanes.count - 1
        }

        for commit in commits {
            var lines: [GraphLine] = []
            var targets: [Int] = []
            for (index, lane) in lanes.enumerated() where lane?.sha == commit.id {
                targets.append(index)
            }

            let nodeLane = targets.first ?? freeSlot()
            let nodeColor = commit.isWorkingTree ? workingTreeColor : nodeLane

            // Nửa trên của hàng.
            for (index, lane) in lanes.enumerated() {
                guard let lane else { continue }
                let kind: GraphLine.Kind = lane.sha == commit.id ? .toNode : .pass
                lines.append(GraphLine(kind: kind, lane: index, color: color(of: index)))
            }
            for index in targets { lanes[index] = nil }

            // Nửa dưới: nối tới các commit cha.
            for (parentIndex, parent) in commit.parents.enumerated() {
                if parentIndex == 0 {
                    lanes[nodeLane] = Lane(sha: parent, isWorkingTree: commit.isWorkingTree)
                    lines.append(GraphLine(kind: .fromNode, lane: nodeLane, color: color(of: nodeLane)))
                } else if let existing = lanes.firstIndex(where: { $0?.sha == parent }) {
                    lines.append(GraphLine(kind: .fromNode, lane: existing, color: color(of: existing)))
                } else {
                    let slot = freeSlot()
                    lanes[slot] = Lane(sha: parent, isWorkingTree: false)
                    lines.append(GraphLine(kind: .fromNode, lane: slot, color: color(of: slot)))
                }
            }

            while let last = lanes.last, last == nil { lanes.removeLast() }

            let width = max(lines.map(\.lane).max() ?? 0, nodeLane) + 1
            rows.append(GraphRow(lane: nodeLane, color: nodeColor, lines: lines, width: width))
        }
        return rows
    }
}
