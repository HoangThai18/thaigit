import Foundation

/// File có dấu xung đột (<<<<<<< ======= >>>>>>>), tách thành các đoạn chung và đoạn xung đột.
///
/// Làm việc theo byte: tách dòng theo "\n" ("\r" đứng trước thuộc ký tự xuống dòng của dòng đó, nên file lẫn CRLF/LF
/// vẫn nhận đúng dấu), BOM UTF-8 tách riêng (dấu ở dòng đầu vẫn được nhận). Khi lưu chỉ thay vùng byte của các khối
/// xung đột; mọi byte khác (BOM, kiểu xuống dòng của từng dòng) chép nguyên văn.
public struct ConflictFile: Sendable, Equatable {
    public struct Block: Sendable, Hashable, Identifiable {
        public let id: Int
        public let oursLabel: String
        public let theirsLabel: String
        public let baseLabel: String?
        /// Các dòng để hiển thị (không gồm ký tự xuống dòng).
        public let ours: [String]
        public let base: [String]?
        public let theirs: [String]
        /// Từ đầu dòng <<<<<<< đến hết dòng >>>>>>> (gồm xuống dòng): vùng duy nhất bị thay khi lưu.
        let region: Range<Int>
        /// Byte nguyên văn của từng phía (gồm ký tự xuống dòng của từng dòng).
        let oursBytes: Range<Int>
        let baseBytes: Range<Int>?
        let theirsBytes: Range<Int>
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

    /// Kết quả đọc file xung đột từ byte trên đĩa.
    public enum ParseResult: Sendable, Equatable {
        case parsed(ConflictFile)
        /// Không phải UTF-8 hợp lệ (Latin-1, CP1258, UTF-16…): không giải trong app — ghi lại sau khi giải mã sẽ làm
        /// hỏng mọi ký tự không phải ASCII. `conflictCount` đếm dấu theo byte (dấu là ASCII) để biết còn xung đột không.
        case notUTF8(conflictCount: Int)
    }

    /// Nội dung gốc — nguồn để ghép lại khi lưu.
    public let bytes: [UInt8]
    public let hasBOM: Bool
    public let segments: [Segment]
    /// "\r\n" nếu file có dòng CRLF, ngược lại "\n" (chỉ để tham khảo: khi lưu mỗi dòng giữ kiểu xuống dòng riêng).
    public let lineEnding: String
    public let endsWithNewline: Bool

    public var blocks: [Block] {
        segments.compactMap { segment in
            if case .conflict(let block) = segment { return block }
            return nil
        }
    }

    public var conflictCount: Int { blocks.count }

    /// Đọc byte của file trên đĩa. File không phải UTF-8 hợp lệ → `.notUTF8`, không bao giờ trả nội dung đã giải mã lỏng.
    public static func parse(_ data: Data) -> ParseResult {
        let file = parse(bytes: [UInt8](data))
        return UTF8Text.isValid(file.bytes) ? .parsed(file) : .notUTF8(conflictCount: file.conflictCount)
    }

    public static func parse(_ text: String) -> ConflictFile {
        parse(bytes: Array(text.utf8))
    }

    private static let bom: [UInt8] = [0xEF, 0xBB, 0xBF]

    /// Một dòng: [start, contentEnd) là nội dung (không gồm "\n" / "\r\n"), [start, end) gồm cả xuống dòng.
    private struct LineSpan {
        let start: Int
        let contentEnd: Int
        let end: Int
    }

