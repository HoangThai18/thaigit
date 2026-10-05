import AppKit
import NhanhCore
import SwiftUI

/// The cell that draws the graph: the lane lines, the curves where a branch turns in or leaves, and the commit node (the author's avatar, or initials when there is none).
final class GraphCellView: NSTableCellView {
    var entry: GraphEntry? {
        didSet {
            needsDisplay = true
            // The Author / Date columns are hidden by default: hover the dot (avatar) to see who committed and when.
            if let commit = entry?.commit, !commit.isWorkingTree {
                toolTip = "\(commit.authorName) <\(commit.authorEmail)>\n\(VietnameseDate.absolute(commit.authorDate))"
            } else {
                toolTip = nil
            }
        }
    }
    var avatar: NSImage? { didSet { if avatar !== oldValue { needsDisplay = true } } }
    var isHead = false { didSet { needsDisplay = true } }
    var dimmed = false { didSet { needsDisplay = true } }

    override var isFlipped: Bool { true }

    override var backgroundStyle: NSView.BackgroundStyle {
        didSet { needsDisplay = true }
    }

    override func draw(_ dirtyRect: NSRect) {
        guard let entry, let context = NSGraphicsContext.current?.cgContext else { return }
        let height = bounds.height
        let mid = (height / 2).rounded()
        let row = entry.row
        let nodeX = GraphStyle.x(forLane: row.lane)
        let isWIP = entry.commit.isWorkingTree
        let alpha: CGFloat = dimmed ? 0.3 : 1

        context.saveGState()
        context.setLineWidth(GraphStyle.lineWidth)
        context.setLineCap(.round)
        context.setLineJoin(.round)

        // The connector from the branch label (left column) into the node.
        if !entry.labels.isEmpty {
            let color = GraphStyle.color(row.color).withAlphaComponent(0.55 * alpha)
            context.setStrokeColor(color.cgColor)
            context.setLineWidth(1.5)
            context.move(to: CGPoint(x: 0, y: mid))
            context.addLine(to: CGPoint(x: nodeX - GraphStyle.nodeRadius, y: mid))
            context.strokePath()
            context.setLineWidth(GraphStyle.lineWidth)
        }

        for line in row.lines {
            let color = GraphStyle.color(line.color).withAlphaComponent(alpha)
            context.setStrokeColor(color.cgColor)
            if line.color == GraphLayout.workingTreeColor {
                context.setLineDash(phase: 0, lengths: [3, 3])
            } else {
                context.setLineDash(phase: 0, lengths: [])
            }
            let laneX = GraphStyle.x(forLane: line.lane)
            let path = CGMutablePath()
            switch line.kind {
            case .pass:
                path.move(to: CGPoint(x: laneX, y: 0))
                path.addLine(to: CGPoint(x: laneX, y: height))
            case .toNode:
                if line.lane == row.lane {
                    path.move(to: CGPoint(x: laneX, y: 0))
                    path.addLine(to: CGPoint(x: laneX, y: mid))
                } else {
                    // Straight down inside the lane, then a rounded corner turning horizontally into the node.
                    let radius = min(mid, abs(nodeX - laneX))
                    let direction: CGFloat = nodeX > laneX ? 1 : -1
                    path.move(to: CGPoint(x: laneX, y: 0))
                    path.addLine(to: CGPoint(x: laneX, y: mid - radius))
                    path.addQuadCurve(to: CGPoint(x: laneX + direction * radius, y: mid), control: CGPoint(x: laneX, y: mid))
                    path.addLine(to: CGPoint(x: nodeX, y: mid))
                }
            case .fromNode:
                if line.lane == row.lane {
                    path.move(to: CGPoint(x: laneX, y: mid))
                    path.addLine(to: CGPoint(x: laneX, y: height))
                } else {
                    // Horizontally away from the node, then a rounded corner turning down into the parent lane.
                    let radius = min(height - mid, abs(laneX - nodeX))
                    let direction: CGFloat = laneX > nodeX ? 1 : -1
                    path.move(to: CGPoint(x: nodeX, y: mid))
                    path.addLine(to: CGPoint(x: laneX - direction * radius, y: mid))
                    path.addQuadCurve(to: CGPoint(x: laneX, y: mid + radius), control: CGPoint(x: laneX, y: mid))
                    path.addLine(to: CGPoint(x: laneX, y: height))
                }
            }
            // Lens-like lane: a wide soft glow underneath the main stroke.
            if line.color != GraphLayout.workingTreeColor {
                context.addPath(path)
                context.setStrokeColor(color.withAlphaComponent(0.16 * alpha).cgColor)
                context.setLineWidth(GraphStyle.lineWidth + 3)
                context.strokePath()
                context.setStrokeColor(color.cgColor)
                context.setLineWidth(GraphStyle.lineWidth)
            }
            context.addPath(path)
            context.strokePath()
        }
        context.setLineDash(phase: 0, lengths: [])

        let baseColor = GraphStyle.color(row.color)
        let center = CGPoint(x: nodeX, y: mid)
        if isWIP {
            let radius = GraphStyle.nodeRadius - 1
            let rect = CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2)
            context.setFillColor(NSColor.windowBackgroundColor.cgColor)
            context.fillEllipse(in: rect)
            context.setStrokeColor(NSColor.secondaryLabelColor.cgColor)
            context.setLineWidth(1.6)
            context.setLineDash(phase: 0, lengths: [2.5, 2])
            context.strokeEllipse(in: rect)
            context.setLineDash(phase: 0, lengths: [])
            // With an avatar the face already says "your work", and the dashed ring says "not committed".
            if let avatar {
                drawAvatar(avatar, in: rect.insetBy(dx: 2, dy: 2), ring: .clear, alpha: alpha, context: context)
            } else {
                drawSymbol("pencil", in: rect.insetBy(dx: 4, dy: 4), color: .secondaryLabelColor)
            }
        } else if entry.commit.isMerge {
            let radius = GraphStyle.mergeNodeRadius + 0.5
            let rect = CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2)
            drawGlassPearl(in: rect, color: baseColor, alpha: alpha, context: context)
        } else {
            let radius = GraphStyle.nodeRadius
            let rect = CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2)
            if isHead {
                let ring = rect.insetBy(dx: -3, dy: -3)
                context.saveGState()
                context.setShadow(offset: .zero, blur: 4, color: baseColor.withAlphaComponent(0.6 * alpha).cgColor)
                context.setStrokeColor(baseColor.withAlphaComponent(alpha).cgColor)
                context.setLineWidth(1.6)
                context.strokeEllipse(in: ring)
                context.restoreGState()
            }
            if let avatar {
                drawAvatar(avatar, in: rect, ring: baseColor, alpha: alpha, context: context)
            } else {
                drawGlassPearl(in: rect, color: baseColor, alpha: alpha, context: context)
                drawInitials(GraphStyle.initials(entry.commit.authorName), in: rect, alpha: alpha)
            }
        }
        context.restoreGState()
    }

    /// A commit node as a "glass pearl" like in the logo: darker towards the bottom, bright glass rim, specular highlight.
    private func drawGlassPearl(in rect: CGRect, color: NSColor, alpha: CGFloat, context: CGContext) {
        context.saveGState()
        context.setAlpha(alpha)
        context.setShadow(offset: CGSize(width: 0, height: 1), blur: 2.5, color: NSColor.black.withAlphaComponent(0.28).cgColor)
        context.setFillColor(color.cgColor)
        context.fillEllipse(in: rect)
        context.setShadow(offset: .zero, blur: 0, color: nil)

        let light = color.blended(withFraction: 0.42, of: .white) ?? color
        let dark = color.blended(withFraction: 0.28, of: .black) ?? color
        if let gradient = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB),
                                     colors: [light.cgColor, color.cgColor, dark.cgColor] as CFArray,
                                     locations: [0, 0.5, 1]) {
            context.saveGState()
            context.addEllipse(in: rect)
            context.clip()
            context.drawLinearGradient(gradient, start: CGPoint(x: rect.midX, y: rect.minY),
                                       end: CGPoint(x: rect.midX, y: rect.maxY), options: [])
            context.restoreGState()
        }
        context.setStrokeColor(NSColor.white.withAlphaComponent(0.9).cgColor)
        context.setLineWidth(1.4)
        context.strokeEllipse(in: rect.insetBy(dx: 0.7, dy: 0.7))
        let highlight = CGRect(x: rect.minX + rect.width * 0.24, y: rect.minY + rect.height * 0.13,
                               width: rect.width * 0.4, height: rect.height * 0.26)
        context.setFillColor(NSColor.white.withAlphaComponent(0.5).cgColor)
        context.fillEllipse(in: highlight)
        context.restoreGState()
    }

    /// A circular avatar inside the lane's coloured ring (like GitKraken). `ring` is `.clear` on the WIP node — the dashed ring
    /// is already drawn outside, so no coloured disc is added.
    private func drawAvatar(_ image: NSImage, in rect: CGRect, ring color: NSColor, alpha: CGFloat, context: CGContext) {
        context.saveGState()
        context.setAlpha(alpha)
        if color != .clear {
            context.setShadow(offset: CGSize(width: 0, height: 1), blur: 2.5, color: NSColor.black.withAlphaComponent(0.28).cgColor)
            context.setFillColor(color.cgColor)
            context.fillEllipse(in: rect)
            context.setShadow(offset: .zero, blur: 0, color: nil)
        }
        let inner = color == .clear ? rect : rect.insetBy(dx: 2, dy: 2)
        context.addEllipse(in: inner)
        context.clip()
        NSColor.windowBackgroundColor.setFill()
        inner.fill()
        image.draw(in: inner, from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true,
                   hints: [.interpolation: NSImageInterpolation.high.rawValue])
        context.restoreGState()
    }

    private func drawInitials(_ text: String, in rect: CGRect, alpha: CGFloat) {
        let font = NSFont.systemFont(ofSize: text.count > 1 ? 8 : 9, weight: .bold)
        let shadow = NSShadow()
        shadow.shadowColor = NSColor.black.withAlphaComponent(0.35 * alpha)
        shadow.shadowOffset = NSSize(width: 0, height: -0.5)
        shadow.shadowBlurRadius = 1
        let attributes: [NSAttributedString.Key: Any] = [
            .font: font,
            .foregroundColor: NSColor.white.withAlphaComponent(alpha),
            .shadow: shadow,
        ]
        let string = NSAttributedString(string: text, attributes: attributes)
        let size = string.size()
        string.draw(at: CGPoint(x: rect.midX - size.width / 2, y: rect.midY - size.height / 2))
    }

    private func drawSymbol(_ name: String, in rect: CGRect, color: NSColor) {
        let configuration = NSImage.SymbolConfiguration(pointSize: rect.height, weight: .semibold)
            .applying(NSImage.SymbolConfiguration(paletteColors: [color]))
        guard let image = NSImage(systemSymbolName: name, accessibilityDescription: nil)?.withSymbolConfiguration(configuration) else { return }
        let size = image.size
        let scale = min(rect.width / size.width, rect.height / size.height)
        let drawSize = CGSize(width: size.width * scale, height: size.height * scale)
        image.draw(in: CGRect(x: rect.midX - drawSize.width / 2, y: rect.midY - drawSize.height / 2,
                              width: drawSize.width, height: drawSize.height))
    }
}

