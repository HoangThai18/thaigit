import Foundation

/// Danh sách file thay đổi dạng cây thư mục (nút Path / Tree như GitKraken): dựng thành các hàng phẳng có độ sâu để vẽ trong
/// một List. Thư mục chỉ có đúng một thư mục con (và không có file) được gộp thành một hàng "src/app/views".
public enum FileTreeRow: Sendable, Equatable, Identifiable {
    /// `path`: đường dẫn đầy đủ của thư mục (khoá gập / mở), `name`: phần hiển thị (có thể gộp nhiều cấp), `count`: số file bên trong.
    case folder(path: String, name: String, depth: Int, count: Int)
    case file(FileChange, depth: Int)

    public var id: String {
        switch self {
        case .folder(let path, _, _, _): return "dir:" + path
        case .file(let change, _): return change.path
        }
    }

    public var depth: Int {
        switch self {
        case .folder(_, _, let depth, _), .file(_, let depth): return depth
        }
    }
}

public enum FileTree {
    private final class Node {
        var folders: [String: Node] = [:]
        var files: [FileChange] = []
        var count = 0
    }

    /// Hàng của cây; thư mục có `path` trong `collapsed` thì ẩn phần bên trong. Thư mục trước file, mỗi nhóm xếp theo tên.
    public static func rows(_ changes: [FileChange], collapsed: Set<String> = []) -> [FileTreeRow] {
        let root = Node()
        for change in changes {
            var node = root
            node.count += 1
            let parts = change.path.split(separator: "/").map(String.init)
            for part in parts.dropLast() {
                let next = node.folders[part] ?? Node()
                node.folders[part] = next
                node = next
                node.count += 1
            }
            node.files.append(change)
        }
        var result: [FileTreeRow] = []
        append(root, prefix: "", depth: 0, collapsed: collapsed, into: &result)
        return result
    }

    private static func append(_ node: Node, prefix: String, depth: Int, collapsed: Set<String>, into result: inout [FileTreeRow]) {
        for name in node.folders.keys.sorted(by: { $0.localizedStandardCompare($1) == .orderedAscending }) {
            var folder = node.folders[name]!
            var display = name
            var path = prefix + name
            // Gộp chuỗi thư mục chỉ có một thư mục con: "src" → "src/app" → "src/app/views".
            while folder.files.isEmpty, folder.folders.count == 1, let (childName, child) = folder.folders.first {
                display += "/" + childName
                path += "/" + childName
                folder = child
            }
            result.append(.folder(path: path, name: display, depth: depth, count: folder.count))
            if !collapsed.contains(path) {
                append(folder, prefix: path + "/", depth: depth + 1, collapsed: collapsed, into: &result)
            }
        }
        for file in node.files.sorted(by: { $0.fileName.localizedStandardCompare($1.fileName) == .orderedAscending }) {
            result.append(.file(file, depth: depth))
        }
    }
}
