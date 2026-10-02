import Foundation

/// File có dấu xung đột (<<<<<<< ======= >>>>>>>), tách thành các đoạn chung và đoạn xung đột.
public struct ConflictFile: Sendable, Equatable {
    public struct Block: Sendable, Hashable, Identifiable {
        public let id: Int
        public let oursLabel: String
        public let theirsLabel: String
        public let baseLabel: String?
        public let ours: [String]
        public let base: [String]?
        public let theirs: [String]
    }

    public enum Segment: Sendable, Hashable {
        case common([String])
        case conflict(Block)
    }

    public enum Resolution: String, Sendable, Hashable, CaseIterable {
        case ours
        case theirs
        case oursThenTheirs
        case theirsThenOurs
        case base
        case neither
    }

    public let segments: [Segment]
    public let lineEnding: String
    public let endsWithNewline: Bool

    public var blocks: [Block] {
        segments.compactMap { segment in
            if case .conflict(let block) = segment { return block }
            return nil
        }
    }

    public var conflictCount: Int { blocks.count }

    public static func parse(_ text: String) -> ConflictFile {
        let lineEnding = text.contains("\r\n") ? "\r\n" : "\n"
        var lines = text.components(separatedBy: lineEnding)
        let endsWithNewline = text.hasSuffix(lineEnding)
        if endsWithNewline, lines.last == "" { lines.removeLast() }

        var segments: [Segment] = []
        var common: [String] = []
        var index = 0
        var blockID = 0

        func marker(_ line: String, _ char: Character) -> String? {
            let prefix = String(repeating: char, count: 7)
            guard line.hasPrefix(prefix) else { return nil }
            let rest = line.dropFirst(7)
            if rest.isEmpty { return "" }
            guard rest.first == " " else { return nil }
            return String(rest.dropFirst())
        }

        while index < lines.count {
            let line = lines[index]
            guard let oursLabel = marker(line, "<") else {
                common.append(line)
                index += 1
                continue
            }
            // Tìm cấu trúc block hoàn chỉnh; nếu không đủ thì coi như văn bản thường.
            var ours: [String] = []
            var base: [String]?
            var baseLabel: String?
            var theirs: [String] = []
            var theirsLabel: String?
            var cursor = index + 1
            var stage = 0 // 0: ours, 1: base, 2: theirs
            var complete = false
            while cursor < lines.count {
                let current = lines[cursor]
                if stage == 0, let label = marker(current, "|") {
                    stage = 1
                    base = []
                    baseLabel = label
                } else if stage < 2, marker(current, "=") == "" {
                    stage = 2
                } else if stage == 2, let label = marker(current, ">") {
                    theirsLabel = label
                    complete = true
                    break
                } else if marker(current, "<") != nil {
                    break
                } else {
                    switch stage {
                    case 0: ours.append(current)
                    case 1: base?.append(current)
                    default: theirs.append(current)
                    }
                }
                cursor += 1
            }
            guard complete, let theirsLabel else {
                common.append(line)
                index += 1
                continue
            }
            if !common.isEmpty {
                segments.append(.common(common))
                common = []
            }
            segments.append(.conflict(Block(id: blockID, oursLabel: oursLabel, theirsLabel: theirsLabel,
                                            baseLabel: baseLabel, ours: ours, base: base, theirs: theirs)))
            blockID += 1
            index = cursor + 1
        }
        if !common.isEmpty { segments.append(.common(common)) }
        return ConflictFile(segments: segments, lineEnding: lineEnding, endsWithNewline: endsWithNewline)
    }

    /// Ghép lại nội dung file theo lựa chọn cho từng block. Trả về nil nếu còn block chưa chọn.
    public func resolved(with choices: [Int: Resolution]) -> String? {
        var output: [String] = []
        for segment in segments {
            switch segment {
            case .common(let lines):
                output.append(contentsOf: lines)
            case .conflict(let block):
                guard let choice = choices[block.id] else { return nil }
                switch choice {
                case .ours: output.append(contentsOf: block.ours)
                case .theirs: output.append(contentsOf: block.theirs)
                case .oursThenTheirs: output.append(contentsOf: block.ours + block.theirs)
                case .theirsThenOurs: output.append(contentsOf: block.theirs + block.ours)
                case .base: output.append(contentsOf: block.base ?? [])
                case .neither: break
                }
            }
        }
        var text = output.joined(separator: lineEnding)
        if endsWithNewline && !output.isEmpty { text += lineEnding }
        return text
    }
}