/// The branch / tag label cell: coloured "pills" per lane, a ✓ on the current branch, local + remote merged together.
final class RefsCellView: NSTableCellView {
    var labels: [RefLabel] = [] {
        didSet {
            needsDisplay = true
            let refs = labels.isEmpty ? "" : labels.flatMap { label -> [String] in
                if label.isDetachedHead { return [String(localized: "HEAD (detached)")] }
                let pull = label.pullRequest.map { ["Pull Request #\($0.number): \($0.title)"] } ?? []
                return pull + label.refs.map { ref in
                    switch ref.kind {
                    case .localBranch: return String(localized: "Nhánh local: \(ref.name)") + (ref.upstream.map { " → \($0)" } ?? "")
                    case .remoteBranch: return String(localized: "Nhánh remote: \(ref.name)")
                    case .tag: return "Tag: \(ref.name)"
                    }
                }
            }.joined(separator: "\n")
            let joined = [pendingSummary, refs].filter { !$0.isEmpty }.joined(separator: "\n")
            toolTip = joined.isEmpty ? nil : joined
        }
    }
    var laneColor: NSColor = .systemBlue { didSet { needsDisplay = true } }
    var dimmed = false { didSet { needsDisplay = true } }
    /// The uncommitted file count: an "✎ N" badge inside the checked-out branch's pill (those changes belong to that
    /// branch, not to the "// WIP" row). 0 = no badge.
    var pendingCount: Int = 0 {
        didSet {
            guard pendingCount != oldValue else { return }
            needsDisplay = true
        }
    }
    /// The details summary ("✎ 3 modified  ● 1 staged") shown in the pill's tooltip when it has a badge.
    var pendingSummary: String = "" {
        didSet {
            guard pendingSummary != oldValue else { return }
            needsDisplay = true
        }
    }

