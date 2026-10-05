import Foundation

/// Strict UTF-8 decoding for the places whose content may be written back (patches, conflict files).
///
/// `String(decoding:as:)` decodes leniently: invalid bytes (a Latin-1 file, CP1258…) turn into U+FFFD, and
/// writing that back produces EF BF BD. Foundation's `String(data:encoding: .utf8)` is strict but loses
/// the BOM. So decode leniently and then re-encode to compare byte by byte: the two agree only when the
/// input was valid UTF-8 (a BOM stays a U+FEFF).
enum UTF8Text {
    static func isValid(_ bytes: UnsafeBufferPointer<UInt8>) -> Bool {
        guard let base = bytes.baseAddress, !bytes.isEmpty else { return true }
        var decoded = String(decoding: bytes, as: UTF8.self)
        return decoded.withUTF8 { utf8 in
            utf8.count == bytes.count && memcmp(utf8.baseAddress!, base, bytes.count) == 0
        }
    }

    static func isValid(_ bytes: [UInt8]) -> Bool {
        bytes.withUnsafeBufferPointer { isValid($0) }
    }

    /// The string matching `data` byte for byte, or nil when it isn't valid UTF-8.
    static func decodeStrict(_ data: Data) -> String? {
        let text = String(decoding: data, as: UTF8.self)
        return text.utf8.elementsEqual(data) ? text : nil
    }
}

extension String {
    /// Prefix comparison by UTF-8 byte, not by Character: a space plus a combining mark is ONE Character, so `hasPrefix(" ")` would be wrong.
    func hasBytePrefix(_ prefix: String) -> Bool {
        utf8.starts(with: prefix.utf8)
    }

    /// Everything after the first `count` bytes (used after `hasBytePrefix` with an ASCII prefix).
    func droppingBytes(_ count: Int) -> String {
        String(decoding: utf8.dropFirst(count), as: UTF8.self)
    }
}
