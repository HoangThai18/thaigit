import Foundation
import Testing
@testable import NhanhCore

@Suite("Graph layout")
struct GraphLayoutTests {
    func commit(_ id: String, _ parents: [String] = []) -> Commit {
        Commit(id: id, parents: parents, authorName: "A", authorEmail: "a@x", authorDate: Date(),
               committerName: "A", committerEmail: "a@x", commitDate: Date(), subject: id)
    }

    @Test func linearHistoryStaysInOneLane() {
        let rows = GraphLayout.compute([commit("c3", ["c2"]), commit("c2", ["c1"]), commit("c1")])
        #expect(rows.map(\.lane) == [0, 0, 0])
        #expect(Set(rows.map(\.color)).count == 1)
        #expect(rows[0].lines == [GraphLine(kind: .fromNode, lane: 0, color: 0)])
        #expect(rows[1].lines == [GraphLine(kind: .toNode, lane: 0, color: 0), GraphLine(kind: .fromNode, lane: 0, color: 0)])
        #expect(rows[2].lines == [GraphLine(kind: .toNode, lane: 0, color: 0)])
        #expect(rows.allSatisfy { $0.width == 1 })
    }

    @Test func mergeOpensSecondLaneAndJoinsAtForkPoint() {
        // M = merge(A, F); F trên nhánh feature tách từ A.
        let rows = GraphLayout.compute([
            commit("M", ["A", "F"]),
            commit("F", ["A"]),
            commit("A", ["R"]),
            commit("R"),
        ])
        #expect(rows.map(\.lane) == [0, 1, 0, 0])
        #expect(rows[0].lines == [
            GraphLine(kind: .fromNode, lane: 0, color: 0),
            GraphLine(kind: .fromNode, lane: 1, color: 1),
        ])
        #expect(rows[1].color == 1)
        #expect(rows[1].lines == [
            GraphLine(kind: .pass, lane: 0, color: 0),
            GraphLine(kind: .toNode, lane: 1, color: 1),
            GraphLine(kind: .fromNode, lane: 1, color: 1),
        ])
        // A nhận cả hai làn (điểm rẽ nhánh), sau đó chỉ còn một làn.
        #expect(rows[2].lines == [
            GraphLine(kind: .toNode, lane: 0, color: 0),
            GraphLine(kind: .toNode, lane: 1, color: 1),
            GraphLine(kind: .fromNode, lane: 0, color: 0),
        ])
        #expect(rows[2].width == 2)
        #expect(rows[3].width == 1)
    }

    @Test func colorsFollowLanes() {
        let rows = GraphLayout.compute([commit("X", ["P"]), commit("Y", ["P"]), commit("Z", ["P"]), commit("P")])
        #expect(rows.map(\.color) == [0, 1, 2, 0])
        for row in rows {
            for line in row.lines { #expect(line.color == line.lane) }
        }
    }

    @Test func siblingTipsGetSeparateLanes() {
        let rows = GraphLayout.compute([commit("X", ["P"]), commit("Y", ["P"]), commit("P")])
        #expect(rows.map(\.lane) == [0, 1, 0])
        #expect(rows[1].color != rows[0].color)
        #expect(rows[2].lines.filter { $0.kind == .toNode }.map(\.lane) == [0, 1])
    }

    @Test func reusesFreedLanes() {
        // Nhánh b kết thúc (gặp cha) rồi nhánh c mới mở lại dùng làn trống.
        let rows = GraphLayout.compute([
            commit("a2", ["a1"]),
            commit("b1", ["a1"]),
            commit("a1", ["a0"]),
            commit("c1", ["a0"]),
            commit("a0"),
        ])
        #expect(rows.map(\.lane) == [0, 1, 0, 1, 0])
        #expect(rows.map(\.width).max() == 2)
    }

    @Test func workingTreeRowIsDashedAndDoesNotShiftColors() {
        let withoutWIP = GraphLayout.compute([commit("h", ["g"]), commit("g")])
        let withWIP = GraphLayout.compute([Commit.workingTree(parent: "h"), commit("h", ["g"]), commit("g")])
        #expect(withWIP[0].color == GraphLayout.workingTreeColor)
        #expect(withWIP[0].lines == [GraphLine(kind: .fromNode, lane: 0, color: GraphLayout.workingTreeColor)])
        #expect(withWIP[1].lines.first == GraphLine(kind: .toNode, lane: 0, color: GraphLayout.workingTreeColor))
        #expect(withWIP[1].color == withoutWIP[0].color)
        #expect(withWIP[2].color == withoutWIP[1].color)
    }

    @Test func unbornWorkingTreeHasNoParentLine() {
        let rows = GraphLayout.compute([Commit.workingTree(parent: nil)])
        #expect(rows.count == 1)
        #expect(rows[0].lines.isEmpty)
    }

    @Test func handlesThousandsOfCommitsQuickly() {
        var commits: [Commit] = []
        for i in stride(from: 5000, to: 0, by: -1) {
            let parents = i == 1 ? [] : (i % 50 == 0 ? ["c\(i - 1)", "side\(i)"] : ["c\(i - 1)"])
            commits.append(commit("c\(i)", parents))
            if i % 50 == 0 { commits.append(commit("side\(i)", ["c\(i - 10)"])) }
        }
        let start = Date()
        let rows = GraphLayout.compute(commits)
        #expect(rows.count == commits.count)
        #expect(Date().timeIntervalSince(start) < 2)
    }
}
