import Foundation

/// Định dạng ngày giờ tiếng Việt dùng chung (không phụ thuộc ngôn ngữ hệ thống).
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

    /// "3 giờ trước", "vừa xong"
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
