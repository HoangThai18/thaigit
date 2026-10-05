import Foundation

/// A text file in the working tree opened for editing right inside the app. Every byte outside the part the
/// user edited is preserved: a UTF-8 BOM and the line ending style (CRLF / LF) are restored on save. Only
/// valid UTF-8 with a single line ending style is accepted, and the file must be an ordinary file inside
/// the repo (no symlink pointing out).
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
        /// The file changed elsewhere after it was opened.
        case changedOnDisk

        public var errorDescription: String? {
            switch self {
            case .notFound: return String(localized: "File không còn trong thư mục làm việc.")
            case .notRegularFile: return String(localized: "Không phải file thường.")
            case .symlink: return String(localized: "File là symlink — sửa file gốc mà nó trỏ tới.")
            case .outsideRepository: return String(localized: "File nằm ngoài repository.")
            case .tooLarge(let bytes):
                return String(localized: "File lớn (\(ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file))) — mở bằng trình soạn thảo.")
            case .binary: return String(localized: "File nhị phân — không sửa được trong app.")
            case .notUTF8: return String(localized: "File không phải UTF-8 — mở bằng trình soạn thảo để giữ đúng bảng mã.")
            case .mixedLineEndings: return String(localized: "File lẫn lộn kiểu xuống dòng (CRLF và LF) — mở bằng trình soạn thảo để không đổi các dòng khác.")
            case .changedOnDisk: return String(localized: "File vừa bị sửa ở nơi khác sau khi bạn mở.")
            }
        }
    }

    public static let maxBytes = 2 * 1024 * 1024
    private static let bom = Data([0xEF, 0xBB, 0xBF])

    /// Path relative to the repo.
    public let path: String
    public let url: URL
    /// The file's bytes when it was opened (or at the last save) — to tell whether it changed elsewhere.
    public let original: Data
    /// The content to edit: BOM removed, line endings always "\n".
    public let text: String
    public let hasBOM: Bool
    public let usesCRLF: Bool

    /// Open `path` (a path relative to repo `root`).
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

    /// The bytes to write for the edited content (restoring the BOM and CRLF of the original file).
    public func data(for edited: String) -> Data {
        var text = edited.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        if usesCRLF { text = text.replacingOccurrences(of: "\n", with: "\r\n") }
        return (hasBOM ? Self.bom : Data()) + Data(text.utf8)
    }

    /// Save the edited content. Throws `changedOnDisk` when the file changed elsewhere (unless `overwrite`).
    /// Writes to a temp file next to the original and then replaces it (so a mid-way failure never leaves a
    /// half-written file), preserving the original's mode (e.g. +x).
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

    /// The safe path used for reading / writing: an ordinary file (not a symlink) inside the repo, checked
    /// even after resolving the parent directories' symlinks.
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
