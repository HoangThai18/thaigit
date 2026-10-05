import AppKit
import SwiftUI

/// Brand colours taken from the Thaigit logo: the blue trunk, the orange-red branch (git's colour), and a silver–ice glass background.
enum Brand {
    static let blue = Color(nsColor: .brandBlue)
    static let orange = Color(nsColor: .brandOrange)
}

extension NSColor {
    static let brandBlue = NSColor(hex: 0x2F86E8)
    static let brandOrange = NSColor(hex: 0xF05032)
}

extension View {
    /// A glass surface: Liquid Glass on macOS 26, a blurred material on older versions.
    @ViewBuilder
    func glassSurface<S: Shape>(in shape: S, tint: Color? = nil, interactive: Bool = false) -> some View {
        if #available(macOS 26, *) {
            self.glassEffect(Glass.regular.tint(tint).interactive(interactive), in: shape)
        } else {
            self.background(.regularMaterial, in: shape)
                .background(tint.map { shape.fill($0.opacity(0.12)) })
        }
    }

    /// A glass button (the primary button uses the "prominent" style tinted with `tint`).
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

/// Window background: a very light silver–ice gradient like the logo's background (dark theme: night blue), so the glass layers above it have depth.
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

/// A button on a repo's toolbar (like GitKraken): light background, thin border, darker on hover / press; dimmed when disabled.
/// The colour lives on the icon (`ToolLabel`) so each action is recognisable.
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

/// The shared button background of the toolbar (also used for menus like Pull ▾).
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

/// A toolbar button's label: an icon with its own colour + plain text.
struct ToolLabel: View {
    let title: Text
    let systemImage: String
    let color: Color

    /// Text hardcoded in code: translated (Localizable.strings).
    init(_ title: LocalizedStringKey, systemImage: String, color: Color) {
        self.title = Text(title)
        self.systemImage = systemImage
        self.color = color
    }

    /// Already-composed text (branch names, "Pull ↓3"…): shown verbatim.
    init(verbatim title: String, systemImage: String, color: Color) {
        self.title = Text(verbatim: title)
        self.systemImage = systemImage
        self.color = color
    }

    var body: some View {
        Label {
            title.foregroundStyle(.primary)
        } icon: {
            // An already-tinted image (not a template): menu labels (Pull ▾, the branch button) keep their colour instead of being greyed out.
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

/// The icon colour of each toolbar action.
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