    override var isFlipped: Bool { true }

    private static let font = NSFont.systemFont(ofSize: 11, weight: .semibold)
    private static let pillHeight: CGFloat = 18
    private static let iconSize: CGFloat = 10
    private static let badgeFont = NSFont.systemFont(ofSize: 10, weight: .bold)
    private static let badgeGap: CGFloat = 5
    /// The badge's horizontal padding (already counted in the pill width, same in the Tauri app's DOM).
    private static let badgePadX: CGFloat = 4

    private struct Pill {
        let index: Int
        let rect: CGRect
    }

    private struct Layout {
        var pills: [Pill] = []
        var moreRect: CGRect?
        var moreCount = 0
        var end: CGFloat = 6
    }

    private static let textAttributes: [NSAttributedString.Key: Any] = [.font: font]
    private static let badgeAttributes: [NSAttributedString.Key: Any] = [.font: badgeFont]

    /// The badge of pill `label` (only the checked-out branch has one), `nil` when nothing is uncommitted.
    private func badge(for label: RefLabel) -> String? {
        guard label.isCurrentBranch, pendingCount > 0 else { return nil }
        return "✎ \(pendingCount)"
    }

    /// The badge width including its horizontal padding — it has to match `PILL.badgePadX` in the Tauri app so both versions look the same.
    private func badgeSize(_ text: String) -> CGFloat {
        ceil(NSAttributedString(string: text, attributes: Self.badgeAttributes).size().width) + Self.badgePadX * 2
    }

