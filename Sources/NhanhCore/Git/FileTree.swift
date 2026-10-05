import Foundation

/// Changed files as a directory tree (the Path / Tree switch like GitKraken): built into flat rows carrying a depth to draw in
/// a List. A folder with exactly one subfolder and no files is merged into a single "src/app/views" row.
public enum FileTreeRow: Sendable, Equatable, Identifiable {
    /// `path`: the folder's full path (the collapse / expand key), `name`: the display part (may merge several levels), `count`: how many files are inside.
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

    /// A tree row; a folder whose `path` is in `collapsed` hides its contents. Folders before files, each group sorted by name.
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
            // Merge runs of folders that have a single subfolder: "src" → "src/app" → "src/app/views".
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
