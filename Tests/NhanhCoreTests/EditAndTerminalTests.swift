import Foundation
import Testing
@testable import NhanhCore

@Suite("Sửa file trong app và terminal đơn giản")
struct EditAndTerminalTests {
    private func tempDirectory() throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("nhanh-edit-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    @Test func keepsBOMLineEndingsAndPermissions() throws {
        let root = try tempDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let url = root.appendingPathComponent("chay.sh")
        try (Data([0xEF, 0xBB, 0xBF]) + Data("dòng 1\r\ndòng 2\r\n".utf8)).write(to: url)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: url.path)

        let file = try EditableTextFile.open(path: "chay.sh", in: root)
        #expect(file.hasBOM && file.usesCRLF)
        #expect(file.text == "dòng 1\ndòng 2\n")
        let saved = try file.save("dòng 1\ndòng 2 đã sửa\ndòng 3\n", in: root)
        #expect(try Data(contentsOf: url) == Data([0xEF, 0xBB, 0xBF]) + Data("dòng 1\r\ndòng 2 đã sửa\r\ndòng 3\r\n".utf8))
        let mode = try FileManager.default.attributesOfItem(atPath: url.path)[.posixPermissions] as? Int
        #expect(mode == 0o755)
        // No temp file left behind.
        #expect(try FileManager.default.contentsOfDirectory(atPath: root.path) == ["chay.sh"])

        // Edited elsewhere after opening: no overwrite unless allowed.
        try Data("người khác sửa\r\n".utf8).write(to: url)
        #expect(throws: EditableTextFile.Problem.changedOnDisk) { _ = try saved.save("của tôi\n", in: root) }
        _ = try saved.save("của tôi\n", in: root, overwrite: true)
        #expect(try Data(contentsOf: url) == Data([0xEF, 0xBB, 0xBF]) + Data("của tôi\r\n".utf8))
    }

    @Test func refusesFilesItCannotEditSafely() throws {
        let root = try tempDirectory()
        let outside = try tempDirectory()
        defer {
            try? FileManager.default.removeItem(at: root)
            try? FileManager.default.removeItem(at: outside)
        }
        try Data("a\r\nb\nc".utf8).write(to: root.appendingPathComponent("lan.txt"))
        try Data([0x61, 0xFF, 0x62]).write(to: root.appendingPathComponent("latin.txt"))
        try Data([0x61, 0x00, 0x62]).write(to: root.appendingPathComponent("anh.bin"))
        try Data("bí mật".utf8).write(to: outside.appendingPathComponent("ngoai.txt"))
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("lien-ket.txt"),
                                                   withDestinationURL: outside.appendingPathComponent("ngoai.txt"))
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("thu-muc"), withDestinationURL: outside)

        #expect(throws: EditableTextFile.Problem.mixedLineEndings) { _ = try EditableTextFile.open(path: "lan.txt", in: root) }
        #expect(throws: EditableTextFile.Problem.notUTF8) { _ = try EditableTextFile.open(path: "latin.txt", in: root) }
        #expect(throws: EditableTextFile.Problem.binary) { _ = try EditableTextFile.open(path: "anh.bin", in: root) }
        #expect(throws: EditableTextFile.Problem.symlink) { _ = try EditableTextFile.open(path: "lien-ket.txt", in: root) }
        #expect(throws: EditableTextFile.Problem.outsideRepository) { _ = try EditableTextFile.open(path: "thu-muc/ngoai.txt", in: root) }
        #expect(throws: EditableTextFile.Problem.outsideRepository) { _ = try EditableTextFile.open(path: "../x.txt", in: root) }
        #expect(throws: EditableTextFile.Problem.notFound) { _ = try EditableTextFile.open(path: "khong-co.txt", in: root) }
    }

    @Test func runsCommandsStreamsOutputAndFollowsCd() async throws {
        let root = try tempDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let lines = LockedBox([(String, Bool)]())
        let environment = TerminalShell.environment(base: ["PATH": "/usr/bin:/bin"])
        let result = try await TerminalShell.run(
            "echo xin chào; echo lỗi >&2; mkdir -p con && cd con; printf '\\033[31mđỏ\\033[0m không xuống dòng'",
            in: root, environment: environment, loginShell: false) { line, isError in
            lines.withValue { $0.append((line, isError)) }
        }
        #expect(result.exitCode == 0)
        #expect(result.directory.resolvingSymlinksInPath() == root.appendingPathComponent("con").resolvingSymlinksInPath())
        let output = lines.current
        #expect(output.filter { !$0.1 }.map(\.0) == ["xin chào", "đỏ không xuống dòng"])
        #expect(output.filter(\.1).map(\.0) == ["lỗi"])

        let failed = try await TerminalShell.run("exit 3", in: root, environment: environment, loginShell: false) { _, _ in }
        #expect(failed.exitCode == 3)
        #expect(failed.directory == root)
        // Lệnh không chờ bàn phím: đọc stdin thì nhận EOF ngay.
        let reading = try await TerminalShell.run("read x; echo \"đọc: [$x]\"", in: root, environment: environment, loginShell: false) { line, _ in
            lines.withValue { $0.append((line, false)) }
        }
        #expect(reading.exitCode == 0)
        #expect(lines.current.last?.0 == "đọc: []")
        #expect(TerminalText.clean("tải 10%\rtải 50%\rtải 100%") == "tải 100%")
    }
}
