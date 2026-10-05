import Foundation

/// Log of the git commands that ran (keeps at most the `capacity` most recent lines). Thread-safe.
public final class CommandLog: @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [GitCommandRecord] = []
    private let capacity: Int

    public init(capacity: Int = 400) {
        self.capacity = capacity
    }

    public func append(_ record: GitCommandRecord) {
        lock.lock()
        storage.append(record)
        if storage.count > capacity { storage.removeFirst(storage.count - capacity) }
        lock.unlock()
    }

    public var records: [GitCommandRecord] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }
}
