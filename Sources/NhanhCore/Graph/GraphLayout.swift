import Foundation

/// One line segment to draw within a graph row.
public struct GraphLine: Sendable, Hashable {
    public enum Kind: UInt8, Sendable {
        /// A straight line through the whole row in lane `lane`.
        case pass
        /// Top half: from the top of lane `lane` into the row's node.
        case toNode
        /// Bottom half: from the node down to the bottom of lane `lane`.
        case fromNode
    }

    public let kind: Kind
    public let lane: Int
    /// Colour index; `GraphLayout.workingTreeColor` is the dashed stroke of the WIP row.
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
    /// Number of lanes this row needs.
    public let width: Int

    public init(lane: Int, color: Int, lines: [GraphLine], width: Int) {
        self.lane = lane
        self.color = color
        self.lines = lines
        self.width = width
    }
}

/// Assigns commits (already sorted children-before-parents, like `git log --date-order/--topo-order`) to lanes.
///
/// Each lane waits for one parent commit. A branch keeps its lane until the fork point, then curves into
/// the parent's node (like GitKraken), so the lines stay straight and cross rarely.
/// Colour follows the column (lane): lane 0 always has one colour, two adjacent lanes always differ, and
/// colours don't shuffle around when the history changes.
public enum GraphLayout {
    public static let workingTreeColor = -1

    public static func compute(_ commits: [Commit]) -> [GraphRow] {
        struct Lane {
            var sha: String
            /// The dashed stroke from the WIP node down to HEAD.
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

            // Top half of the row.
            for (index, lane) in lanes.enumerated() {
                guard let lane else { continue }
                let kind: GraphLine.Kind = lane.sha == commit.id ? .toNode : .pass
                lines.append(GraphLine(kind: kind, lane: index, color: color(of: index)))
            }
            for index in targets { lanes[index] = nil }

            // Bottom half: connects to the parent commits.
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