    /// Where the label pills sit in the cell (shared by painting and by hit-testing the label under the cursor while dragging).
    private func pillLayout() -> Layout {
        var result = Layout()
        let mid = (bounds.height / 2).rounded()
        var x: CGFloat = 6
        let maxX = bounds.width - 4
        for (index, label) in labels.enumerated() {
            let remaining = labels.count - index - 1
            let reserve: CGFloat = remaining > 0 ? 30 : 0
            let iconsWidth = CGFloat(iconNames(for: label).count) * (Self.iconSize + 3)
            let textWidth = ceil(NSAttributedString(string: label.text, attributes: Self.textAttributes).size().width)
            let badgeWidth = badge(for: label).map { Self.badgeGap + badgeSize($0) } ?? 0
            let available = maxX - x - reserve
            if available - badgeWidth < 44 {
                result.moreRect = CGRect(x: x, y: mid - Self.pillHeight / 2, width: 26, height: Self.pillHeight)
                result.moreCount = labels.count - index
                result.end = x + 26
                return result
            }
            let width = min(7 + iconsWidth + textWidth + badgeWidth + 7, available)
            let rect = CGRect(x: x, y: mid - Self.pillHeight / 2, width: width, height: Self.pillHeight)
            result.pills.append(Pill(index: index, rect: rect))
            result.end = rect.maxX
            x = rect.maxX + 4
        }
        return result
    }

