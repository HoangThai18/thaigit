import Foundation
import Testing
@testable import NhanhCore

@Suite("Ẩn / solo nhánh trên graph")
struct GraphRefFilterTests {
    @Test func hiddenAndSoloBranchesChangeHistory() async throws {
        let t = try await TestRepo.make()
        defer { t.cleanup() }
        try t.write("a.txt", "1\n")
        try await t.commitAll("gốc")
        for name in ["tinh-nang/a", "thu-nghiem", "thu-nghiem-2"] {
            try await t.git("switch", "-c", name, "main")
            try t.write("\(name.replacingOccurrences(of: "/", with: "-")).txt", name)
            try await t.commitAll("commit trên \(name)")
        }
        try await t.git("switch", "main")
        try t.write("b.txt", "b\n")
        try await t.commitAll("main đi tiếp")

        func subjects(_ filter: GraphRefFilter) async throws -> Set<String> {
            Set(try await t.repo.log(limit: 100, order: .topo, includeHEAD: true, filter: filter).map(\.subject))
        }
        let all: Set = ["gốc", "commit trên tinh-nang/a", "commit trên thu-nghiem", "commit trên thu-nghiem-2", "main đi tiếp"]
        #expect(try await subjects(GraphRefFilter()) == all)
        // Ẩn: commit riêng của nhánh biến mất, commit chung vẫn còn; ẩn "thu-nghiem" không ẩn nhầm "thu-nghiem-2".
        #expect(try await subjects(GraphRefFilter(hidden: ["refs/heads/thu-nghiem"])) == all.subtracting(["commit trên thu-nghiem"]))
        #expect(try await subjects(GraphRefFilter(hidden: ["refs/heads/tinh-nang/a", "refs/heads/thu-nghiem", "refs/heads/thu-nghiem-2"]))
                == ["gốc", "main đi tiếp"])
        // Solo: chỉ nhánh đó, kèm nhánh đang checkout (HEAD).
        #expect(try await subjects(GraphRefFilter(solo: ["refs/heads/tinh-nang/a"]))
                == ["gốc", "commit trên tinh-nang/a", "main đi tiếp"])
    }

    @Test func buildsRevisionArguments() {
        let filter = GraphRefFilter(hidden: ["refs/heads/x", "refs/remotes/origin/y", "refs/heads/a[1]"])
        #expect(filter.revisionArguments(includeHEAD: true, includeRemotes: true, includeTags: false)
                == ["--exclude=a\\[1\\]", "--exclude=x", "--branches", "--exclude=origin/y", "--remotes", "HEAD"])
        #expect(GraphRefFilter().revisionArguments(includeHEAD: false, includeRemotes: true, includeTags: true)
                == ["--branches", "--remotes", "--tags"])
        let solo = GraphRefFilter(hidden: ["refs/heads/x"], solo: ["refs/remotes/origin/b", "refs/heads/a", "--evil"])
        #expect(solo.revisionArguments(includeHEAD: true, includeRemotes: true, includeTags: true)
                == ["refs/heads/a", "refs/remotes/origin/b", "HEAD"])
        #expect(solo.isVisible("refs/heads/a") && !solo.isVisible("refs/heads/main"))
        #expect(!filter.isVisible("refs/heads/x") && filter.isVisible("refs/heads/main"))
        #expect(solo.keeping(["refs/heads/a"]) == GraphRefFilter(solo: ["refs/heads/a"]))
    }
}
