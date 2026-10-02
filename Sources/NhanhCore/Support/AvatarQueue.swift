import Foundation

/// Một yêu cầu tải ảnh đại diện: email người commit + repo GitHub (nếu có) để hỏi API commit.
public struct AvatarRequest: Sendable, Equatable {
    public let email: String
    public let repo: GitHubRepoRef?

    public init(email: String, repo: GitHubRepoRef?) {
        self.email = email
        self.repo = repo
    }
}

/// Hàng đợi tải ảnh đại diện trong RAM của app (khoá = hash email): ai đang chờ, ai đang tải, ai không có ảnh, ai lỗi tạm.
/// Không phụ thuộc AppKit để test được; app giữ ảnh đã tải riêng (NSCache).
///
/// - Hỏi lại khi đang chờ thì đưa lên đầu hàng (dòng đang hiện trên màn hình được tải trước) — O(1), không quét hàng.
/// - Hàng có giới hạn: quá `maxQueued` thì bỏ các yêu cầu cũ nhất (dòng đã cuộn qua; hỏi lại thì xếp lại).
/// - "Không có ảnh" nhớ suốt phiên; lỗi tạm (mạng, hết lượt API, token hết hạn) cho thử lại sau `retryInterval`.
public struct AvatarQueue: Sendable {
    public enum Outcome: Sendable, Equatable {
        case found
        case missing
        case unavailable
    }

    public let maxConcurrent: Int
    public let maxQueued: Int
    public let retryInterval: TimeInterval
    /// Số khoá "không có ảnh" tối đa nhớ trong RAM (cache trên đĩa vẫn giữ, hỏi lại không gửi gì ra mạng).
    public let maxRemembered: Int

    private var queued: [String: (request: AvatarRequest, ticket: Int)] = [:]
    /// Ngăn xếp (mới nhất ở cuối); mục cũ của khoá đã hỏi lại / đã lấy ra bị bỏ qua khi lấy, dọn khi quá dài.
    private var stack: [(key: String, ticket: Int)] = []
    private var nextTicket = 0
    private var inFlight: Set<String> = []
    private var missing: Set<String> = []
    private var retryAt: [String: Date] = [:]

    public init(maxConcurrent: Int = 4, maxQueued: Int = 300, retryInterval: TimeInterval = 5 * 60, maxRemembered: Int = 5000) {
        self.maxConcurrent = maxConcurrent
        self.maxQueued = maxQueued
        self.retryInterval = retryInterval
        self.maxRemembered = maxRemembered
    }

    public var queuedCount: Int { queued.count }
    public var inFlightCount: Int { inFlight.count }

    /// Xếp `key` vào hàng (hoặc đưa lên đầu nếu đang chờ). Không xếp nếu đang tải, đã biết là không có ảnh, hoặc vừa lỗi
    /// tạm chưa tới lúc thử lại. Yêu cầu có repo GitHub thắng yêu cầu không có repo của cùng khoá.
    public mutating func enqueue(_ key: String, _ request: AvatarRequest, now: Date = Date()) {
        guard !inFlight.contains(key), !missing.contains(key) else { return }
        if let retry = retryAt[key] {
            guard now >= retry else { return }
            retryAt[key] = nil
        }
        var request = request
        if request.repo == nil, let existing = queued[key]?.request, existing.repo != nil { request = existing }
        nextTicket += 1
        queued[key] = (request, nextTicket)
        stack.append((key, nextTicket))
        if queued.count > maxQueued {
            compact()
            // Bỏ các yêu cầu cũ nhất, chừa chỗ để không phải dọn ở mỗi lần hỏi.
            let drop = queued.count - maxQueued * 3 / 4
            for item in stack.prefix(drop) { queued[item.key] = nil }
            stack.removeFirst(drop)
        } else if stack.count > max(64, queued.count * 4) {
            compact()
        }
    }

    /// Việc kế tiếp được phép bắt đầu (chưa đủ `maxConcurrent` việc đang chạy): yêu cầu mới nhất trước.
    public mutating func next() -> (key: String, request: AvatarRequest)? {
        guard inFlight.count < maxConcurrent else { return nil }
        while let item = stack.popLast() {
            guard let entry = queued[item.key], entry.ticket == item.ticket else { continue }
            queued[item.key] = nil
            inFlight.insert(item.key)
            return (item.key, entry.request)
        }
        return nil
    }

    /// Kết thúc một việc đang tải.
    public mutating func finish(_ key: String, _ outcome: Outcome, now: Date = Date()) {
        inFlight.remove(key)
        switch outcome {
        case .found:
            break
        case .missing:
            if missing.count >= maxRemembered { missing.removeAll() }
            missing.insert(key)
        case .unavailable:
            if retryAt.count >= maxRemembered { retryAt.removeAll() }
            retryAt[key] = now.addingTimeInterval(retryInterval)
        }
    }

    /// Bỏ mọi yêu cầu đang chờ (tắt "Ảnh đại diện thật"); việc đang tải chạy nốt nhưng không bắt đầu việc mới.
    public mutating func removeAllQueued() {
        queued.removeAll()
        stack.removeAll()
    }

    private mutating func compact() {
        stack.removeAll { queued[$0.key]?.ticket != $0.ticket }
    }
}
