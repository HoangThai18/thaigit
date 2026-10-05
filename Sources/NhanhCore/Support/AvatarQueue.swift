import Foundation

/// One avatar download request: the commit author's email plus the GitHub repo (if known) to query the commits API with.
public struct AvatarRequest: Sendable, Equatable {
    public let email: String
    public let repo: GitHubRepoRef?

    public init(email: String, repo: GitHubRepoRef?) {
        self.email = email
        self.repo = repo
    }
}

/// Queue of avatar downloads kept in the app's RAM (keyed by an email hash): who is waiting, who is
/// downloading, who has no avatar and who failed temporarily.
/// Free of AppKit so it can be tested; the app keeps downloaded images separately (NSCache).
///
/// - Re-requesting a key that is waiting moves it to the front (rows on screen download first) — O(1), no queue scan.
/// - The queue is bounded: past `maxQueued` the oldest requests are dropped (rows already scrolled past;
///   requesting again re-queues).
/// - "No avatar" is remembered for the whole session; a temporary failure (network, API rate limit, expired
///   token) may be retried after `retryInterval`.
public struct AvatarQueue: Sendable {
    public enum Outcome: Sendable, Equatable {
        case found
        case missing
        case unavailable
    }

    public let maxConcurrent: Int
    public let maxQueued: Int
    public let retryInterval: TimeInterval
    /// Max "no avatar" keys remembered in RAM (the on-disk cache still holds, so re-checking sends nothing over the network).
    public let maxRemembered: Int

    private var queued: [String: (request: AvatarRequest, ticket: Int)] = [:]
    /// A stack (newest last); stale entries of a key that was re-requested / taken out are skipped when taking, and trimmed when it grows too long.
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

    /// Queue `key` (or move it to the front when it is waiting). Not queued when it is already downloading,
    /// already known to have no avatar, or a temporary failure hasn't reached its retry time yet. A request
    /// carrying a GitHub repo outranks one without, for the same key.
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
            // Drop the oldest requests so we don't have to prune on every enqueue.
            let drop = queued.count - maxQueued * 3 / 4
            for item in stack.prefix(drop) { queued[item.key] = nil }
            stack.removeFirst(drop)
        } else if stack.count > max(64, queued.count * 4) {
            compact()
        }
    }

    /// The next job allowed to start (fewer than `maxConcurrent` running): newest request first.
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

    /// Finish a running download.
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

    /// Drop every waiting request ("Real avatars" turned off); a running download finishes but no new job starts.
    public mutating func removeAllQueued() {
        queued.removeAll()
        stack.removeAll()
    }

    private mutating func compact() {
        stack.removeAll { queued[$0.key]?.ticket != $0.ticket }
    }
}
