import AppKit
import SwiftUI

/// Màu thương hiệu lấy từ logo Thaigit: thân xanh, nhánh cam đỏ (màu của git), nền kính bạc–băng.
enum Brand {
    static let blue = Color(nsColor: .brandBlue)
    static let orange = Color(nsColor: .brandOrange)
}

extension NSColor {
    static let brandBlue = NSColor(hex: 0x2F86E8)
    static let brandOrange = NSColor(hex: 0xF05032)
}

extension View {
    /// Bề mặt kính: Liquid Glass trên macOS 26, vật liệu mờ trên bản cũ hơn.
    @ViewBuilder
    func glassSurface<S: Shape>(in shape: S, tint: Color? = nil, interactive: Bool = false) -> some View {
        if #available(macOS 26, *) {
            self.glassEffect(Glass.regular.tint(tint).interactive(interactive), in: shape)
        } else {
            self.background(.regularMaterial, in: shape)
                .background(tint.map { shape.fill($0.opacity(0.12)) })
        }
    }

    /// Nút kính (nút chính dùng bản "prominent" nhuộm màu theo `tint`).
    @ViewBuilder
    func glassButtonStyle(prominent: Bool = false) -> some View {
        if #available(macOS 26, *) {
            if prominent {
                self.buttonStyle(.glassProminent)
            } else {
                self.buttonStyle(.glass)
            }
        } else if prominent {
            self.buttonStyle(.borderedProminent)
        } else {
            self.buttonStyle(.bordered)
        }
    }
}

/// Nền cửa sổ: dải bạc–băng rất nhẹ như nền logo (giao diện tối: xanh đêm), để các lớp kính phía trên có chiều sâu.
struct BrandBackground: View {
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let colors: [Color] = colorScheme == .dark
            ? [Color(nsColor: NSColor(hex: 0x10141F)), Color(nsColor: NSColor(hex: 0x161C2C)), Color(nsColor: NSColor(hex: 0x1B1A26))]
            : [Color(nsColor: NSColor(hex: 0xF4F7FB)), Color(nsColor: NSColor(hex: 0xE9EFF6)), Color(nsColor: NSColor(hex: 0xEEF0F6))]
        LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing)
            .ignoresSafeArea()
    }
}
