import AppKit
import NhanhCore

/// Ảnh đại diện thật của người commit (như GitKraken), dùng chung cho graph và panel chi tiết.
/// Hỏi ảnh chưa có thì trả nil ngay (vẽ chữ viết tắt) và tải nền; tải xong thì báo `didChange` để vẽ lại.
@Observable
final class AvatarStore {
    static let shared = AvatarStore()

    /// Cài đặt bật/tắt (mặc định bật); tắt thì không gửi gì ra mạng.
    static let enabledKey = "realAvatars"
    /// Gửi khi có ảnh mới để các ô graph (AppKit) vẽ lại.
    static let didChange = Notification.Name("nhanh.avatarsDidChange")
    private static let maxConcurrent = 4
    private static let pixelSize = 80

    /// Tăng mỗi khi có ảnh mới — view SwiftUI đọc để tự vẽ lại.
    private(set) var version = 0

    @ObservationIgnored private var images: [String: NSImage] = [:]
    @ObservationIgnored private var missing: Set<String> = []
    @ObservationIgnored private var queued: [String: (email: String, repo: GitHubRepoRef?)] = [:]
    @ObservationIgnored private var queueOrder: [String] = []
    @ObservationIgnored private var inFlight: Set<String> = []
    @ObservationIgnored private var notifyScheduled = false
    @ObservationIgnored private let fetcher: AvatarFetcher

    private init() {
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first
        let bundle = Bundle.main.bundleIdentifier ?? "com.phanthai.thaigit"
        fetcher = AvatarFetcher(cacheDirectory: caches?.appendingPathComponent(bundle).appendingPathComponent("Avatars"))
    }

    var isEnabled: Bool {
        get { UserDefaults.standard.object(forKey: Self.enabledKey) as? Bool ?? true }
        set {
            UserDefaults.standard.set(newValue, forKey: Self.enabledKey)
            version += 1
            NotificationCenter.default.post(name: Self.didChange, object: nil)
        }
    }

    /// Ảnh đã tải của `email`; chưa có thì xếp hàng tải (repo GitHub giúp tìm ảnh qua API commit) và trả nil.
    func image(email: String, repo: GitHubRepoRef?) -> NSImage? {
        guard isEnabled, email.contains("@") else { return nil }
        let key = AvatarSource.hash(email)
        if let image = images[key] { return image }
        if missing.contains(key) || inFlight.contains(key) { return nil }
        // Hỏi lại khi đang chờ: đưa lên đầu hàng (dòng đang hiện trên màn hình được tải trước).
        if queued[key] == nil || (queued[key]?.repo == nil && repo != nil) { queued[key] = (email, repo) }
        queueOrder.removeAll { $0 == key }
        queueOrder.append(key)
        startNext()
        return nil
    }

    private func startNext() {
        while inFlight.count < Self.maxConcurrent, let key = queueOrder.popLast() {
            guard let request = queued.removeValue(forKey: key) else { continue }
            inFlight.insert(key)
            let fetcher = fetcher
            Task {
                // Token của tài khoản GitHub ứng với owner của repo (chỉ gửi tới api.github.com, không gửi Gravatar):
                // không có token thì GitHub chỉ cho 60 lượt/giờ mỗi IP. Lấy ngoài luồng chính vì có thể phải đọc Keychain.
                let repo = request.repo
                let token = await Task.detached { repo.flatMap { GitHubAccountManager.shared.apiToken(forOwner: $0.owner) } }.value
                let data = await fetcher.avatar(email: request.email, repo: request.repo, size: Self.pixelSize, token: token)
                finish(key, image: data.flatMap(NSImage.init(data:)))
            }
        }
    }

    private func finish(_ key: String, image: NSImage?) {
        inFlight.remove(key)
        if let image {
            images[key] = image
            scheduleNotify()
        } else {
            missing.insert(key)
        }
        startNext()
    }

    /// Gom nhiều ảnh về cùng lúc thành một lần vẽ lại.
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
    /// Repo trên GitHub của remote mặc định (để tìm ảnh đại diện qua API commit), nil nếu không phải GitHub.
    var githubRepo: GitHubRepoRef? {
        let ordered = remotes.filter { $0.name == defaultRemote } + remotes
        return ordered.lazy.compactMap { GitHubRepoRef.parse(remoteURL: $0.fetchURL) }.first
    }
}
