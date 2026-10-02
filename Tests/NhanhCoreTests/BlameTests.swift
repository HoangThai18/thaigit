import Foundation
import Testing
@testable import NhanhCore

@Suite("Blame")
struct BlameTests {
    @Test func blamesWorkingTreeAndRevisions() async throws {
        let t = try await TestRepo.make()
        defer { t.cleanup() }
        try t.write("f.txt", "một\nhai\n")
        try await t.commitAll("thêm một hai")
        let first = try await t.repo.resolveCommit("HEAD")
        try t.write("f.txt", "một\nhai\nba\n")
        try await t.commitAll("thêm ba")
        let second = try await t.repo.resolveCommit("HEAD")
        try t.write("f.txt", "một\nhai\nba\nbốn chưa commit\n")

        let working = try await t.repo.blame(path: "f.txt")
        #expect(working.lines.map(\.text) == ["một", "hai", "ba", "bốn chưa commit"])
        #expect(working.lines.map(\.sha) == [first, first, second, String(repeating: "0", count: first.count)])
        #expect(working.lines.map(\.startsGroup) == [true, false, true, true])
        #expect(working.commits[first]?.summary == "thêm một hai")
        #expect(working.commits[first]?.author == "Nhánh Test")
        #expect(working.commits[first]?.email == "test@example.com")
        #expect(working.commits[working.lines[3].sha]?.isUncommitted == true)

        let atFirst = try await t.repo.blame(path: "f.txt", at: first)
        #expect(atFirst.lines.count == 2)
        #expect(Set(atFirst.lines.map(\.sha)) == [first])
    }

    @Test func parsesCRLFAndInvalidUTF8() {
        let sha = String(repeating: "a", count: 40)
        var data = Data("\(sha) 1 1 2\nauthor A\nauthor-mail <a@x>\nauthor-time 100\nsummary s\nfilename f\n\tdòng 1\r\n".utf8)
        data.append(Data("\(sha) 2 2\n\t".utf8))
        data.append(contentsOf: [0x63, 0x61, 0x66, 0xE9])  // "café" bằng Latin-1
        data.append(Data("\n".utf8))
        let blame = Blame.parse(data)
        #expect(blame.lines.count == 2)
        #expect(blame.lines[0].text == "dòng 1")
        #expect(blame.lines[1].text.hasPrefix("caf"))
        #expect(blame.lines[1].startsGroup == false)
        #expect(blame.commits[sha]?.date == Date(timeIntervalSince1970: 100))
    }
}
