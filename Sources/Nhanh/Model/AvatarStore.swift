import AppKit
import NhanhCore

/// Real commit-author avatars (like GitKraken), shared by the graph and the details panel.
/// A missing image returns nil right away (draw initials instead) and downloads in the background; once ready it
/// fires `didChange` so the views repaint.
/// The queue / state live in `AvatarQueue` (NhanhCore, covered by tests); downloaded images are kept in a size-limited NSCache.
@Observable
final class AvatarStore {
    static let shared = AvatarStore()

    /// The on/off setting key (on by default) — shared by the Settings switch and the graph column header menu.
    static let enabledKey = "realAvatars"
    /// Sent when a new image arrives so the AppKit graph cells repaint.
    static let didChange = Notification.Name("nhanh.avatarsDidChange")
    private static let pixelSize = 80
    /// How many images stay in RAM (a decoded 80 px image is ~25 KB): a dropped one is simply re-read from the on-disk cache next time.
    private static let memoryLimit = 800

    /// Bumped whenever a new image arrives — SwiftUI views read it to repaint themselves.
    private(set) var version = 0

    /// While off nothing goes over the network: the queue is dropped immediately and no download job starts any more (a running one finishes).
    var isEnabled: Bool = UserDefaults.standard.object(forKey: AvatarStore.enabledKey) as? Bool ?? true {
        didSet {
            guard isEnabled != oldValue else { return }
            UserDefaults.standard.set(isEnabled, forKey: Self.enabledKey)
            if !isEnabled { queue.removeAllQueued() }
            version += 1
            NotificationCenter.default.post(name: Self.didChange, object: nil)
        }
    }

    @ObservationIgnored private let images = NSCache<NSString, NSImage>()
    @ObservationIgnored private var queue = AvatarQueue()
    @ObservationIgnored private var notifyScheduled = false
    @ObservationIgnored private let fetcher: AvatarFetcher

    private init() {
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first
        let bundle = Bundle.main.bundleIdentifier ?? "com.phanthai.thaigit"
        fetcher = AvatarFetcher(cacheDirectory: caches?.appendingPathComponent(bundle).appendingPathComponent("Avatars"))
        images.countLimit = Self.memoryLimit
    }

    /// The downloaded image for `email`; when there is none it queues a download (the GitHub repo helps find images via the commits API) and returns nil.
    func image(email: String, repo: GitHubRepoRef?) -> NSImage? {
        guard isEnabled, email.contains("@") else { return nil }
        let key = AvatarSource.hash(email)
        if let image = images.object(forKey: key as NSString) { return image }
        // Re-requesting while waiting: move it to the front (rows on screen download first).
        queue.enqueue(key, AvatarRequest(email: email, repo: repo))
        startNext()
        return nil
    }

    private func startNext() {
        // Turned off: don't start any job any more, including one queued before it was turned off.
        guard isEnabled else { return }
        while let next = queue.next() {
            let key = next.key
            let request = next.request
            let fetcher = fetcher
            Task {
                // The GitHub account token matching the repo's owner (only ever sent to api.github.com, never to Gravatar):
                // without a token GitHub allows only 60 requests/hour per IP. Fetched off the main actor because it may read the Keychain.
                let repo = request.repo
                let token = await Task.detached { repo.flatMap { GitHubAccountManager.shared.apiToken(forOwner: $0.owner) } }.value
                let result = await fetcher.lookupAvatar(email: request.email, repo: repo, size: Self.pixelSize, token: token)
                finish(key, result)
            }
        }
    }

    /// No image: not asked again during the session; a temporary failure (network, API rate limit, expired token) is retried after a few minutes.
    private func finish(_ key: String, _ result: AvatarResult) {
        switch result {
        case .found(let data):
            if let image = NSImage(data: data) {
                images.setObject(image, forKey: key as NSString)
                queue.finish(key, .found)
                scheduleNotify()
            } else {
                queue.finish(key, .missing)
            }
        case .missing:
            queue.finish(key, .missing)
        case .unavailable:
            queue.finish(key, .unavailable)
        }
        startNext()
    }

    /// Coalesce several arriving images into one repaint.
    private func scheduleNotify() {
        guard !notifyScheduled else { return }
        notifyScheduled = true
        Task {
            try? await Task.sleep(for: .milliseconds(120))
            notifyScheduled = false
            version += 1
            NotificationCenter.default.post(name: Self.didChange, object: nil)
        }
    }
}

extension RepoModel {
    /// The default remote's GitHub repo (used to find avatars via the commits API), nil when it isn't GitHub.
    var githubRepo: GitHubRepoRef? {
        let ordered = remotes.filter { $0.name == defaultRemote } + remotes
        return ordered.lazy.compactMap { GitHubRepoRef.parse(remoteURL: $0.fetchURL) }.first
    }
}
