// Công cụ phát hành Thaigit: khoá ký bản cập nhật và update.json (scripts/release.sh gọi tới).
//
//   swift scripts/release-tool.swift generate-key   tạo khoá Ed25519, cất khoá bí mật vào Keychain, in khoá công khai
//   swift scripts/release-tool.swift public-key     in khoá công khai của khoá đang có
//   swift scripts/release-tool.swift manifest <zip> <phiên bản> <url tải> [file ghi chú]
//                                                   in update.json đã ký (và tự kiểm lại bằng khoá trong Info.plist)
//
// Khoá bí mật nằm trong login Keychain (mục "Thaigit update signing key"), hoặc trong biến môi trường
// THAIGIT_UPDATE_PRIVATE_KEY (base64) khi phát hành từ máy khác/CI. Tuyệt đối không commit khoá bí mật.
import CryptoKit
import Foundation

let service = "Thaigit update signing key"
let account = "thaigit"

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

@discardableResult
func run(_ executable: String, _ arguments: [String], input: String? = nil) -> (status: Int32, output: String) {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = arguments
    let output = Pipe()
    process.standardOutput = output
    process.standardError = output
    let stdin = Pipe()
    if input != nil { process.standardInput = stdin }
    do { try process.run() } catch { fail("Không chạy được \(executable): \(error)") }
    if let input {
        stdin.fileHandleForWriting.write(Data(input.utf8))
        try? stdin.fileHandleForWriting.close()
    }
    let data = output.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    return (process.terminationStatus, String(decoding: data, as: UTF8.self))
}

func storedPrivateKey() -> Curve25519.Signing.PrivateKey? {
    var encoded = ProcessInfo.processInfo.environment["THAIGIT_UPDATE_PRIVATE_KEY"]
    if encoded == nil {
        let result = run("/usr/bin/security", ["find-generic-password", "-a", account, "-s", service, "-w"])
        if result.status == 0 { encoded = result.output }
    }
    guard let encoded,
          let raw = Data(base64Encoded: encoded.trimmingCharacters(in: .whitespacesAndNewlines))
    else { return nil }
    return try? Curve25519.Signing.PrivateKey(rawRepresentation: raw)
}

func requirePrivateKey() -> Curve25519.Signing.PrivateKey {
    guard let key = storedPrivateKey() else {
        fail("Chưa có khoá ký bản cập nhật. Tạo bằng: swift scripts/release-tool.swift generate-key")
    }
    return key
}

func publicKeyInInfoPlist() -> String? {
    let plist = URL(fileURLWithPath: "Resources/Info.plist")
    guard let data = try? Data(contentsOf: plist),
          let info = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any]
    else { return nil }
    return info["ThaigitUpdatePublicKey"] as? String
}

let arguments = Array(CommandLine.arguments.dropFirst())
switch arguments.first {
case "generate-key":
    if storedPrivateKey() != nil {
        fail("Đã có khoá trong Keychain (mục \"\(service)\"). Dùng `public-key` để xem khoá công khai.")
    }
    let key = Curve25519.Signing.PrivateKey()
    let secret = key.rawRepresentation.base64EncodedString()
    // Đưa lệnh qua stdin của `security -i` để khoá bí mật không lộ trong danh sách tiến trình.
    let result = run("/usr/bin/security", ["-i"], input: "add-generic-password -a \(account) -s \"\(service)\" -w \"\(secret)\" -U\n")
    guard result.status == 0, storedPrivateKey() != nil else { fail("Không lưu được khoá vào Keychain: \(result.output)") }
    print(key.publicKey.rawRepresentation.base64EncodedString())

case "public-key":
    print(requirePrivateKey().publicKey.rawRepresentation.base64EncodedString())

case "manifest":
    guard arguments.count >= 4 else { fail("Cách dùng: manifest <zip> <phiên bản> <url tải> [file ghi chú]") }
    let key = requirePrivateKey()
    let publicKey = key.publicKey.rawRepresentation.base64EncodedString()
    guard publicKeyInInfoPlist() == publicKey else {
        fail("Khoá công khai trong Resources/Info.plist (ThaigitUpdatePublicKey) không khớp khoá ký — app đã cài sẽ từ chối bản này.")
    }
    let zip = URL(fileURLWithPath: arguments[1])
    guard let data = try? Data(contentsOf: zip) else { fail("Không đọc được \(zip.path)") }
    let notes = arguments.count > 4
        ? (try? String(contentsOfFile: arguments[4], encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines)
        : nil
    let signature = try key.signature(for: data)
    guard key.publicKey.isValidSignature(signature, for: data) else { fail("Ký thử không thành công") }
    var manifest: [String: Any] = [
        "version": arguments[2],
        "url": arguments[3],
        "size": data.count,
        "sha256": SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined(),
        "signature": signature.base64EncodedString(),
        "minimumSystemVersion": "14.0",
        "publishedAt": ISO8601DateFormatter().string(from: Date()),
    ]
    if let notes, !notes.isEmpty { manifest["notes"] = notes }
    let json = try JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
    print(String(decoding: json, as: UTF8.self))

default:
    fail("""
    Cách dùng:
      swift scripts/release-tool.swift generate-key
      swift scripts/release-tool.swift public-key
      swift scripts/release-tool.swift manifest <zip> <phiên bản> <url tải> [file ghi chú]
    """)
}
