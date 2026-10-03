import Foundation
import Testing
@testable import NhanhCore

@Suite("Cờ rủi ro: ca dùng chung với app Tauri")
struct RiskFlagsVectorTests {
    @Test func sharedVectors() throws {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("packages/contracts/risk-rules.vectors.json")
        let root = try #require(try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        let cases = try #require(root["cases"] as? [[String: Any]])
        #expect(cases.count >= 7)
        for item in cases {
            let name = item["name"] as? String ?? ""
            let files = try #require(item["files"] as? [[String: Any]])
            let inputs = try files.map { file in
                RiskInput(
                    path: try #require(file["path"] as? String),
                    status: try #require(RiskInput.Status(rawValue: file["status"] as? String ?? "")),
                    addedLines: file["addedLines"] as? [String] ?? [],
                    size: file["size"] as? Int
                )
            }
            let expected = try #require(item["expected"] as? [[String: Any]]).map { flag in
                RiskFlag(code: RiskCode(rawValue: flag["code"] as? String ?? "")!, paths: flag["paths"] as? [String] ?? [])
            }
            #expect(RiskRules.detect(inputs) == expected, "\(name)")
        }
    }
}

@Suite("Cờ rủi ro: gom đầu vào (git thật)")
struct RiskInputTests {
    @Test func collectsAddedLinesSizesAndNewFiles() async throws {
        let t = try await TestRepo.make()
        defer { t.cleanup() }
        try t.write("src/a.test.ts", "it('chạy', () => {});\n")
        try t.write("src/app.ts", "export const x = 1;\n")
        try await t.commitAll("init")
        try await t.git("rm", "-q", "src/a.test.ts")
        try t.write("src/app.ts", "export const x = 1;\nconst key = 'AKIAIOSFODNN7EXAMPLE';\n")
        try t.write(".env", "DEBUG=1\n")
        try t.write("data/dump.bin", bytes: Data(count: RiskRules.largeFileBytes + 10))
        try t.write("thư mục/mới.txt", "xin chào\n")
        let inputs = try await t.repo.riskInputs(status: try await t.repo.status())
        #expect(inputs.first { $0.path == "src/app.ts" }?.addedLines == ["const key = 'AKIAIOSFODNN7EXAMPLE';"])
        #expect(inputs.first { $0.path == "thư mục/mới.txt" }?.addedLines.contains("xin chào") == true)
        #expect(RiskRules.detect(inputs) == [
            RiskFlag(code: .testsRemoved, paths: ["src/a.test.ts"]),
            RiskFlag(code: .largeFile, paths: ["data/dump.bin"]),
            RiskFlag(code: .secret, paths: [".env", "src/app.ts"]),
        ])
    }
}
