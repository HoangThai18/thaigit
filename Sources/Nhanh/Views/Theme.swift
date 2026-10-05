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

/// Nút trên hàng công cụ của repo (như GitKraken): nền sáng, viền mảnh, đậm lên khi rê chuột / bấm; tắt thì mờ đi.
/// Màu nằm ở biểu tượng (`ToolLabel`) để mỗi thao tác dễ nhận ra.
struct ToolbarButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        ToolbarButtonBody(label: configuration.label, isPressed: configuration.isPressed)
    }
}

private struct ToolbarButtonBody<Label: View>: View {
    let label: Label
    let isPressed: Bool
    @Environment(\.isEnabled) private var isEnabled
    @State private var hovering = false

    var body: some View {
        label
            .font(.system(size: 13, weight: .medium))
            .padding(.horizontal, 10)
            .frame(minHeight: 28)
            .background(ToolbarChrome(hovering: hovering && isEnabled, pressed: isPressed))
            .contentShape(Rectangle())
            .opacity(isEnabled ? 1 : 0.4)
            .onHover { hovering = $0 }
    }
}

/// Nền chung của nút hàng công cụ (dùng cả cho Menu như Pull ▾).
struct ToolbarChrome: View {
    var hovering = false
    var pressed = false

    var body: some View {
        RoundedRectangle(cornerRadius: 8, style: .continuous)
            .fill(Color.primary.opacity(pressed ? 0.14 : hovering ? 0.09 : 0.045))
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .strokeBorder(Color.primary.opacity(0.11), lineWidth: 1)
            )
    }
}

/// Nhãn nút hàng công cụ: biểu tượng có màu riêng + chữ thường.
struct ToolLabel: View {
    let title: Text
    let systemImage: String
    let color: Color

    /// Chữ cố định trong code: được dịch (Localizable.strings).
    init(_ title: LocalizedStringKey, systemImage: String, color: Color) {
        self.title = Text(title)
        self.systemImage = systemImage
        self.color = color
    }

    /// Chữ đã dựng sẵn (tên nhánh, "Pull ↓3"…): hiện nguyên văn.
    init(verbatim title: String, systemImage: String, color: Color) {
        self.title = Text(verbatim: title)
        self.systemImage = systemImage
        self.color = color
    }

    var body: some View {
        Label {
            title.foregroundStyle(.primary)
        } icon: {
            // Ảnh đã tô sẵn (không phải template): nhãn của Menu (Pull ▾, nút nhánh) cũng giữ được màu thay vì bị tô xám.
            Image(nsImage: Self.tinted(systemImage, color: NSColor(color)))
        }
    }

    static func tinted(_ name: String, color: NSColor) -> NSImage {
        let configuration = NSImage.SymbolConfiguration(pointSize: 13, weight: .semibold)
            .applying(NSImage.SymbolConfiguration(paletteColors: [color]))
        let image = NSImage(systemSymbolName: name, accessibilityDescription: nil)?.withSymbolConfiguration(configuration) ?? NSImage()
        image.isTemplate = false
        return image
    }
}

/// Màu biểu tượng của từng thao tác trên hàng công cụ.
enum ToolColor {
    static let undo = Color(nsColor: .systemGray)
    static let fetch = Color(nsColor: .systemBlue)
    static let pull = Color(nsColor: .systemTeal)
    static let push = Color(nsColor: .systemGreen)
    static let branch = Color(nsColor: .systemPurple)
    static let stash = Color(nsColor: .systemOrange)
    static let pop = Color(nsColor: .systemOrange)
    static let request = Color(nsColor: .systemPink)
    static let neutral = Color(nsColor: .secondaryLabelColor)
}