    // MARK: Hovering "+N": a popover listing the branches / tags that were folded in (like GitKraken)

    private var hoverTracking: NSTrackingArea?
    private var overflowPopover: NSPopover?

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let hoverTracking { removeTrackingArea(hoverTracking) }
        let area = NSTrackingArea(rect: .zero, options: [.mouseMoved, .mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect],
                                  owner: self, userInfo: nil)
        addTrackingArea(area)
        hoverTracking = area
    }

    override func mouseMoved(with event: NSEvent) {
        super.mouseMoved(with: event)
        let point = convert(event.locationInWindow, from: nil)
        let layout = pillLayout()
        guard let more = layout.moreRect, more.insetBy(dx: -3, dy: -4).contains(point) else {
            closeOverflowPopover()
            return
        }
        guard overflowPopover == nil else { return }
        let hidden = Array(labels.suffix(layout.moreCount))
        guard !hidden.isEmpty else { return }
        let popover = NSPopover()
        popover.behavior = .semitransient
        popover.animates = false
        popover.contentViewController = NSHostingController(rootView: OverflowRefsList(labels: hidden))
        popover.show(relativeTo: more, of: self, preferredEdge: .maxY)
        overflowPopover = popover
    }

    override func mouseExited(with event: NSEvent) {
        super.mouseExited(with: event)
        closeOverflowPopover()
    }

    override func mouseDown(with event: NSEvent) {
        closeOverflowPopover()
        super.mouseDown(with: event)
    }

    private func closeOverflowPopover() {
        overflowPopover?.performClose(nil)
        overflowPopover = nil
    }

    /// Whether `point` (cell coordinates) is over the "+N" pill (the labels that didn't fit).
    func isOverflowHit(at point: CGPoint) -> Bool {
        pillLayout().moreRect?.insetBy(dx: -3, dy: -4).contains(point) ?? false
    }

    /// The label under `point` (cell coordinates).
    func label(at point: CGPoint) -> RefLabel? {
        let layout = pillLayout()
        for pill in layout.pills where pill.rect.insetBy(dx: -2, dy: -4).contains(point) {
            return labels[pill.index]
        }
        if let more = layout.moreRect, more.contains(point), let first = layout.pills.last {
            return labels[min(first.index + 1, labels.count - 1)]
        }
        return nil
    }

    override func draw(_ dirtyRect: NSRect) {
        guard !labels.isEmpty else { return }
        let mid = (bounds.height / 2).rounded()
        let alpha: CGFloat = dimmed ? 0.35 : 1
        let layout = pillLayout()

        for pill in layout.pills {
            let label = labels[pill.index]
            let rect = pill.rect
            let fill: NSColor
            if label.isDetachedHead {
                fill = NSColor.systemGray
            } else if label.hasLocal || label.isTag {
                fill = laneColor
            } else {
                fill = laneColor.blended(withFraction: 0.35, of: .gray) ?? laneColor
            }
            drawGlassPill(in: rect, color: fill,
                          opacity: (label.isCurrentBranch || label.isDetachedHead ? 1 : 0.88) * alpha,
                          emphasized: label.isCurrentBranch)

            var cursor = rect.minX + 7
            for icon in iconNames(for: label) {
                drawSymbol(icon, at: CGPoint(x: cursor, y: mid - Self.iconSize / 2), alpha: alpha)
                cursor += Self.iconSize + 3
            }
            let badge = badge(for: label)
            let badgeWidth = badge.map { Self.badgeGap + badgeSize($0) } ?? 0
            let textRect = CGRect(x: cursor, y: mid - 7.5, width: max(0, rect.maxX - 6 - badgeWidth - cursor), height: 15)
            let paragraph = NSMutableParagraphStyle()
            paragraph.lineBreakMode = .byTruncatingTail
            let attributes: [NSAttributedString.Key: Any] = [
                .font: Self.font,
                .foregroundColor: NSColor.white.withAlphaComponent(alpha),
                .paragraphStyle: paragraph,
                .shadow: Self.textShadow,
            ]
            NSAttributedString(string: label.text, attributes: attributes)
                .draw(with: textRect, options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine])
            if let badge {
                let size = badgeSize(badge)
                drawBadge(badge, in: CGRect(x: rect.maxX - 6 - size, y: mid - 7, width: size, height: 14), alpha: alpha)
            }
        }
        if let more = layout.moreRect {
            drawMore(count: layout.moreCount, in: more, alpha: alpha)
        }

        // The connector into the graph column.
        let connector = NSBezierPath()
        connector.move(to: CGPoint(x: layout.end, y: mid))
        connector.line(to: CGPoint(x: bounds.width, y: mid))
        laneColor.withAlphaComponent(0.55 * alpha).setStroke()
        connector.lineWidth = 1.5
        connector.stroke()
    }

    private static let textShadow: NSShadow = {
        let shadow = NSShadow()
        shadow.shadowColor = NSColor.black.withAlphaComponent(0.3)
        shadow.shadowOffset = NSSize(width: 0, height: -0.5)
        shadow.shadowBlurRadius = 1
        return shadow
    }()

    /// A glass-style label pill: light on top, darker towards the bottom, bright inner rim, thin coloured outer rim.
    private func drawGlassPill(in rect: CGRect, color: NSColor, opacity: CGFloat, emphasized: Bool) {
        let radius = rect.height / 2
        let path = NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius)
        let top = (color.blended(withFraction: 0.3, of: .white) ?? color).withAlphaComponent(opacity)
        let bottom = (color.blended(withFraction: 0.12, of: .black) ?? color).withAlphaComponent(opacity)
        NSGradient(starting: top, ending: bottom)?.draw(in: path, angle: 90)
        let rim = NSBezierPath(roundedRect: rect.insetBy(dx: 1, dy: 1), xRadius: radius - 1, yRadius: radius - 1)
        NSColor.white.withAlphaComponent((emphasized ? 0.75 : 0.35) * opacity).setStroke()
        rim.lineWidth = emphasized ? 1.4 : 1
        rim.stroke()
        (color.blended(withFraction: 0.35, of: .black) ?? color).withAlphaComponent(0.45 * opacity).setStroke()
        path.lineWidth = 0.75
        path.stroke()
    }

    /// The image used for a "label pill" while dragging a branch.
    static func dragImage(text: String, symbol: String, color: NSColor) -> NSImage {
        let attributes: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 12, weight: .semibold), .foregroundColor: NSColor.white]
        let string = NSAttributedString(string: text, attributes: attributes)
        let textSize = string.size()
        let size = NSSize(width: ceil(textSize.width) + 38, height: 24)
        return NSImage(size: size, flipped: false) { rect in
            let inset = rect.insetBy(dx: 1, dy: 1)
            let path = NSBezierPath(roundedRect: inset, xRadius: inset.height / 2, yRadius: inset.height / 2)
            NSGradient(starting: color.blended(withFraction: 0.3, of: .white) ?? color,
                       ending: color.blended(withFraction: 0.12, of: .black) ?? color)?.draw(in: path, angle: -90)
            NSColor.white.withAlphaComponent(0.9).setStroke()
            path.lineWidth = 1.5
            path.stroke()
            let configuration = NSImage.SymbolConfiguration(pointSize: 11, weight: .bold)
                .applying(NSImage.SymbolConfiguration(paletteColors: [.white]))
            if let image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)?.withSymbolConfiguration(configuration) {
                image.draw(in: NSRect(x: 9, y: (rect.height - 12) / 2, width: 12, height: 12))
            }
            string.draw(at: NSPoint(x: 27, y: (rect.height - textSize.height) / 2))
            return true
        }
    }

    private func iconNames(for label: RefLabel) -> [String] {
        if label.isDetachedHead { return ["exclamationmark.triangle.fill"] }
        if label.isTag { return ["tag.fill"] }
        var icons: [String] = []
        if label.isCurrentBranch { icons.append("checkmark") }
        if label.hasLocal { icons.append("laptopcomputer") }
        if label.remoteCount > 0 { icons.append("cloud.fill") }
        if label.pullRequest != nil { icons.append("arrow.triangle.pull") }
        return icons
    }

    /// The "✎ N" badge at the end of a pill: the checked-out branch's uncommitted file count.
    private func drawBadge(_ text: String, in rect: CGRect, alpha: CGFloat) {
        NSColor.black.withAlphaComponent(0.22 * alpha).setFill()
        NSBezierPath(roundedRect: rect, xRadius: rect.height / 2, yRadius: rect.height / 2).fill()
        let attributes: [NSAttributedString.Key: Any] = [
            .font: Self.badgeFont,
            .foregroundColor: NSColor.white.withAlphaComponent(alpha),
        ]
        let attributed = NSAttributedString(string: text, attributes: attributes)
        let size = attributed.size()
        attributed.draw(at: CGPoint(x: rect.midX - size.width / 2, y: rect.midY - size.height / 2))
    }


    private func drawMore(count: Int, in rect: CGRect, alpha: CGFloat) {
        NSColor.secondaryLabelColor.withAlphaComponent(0.25 * alpha).setFill()
        NSBezierPath(roundedRect: rect, xRadius: rect.height / 2, yRadius: rect.height / 2).fill()
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 10, weight: .bold),
            .foregroundColor: NSColor.labelColor.withAlphaComponent(alpha),
        ]
        let text = NSAttributedString(string: "+\(count)", attributes: attributes)
        let size = text.size()
        text.draw(at: CGPoint(x: rect.midX - size.width / 2, y: rect.midY - size.height / 2))
    }

    private func drawSymbol(_ name: String, at origin: CGPoint, alpha: CGFloat) {
        let configuration = NSImage.SymbolConfiguration(pointSize: Self.iconSize, weight: .bold)
            .applying(NSImage.SymbolConfiguration(paletteColors: [NSColor.white.withAlphaComponent(alpha)]))
        guard let image = NSImage(systemSymbolName: name, accessibilityDescription: nil)?.withSymbolConfiguration(configuration) else { return }
        let size = image.size
        let scale = min(Self.iconSize / size.width, Self.iconSize / size.height)
        let drawSize = CGSize(width: size.width * scale, height: size.height * scale)
        image.draw(in: CGRect(x: origin.x + (Self.iconSize - drawSize.width) / 2,
                              y: origin.y + (Self.iconSize - drawSize.height) / 2,
                              width: drawSize.width, height: drawSize.height))
    }
}

