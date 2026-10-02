import AppKit
import NhanhCore

/// Ảnh đại diện thật của người commit (như GitKraken), dùng chung cho graph và panel chi tiết.
/// Hỏi ảnh chưa có thì trả nil ngay (vẽ chữ viết tắt) và tải nền; tải xong thì báo `didChange` để vẽ lại.
/// Hàng đợi / trạng thái nằm trong `AvatarQueue` (NhanhCore, có test); ảnh đã tải giữ trong NSCache có giới hạn.
@Observable
final class AvatarStore {
    static let shared = AvatarStore()

    /// Khoá cài đặt bật/tắt (mặc định bật) — dùng chung cho công tắc trong Cài đặt và menu tiêu đề cột graph.
    static let enabledKey = "realAvatars"
    /// Gửi khi có ảnh mới để các ô graph (AppKit) vẽ lại.
    static let didChange = Notification.Name("nhanh.avatarsDidChange")
    private static let pixelSize = 80
    /// Số ảnh giữ trong RAM (ảnh 80 px đã giải mã ~25 KB): ảnh bị bỏ thì lần sau đọc lại từ cache trên đĩa.
    private static let memoryLimit = 800

    /// Tăng mỗi khi có ảnh mới — view SwiftUI đọc để tự vẽ lại.
    private(set) var version = 0

    /// Tắt thì không gửi gì ra mạng: bỏ ngay hàng đợi, không bắt đầu việc tải nào nữa (việc đang tải chạy nốt).
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

    /// Ảnh đã tải của `email`; chưa có thì xếp hàng tải (repo GitHub giúp tìm ảnh qua API commit) và trả nil.
    func image(email: String, repo: GitHubRepoRef?) -> NSImage? {
        guard isEnabled, email.contains("@") else { return nil }
        let key = AvatarSource.hash(email)
        if let image = images.object(forKey: key as NSString) { return image }
        // Hỏi lại khi đang chờ: đưa lên đầu hàng (dòng đang hiện trên màn hình được tải trước).
        queue.enqueue(key, AvatarRequest(email: email, repo: repo))
        startNext()
        return nil
    }

    private func startNext() {
        // Đã tắt: không bắt đầu việc nào nữa, kể cả việc xếp hàng trước khi tắt.
        guard isEnabled else { return }
        while let next = queue.next() {
            let key = next.key
            let request = next.request
            let fetcher = fetcher
            Task {
                // Token của tài khoản GitHub ứng với owner của repo (chỉ gửi tới api.github.com, không gửi Gravatar):
                // không có token thì GitHub chỉ cho 60 lượt/giờ mỗi IP. Lấy ngoài luồng chính vì có thể phải đọc Keychain.
                let repo = request.repo
                let token = await Task.detached { repo.flatMap { GitHubAccountManager.shared.apiToken(forOwner: $0.owner) } }.value
                let result = await fetcher.lookupAvatar(email: request.email, repo: repo, size: Self.pixelSize, token: token)
                finish(key, result)
            }
        }
    }

    /// Không có ảnh: không hỏi lại trong phiên; lỗi tạm (mạng, hết lượt API, token hết hạn): hỏi lại sau vài phút.
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
