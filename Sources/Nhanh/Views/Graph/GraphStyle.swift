import AppKit
import NhanhCore

/// The graph's metrics and colour palette.
enum GraphStyle {
    static let rowHeight: CGFloat = 30
    static let laneWidth: CGFloat = 20
    static let leftPadding: CGFloat = 8
    static let lineWidth: CGFloat = 2
    /// The node is large enough for the avatar to read clearly (row height 30).
    static let nodeRadius: CGFloat = 10.5
    static let mergeNodeRadius: CGFloat = 5

    /// Lane colours (saturated enough to stay readable on both light and dark backgrounds). The first two lanes are the logo colours:
    /// the blue trunk and git's orange-red branch.
    static let palette: [NSColor] = [
        .brandBlue,             // the logo's blue trunk
        .brandOrange,           // git's orange-red
        NSColor(hex: 0x8B5CF6), // violet
        NSColor(hex: 0x18A957), // green
        NSColor(hex: 0xE5487D), // pink
        NSColor(hex: 0x0EAFC4), // teal
        NSColor(hex: 0xF5A524), // amber
        NSColor(hex: 0x5B6CF0), // indigo
        NSColor(hex: 0xC14FD8), // magenta
        NSColor(hex: 0x7DB51F), // lime
        NSColor(hex: 0xFF7A59), // coral
        NSColor(hex: 0x14A38B), // jade
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

    /// Initials from a name ("Phan Thái" → "PT").
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
