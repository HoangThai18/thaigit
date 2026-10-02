import Foundation

/// File văn bản trong working tree mở để sửa ngay trong app. Giữ nguyên từng byte ngoài phần người dùng sửa:
/// BOM UTF-8 và kiểu xuống dòng (CRLF / LF) được trả lại khi lưu. Chỉ nhận UTF-8 hợp lệ, một kiểu xuống dòng,
/// file thường nằm trong repo (không theo symlink ra ngoài).
public struct EditableTextFile: Sendable, Equatable {
    public enum Problem: LocalizedError, Equatable, Sendable {
        case notFound
        case notRegularFile
        case symlink
        case outsideRepository
        case tooLarge(Int)
        case binary
        case notUTF8
        case mixedLineEndings
        /// File đã bị sửa ở nơi khác sau khi mở.
        case changedOnDisk

        public var errorDescription: String? {
            switch self {
            case .notFound: return "File không còn trong thư mục làm việc."
            case .notRegularFile: return "Không phải file thường."
            case .symlink: return "File là symlink — sửa file gốc mà nó trỏ tới."
            case .outsideRepository: return "File nằm ngoài repository."
            case .tooLarge(let bytes):
                return "File lớn (\(ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file))) — mở bằng trình soạn thảo."
            case .binary: return "File nhị phân — không sửa được trong app."
            case .notUTF8: return "File không phải UTF-8 — mở bằng trình soạn thảo để giữ đúng bảng mã."
            case .mixedLineEndings: return "File lẫn lộn kiểu xuống dòng (CRLF và LF) — mở bằng trình soạn thảo để không đổi các dòng khác."
            case .changedOnDisk: return "File vừa bị sửa ở nơi khác sau khi bạn mở."
            }
        }
    }

    public static let maxBytes = 2 * 1024 * 1024
    private static let bom = Data([0xEF, 0xBB, 0xBF])

    /// Đường dẫn tương đối trong repo.
    public let path: String
    public let url: URL
    /// Byte của file lúc mở (hoặc lúc lưu gần nhất) — để biết file có bị sửa ở nơi khác không.
    public let original: Data
    /// Nội dung để sửa: đã bỏ BOM, xuống dòng luôn là "\n".
    public let text: String
    public let hasBOM: Bool
    public let usesCRLF: Bool

    /// Mở `path` (đường dẫn tương đối trong repo `root`).
    public static func open(path: String, in root: URL) throws -> EditableTextFile {
        let url = try checkedURL(path: path, in: root)
        let data = try Data(contentsOf: url)
        return try EditableTextFile(path: path, url: url, data: data)
    }

    init(path: String, url: URL, data: Data) throws {
        guard data.count <= Self.maxBytes else { throw Problem.tooLarge(data.count) }
        guard !data.contains(0) else { throw Problem.binary }
        hasBOM = data.starts(with: Self.bom)
        let body = hasBOM ? data.dropFirst(Self.bom.count) : data[...]
        guard let decoded = String(data: Data(body), encoding: .utf8) else { throw Problem.notUTF8 }
        var crlf = 0, lf = 0, cr = 0
        var previous: UInt8 = 0
        for byte in body {
            if byte == 0x0A {
                if previous == 0x0D { crlf += 1 } else { lf += 1 }
            } else if previous == 0x0D {
                cr += 1
            }
            previous = byte
        }
        if previous == 0x0D { cr += 1 }
        guard cr == 0, crlf == 0 || lf == 0 else { throw Problem.mixedLineEndings }
        usesCRLF = crlf > 0
        text = usesCRLF ? decoded.replacingOccurrences(of: "\r\n", with: "\n") : decoded
        self.path = path
        self.url = url
        original = data
    }

    /// Byte sẽ ghi cho nội dung đã sửa (trả lại BOM và CRLF như file gốc).
    public func data(for edited: String) -> Data {
        var text = edited.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        if usesCRLF { text = text.replacingOccurrences(of: "\n", with: "\r\n") }
        return (hasBOM ? Self.bom : Data()) + Data(text.utf8)
    }

    /// Lưu nội dung đã sửa. File bị sửa ở nơi khác thì ném `changedOnDisk` (trừ khi `overwrite`). Ghi ra file tạm cạnh
    /// file gốc rồi thay thế (không để file dở dang nếu lỗi giữa chừng), giữ quyền (vd. +x) của file gốc.
    public func save(_ edited: String, in root: URL, overwrite: Bool = false) throws -> EditableTextFile {
        let target = try Self.checkedURL(path: path, in: root)
        let current = try Data(contentsOf: target)
        if current != original, !overwrite { throw Problem.changedOnDisk }
        let data = data(for: edited)
        let fileManager = FileManager.default
        let permissions = (try? fileManager.attributesOfItem(atPath: target.path))?[.posixPermissions]
        let temp = target.deletingLastPathComponent().appendingPathComponent(".\(target.lastPathComponent).thaigit-\(UUID().uuidString)")
        do {
            try data.write(to: temp)
            if let permissions { try fileManager.setAttributes([.posixPermissions: permissions], ofItemAtPath: temp.path) }
            _ = try fileManager.replaceItemAt(target, withItemAt: temp)
        } catch {
            try? fileManager.removeItem(at: temp)
            throw error
        }
        return try EditableTextFile(path: path, url: target, data: data)
    }

    /// Đường dẫn an toàn để đọc / ghi: file thường (không phải symlink) nằm trong repo kể cả sau khi giải symlink của
    /// các thư mục cha.
    static func checkedURL(path: String, in root: URL) throws -> URL {
        let rootURL = root.standardizedFileURL
        let url = rootURL.appendingPathComponent(path).standardizedFileURL
        let resolvedRoot = rootURL.resolvingSymlinksInPath().path
        guard url.path.hasPrefix(rootURL.path + "/"),
              url.deletingLastPathComponent().resolvingSymlinksInPath().path.appending("/").hasPrefix(resolvedRoot + "/")
        else { throw Problem.outsideRepository }
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: url.path) else { throw Problem.notFound }
        switch attributes[.type] as? FileAttributeType {
        case .typeSymbolicLink?: throw Problem.symlink
        case .typeRegular?: return url
        default: throw Problem.notRegularFile
        }
    }
}
