import AppKit
import NhanhCore

/// Kích thước và bảng màu của graph.
enum GraphStyle {
    static let rowHeight: CGFloat = 30
    static let laneWidth: CGFloat = 20
    static let leftPadding: CGFloat = 8
    static let lineWidth: CGFloat = 2
    /// Node đủ lớn để nhìn rõ ảnh đại diện (dòng cao 30).
    static let nodeRadius: CGFloat = 10.5
    static let mergeNodeRadius: CGFloat = 5

    /// Màu làn (đủ tươi để đọc được trên nền sáng lẫn tối). Hai làn đầu là màu logo:
    /// thân xanh và nhánh cam đỏ của git.
    static let palette: [NSColor] = [
        .brandBlue,             // xanh thân logo
        .brandOrange,           // cam đỏ git
        NSColor(hex: 0x8B5CF6), // tím
        NSColor(hex: 0x18A957), // xanh lá
        NSColor(hex: 0xE5487D), // hồng
        NSColor(hex: 0x0EAFC4), // xanh ngọc
        NSColor(hex: 0xF5A524), // hổ phách
        NSColor(hex: 0x5B6CF0), // chàm
        NSColor(hex: 0xC14FD8), // tím hồng
        NSColor(hex: 0x7DB51F), // xanh nõn
        NSColor(hex: 0xFF7A59), // san hô
        NSColor(hex: 0x14A38B), // ngọc lục
    ]

    static let workingTreeColor = NSColor.secondaryLabelColor

    static func color(_ index: Int) -> NSColor {
        if index == GraphLayout.workingTreeColor { return workingTreeColor }
        return palette[((index % palette.count) + palette.count) % palette.count]
    }

    static func x(forLane lane: Int) -> CGFloat {
        leftPadding + CGFloat(lane) * laneWidth + laneWidth / 2
    }

    static func width(forLanes lanes: Int) -> CGFloat {
        leftPadding * 2 + CGFloat(max(lanes, 1)) * laneWidth
    }

    /// Chữ cái đầu của tên ("Phan Thái" → "PT").
    static func initials(_ name: String) -> String {
        let words = name.split(whereSeparator: { $0 == " " || $0 == "." || $0 == "-" || $0 == "_" }).filter { !$0.isEmpty }
        guard let first = words.first?.first else { return "?" }
        if words.count > 1, let last = words.last?.first {
            return String(first).uppercased() + String(last).uppercased()
        }
        let letters = words.first.map { String($0.prefix(2)) } ?? "?"
        return letters.uppercased()
    }
}

extension NSColor {
    convenience init(hex: UInt32, alpha: CGFloat = 1) {
        self.init(
            srgbRed: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: alpha
        )
    }
}