    private static func parse(bytes: [UInt8]) -> ConflictFile {
        let hasBOM = bytes.starts(with: bom)
        var spans: [LineSpan] = []
        var position = hasBOM ? bom.count : 0
        while position < bytes.count {
            guard let lineFeed = bytes[position...].firstIndex(of: UInt8(ascii: "\n")) else {
                spans.append(LineSpan(start: position, contentEnd: bytes.count, end: bytes.count))
                break
            }
            let contentEnd = lineFeed > position && bytes[lineFeed - 1] == UInt8(ascii: "\r") ? lineFeed - 1 : lineFeed
            spans.append(LineSpan(start: position, contentEnd: contentEnd, end: lineFeed + 1))
            position = lineFeed + 1
        }

        /// Đúng 7 ký tự `char`, rồi hết dòng hoặc một dấu cách + nhãn. Trả nhãn, hoặc nil nếu không phải dấu.
        func marker(_ span: LineSpan, _ char: Character) -> String? {
            let code = char.asciiValue!
            guard span.contentEnd - span.start >= 7, bytes[span.start..<span.start + 7].allSatisfy({ $0 == code }) else { return nil }
            if span.contentEnd == span.start + 7 { return "" }
            guard bytes[span.start + 7] == UInt8(ascii: " ") else { return nil }
            return String(decoding: bytes[(span.start + 8)..<span.contentEnd], as: UTF8.self)
        }
        func texts(_ lines: Range<Int>) -> [String] {
            lines.map { String(decoding: bytes[spans[$0].start..<spans[$0].contentEnd], as: UTF8.self) }
        }
        /// Mốc byte đầu dòng `index`; `index` = số dòng thì là cuối file.
        func offset(_ index: Int) -> Int {
            index < spans.count ? spans[index].start : bytes.count
        }

        var segments: [Segment] = []
        var commonFrom = 0
        var index = 0
        var blockID = 0
        while index < spans.count {
            guard let oursLabel = marker(spans[index], "<") else {
                index += 1
                continue
            }
            // Tìm cấu trúc block hoàn chỉnh; nếu không đủ thì coi như văn bản thường.
            var stage = 0 // 0: ours, 1: base, 2: theirs
            var baseMarker: Int?
            var baseLabel: String?
            var separator: Int?
            var theirsLabel: String?
            var closing: Int?
            var cursor = index + 1
            while cursor < spans.count {
                let current = spans[cursor]
                if stage == 0, let label = marker(current, "|") {
                    stage = 1
                    baseMarker = cursor
                    baseLabel = label
                } else if stage < 2, marker(current, "=") == "" {
                    stage = 2
                    separator = cursor
                } else if stage == 2, let label = marker(current, ">") {
                    theirsLabel = label
                    closing = cursor
                    break
                } else if marker(current, "<") != nil {
                    break
                }
                cursor += 1
            }
            guard let closing, let separator, let theirsLabel else {
                index += 1
                continue
            }
            if commonFrom < index { segments.append(.common(texts(commonFrom..<index))) }
            let oursEnd = baseMarker ?? separator
            let block = Block(
                id: blockID,
                oursLabel: oursLabel, theirsLabel: theirsLabel, baseLabel: baseLabel,
                ours: texts((index + 1)..<oursEnd),
                base: baseMarker.map { texts(($0 + 1)..<separator) },
                theirs: texts((separator + 1)..<closing),
                region: spans[index].start..<spans[closing].end,
                oursBytes: offset(index + 1)..<offset(oursEnd),
                baseBytes: baseMarker.map { offset($0 + 1)..<offset(separator) },
                theirsBytes: offset(separator + 1)..<offset(closing)
            )
            segments.append(.conflict(block))
            blockID += 1
            index = closing + 1
            commonFrom = index
        }
        if commonFrom < spans.count { segments.append(.common(texts(commonFrom..<spans.count))) }

        let hasCRLF = zip(bytes, bytes.dropFirst()).contains { $0 == UInt8(ascii: "\r") && $1 == UInt8(ascii: "\n") }
        return ConflictFile(bytes: bytes, hasBOM: hasBOM, segments: segments, lineEnding: hasCRLF ? "\r\n" : "\n",
                            endsWithNewline: bytes.last == UInt8(ascii: "\n"))
    }

    /// Ghép lại nội dung file (byte) theo lựa chọn cho từng block. Trả về nil nếu còn block chưa chọn.
    /// Nếu dòng >>>>>>> là dòng cuối file và không có xuống dòng thì kết quả cũng không có xuống dòng cuối.
    public func resolvedData(with choices: [Int: Resolution]) -> Data? {
        var output = Data()
        var cursor = 0
        for block in blocks {
            guard let choice = choices[block.id] else { return nil }
            output.append(contentsOf: bytes[cursor..<block.region.lowerBound])
            let ranges: [Range<Int>]
            switch choice {
            case .ours: ranges = [block.oursBytes]
            case .theirs: ranges = [block.theirsBytes]
            case .oursThenTheirs: ranges = [block.oursBytes, block.theirsBytes]
            case .theirsThenOurs: ranges = [block.theirsBytes, block.oursBytes]
            case .base: ranges = block.baseBytes.map { [$0] } ?? []
            case .neither: ranges = []
            }
            let parts = ranges.filter { !$0.isEmpty }
            let unterminatedTail = block.region.upperBound == bytes.count && !endsWithNewline
            for (position, range) in parts.enumerated() {
                let strip = unterminatedTail && position == parts.count - 1 ? terminatorLength(range) : 0
                output.append(contentsOf: bytes[range.lowerBound..<(range.upperBound - strip)])
            }
            cursor = block.region.upperBound
        }
        output.append(contentsOf: bytes[cursor...])
        return output
    }

    /// Như `resolvedData(with:)` nhưng dạng chuỗi (file đã là UTF-8 hợp lệ nên không mất byte nào).
    public func resolved(with choices: [Int: Resolution]) -> String? {
        resolvedData(with: choices).map { String(decoding: $0, as: UTF8.self) }
    }

    /// Độ dài ký tự xuống dòng ở cuối `range` ("\n" = 1, "\r\n" = 2, không có = 0).
    private func terminatorLength(_ range: Range<Int>) -> Int {
        guard !range.isEmpty, bytes[range.upperBound - 1] == UInt8(ascii: "\n") else { return 0 }
        return range.count >= 2 && bytes[range.upperBound - 2] == UInt8(ascii: "\r") ? 2 : 1
    }
}