/// A shared text cell (message, author, date, SHA).
final class TextCellView: NSTableCellView {
    let label = NSTextField(labelWithString: "")

    init(identifier: NSUserInterfaceItemIdentifier, font: NSFont) {
        super.init(frame: .zero)
        self.identifier = identifier
        label.font = font
        label.lineBreakMode = .byTruncatingTail
        label.maximumNumberOfLines = 1
        label.usesSingleLineMode = true
        label.cell?.truncatesLastVisibleLine = true
        label.translatesAutoresizingMaskIntoConstraints = false
        label.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        addSubview(label)
        textField = label
        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 6),
            label.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -6),
            label.centerYAnchor.constraint(equalTo: centerYAnchor),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
}

/// The popover content when hovering "+N": the folded-in labels; click "+N" to pick an action.
private struct OverflowRefsList: View {
    let labels: [RefLabel]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(labels) { label in
                HStack(spacing: 6) {
                    Image(systemName: label.isTag ? "tag.fill" : (label.hasLocal ? "laptopcomputer" : "cloud.fill"))
                        .foregroundStyle(.secondary)
                        .frame(width: 16)
                    Text(label.text)
                        .fontWeight(label.isCurrentBranch ? .semibold : .regular)
                    if label.hasLocal && label.remoteCount > 0 {
                        Image(systemName: "cloud.fill").foregroundStyle(.tertiary).font(.caption)
                    }
                }
            }
            Divider()
            Text("Bấm “+\(labels.count)” để checkout / merge…")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(12)
        .fixedSize()
    }
}
