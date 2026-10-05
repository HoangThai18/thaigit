import Foundation

/// Shared Vietnamese date/time formatting (independent of the system locale).
enum VietnameseDate {
    private static let relativeFormatter: RelativeDateTimeFormatter = {
        let formatter = RelativeDateTimeFormatter()
        formatter.locale = Locale(identifier: "vi_VN")
        formatter.unitsStyle = .full
        return formatter
    }()

    private static let absoluteFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "vi_VN")
        formatter.dateFormat = "dd/MM/yyyy HH:mm"
        return formatter
    }()

    /// "3 hours ago", "just now"
    static func relative(_ date: Date, to now: Date = Date()) -> String {
        let interval = now.timeIntervalSince(date)
        if interval < 60, interval > -60 { return String(localized: "vừa xong") }
        return relativeFormatter.localizedString(for: date, relativeTo: now)
    }

    /// "25/09/2024 21:13"
    static func absolute(_ date: Date) -> String {
        absoluteFormatter.string(from: date)
    }
}
