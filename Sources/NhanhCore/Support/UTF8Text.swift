import Foundation

/// Giải mã UTF-8 CHẶT cho những chỗ có thể ghi ngược nội dung (patch, file xung đột).
///
/// `String(decoding:as:)` là giải mã lỏng: byte không hợp lệ (file Latin-1, CP1258…) thành U+FFFD, ghi lại sẽ thành
/// EF BF BD. `String(data:encoding: .utf8)` của Foundation thì chặt nhưng bỏ mất BOM. Nên ở đây giải mã lỏng rồi so
/// lại từng byte: hai bên chỉ trùng nhau khi đầu vào là UTF-8 hợp lệ (BOM giữ nguyên thành U+FEFF).
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

    /// Chuỗi đúng từng byte của `data`, hoặc nil nếu không phải UTF-8 hợp lệ.
    static func decodeStrict(_ data: Data) -> String? {
        let text = String(decoding: data, as: UTF8.self)
        return text.utf8.elementsEqual(data) ? text : nil
    }
}

extension String {
    /// So tiền tố theo byte UTF-8, không theo Character: " " + dấu kết hợp là MỘT Character nên `hasPrefix(" ")` sai.
    func hasBytePrefix(_ prefix: String) -> Bool {
        utf8.starts(with: prefix.utf8)
    }

    /// Phần sau `count` byte đầu (dùng sau `hasBytePrefix` với tiền tố ASCII).
    func droppingBytes(_ count: Int) -> String {
        String(decoding: utf8.dropFirst(count), as: UTF8.self)
    }
}
