import AppKit
import NhanhCore
import SwiftUI

/// Tự cập nhật: định kỳ hỏi GitHub Releases, tải ngầm và kiểm chữ ký bản mới, cài khi người dùng khởi động lại
/// (hoặc khi thoát app — lần mở sau đã là bản mới).
@Observable
final class AppUpdater {
    static let shared = AppUpdater()

    enum Phase: Equatable {
        case idle
        case checking
        case downloading(version: String)
        case ready(StagedUpdate)
        case failed(String)
    }

    struct JustUpdated: Equatable {
        let version: String
        let notes: String?
    }

    private(set) var phase: Phase = .idle
    private(set) var lastChecked: Date?
    /// Lần mở đầu tiên sau khi cập nhật: hiện "Đã cập nhật lên …" một lần.
    private(set) var justUpdated: JustUpdated?
    /// Người dùng bấm "Để sau" — ẩn thẻ thông báo tới lần mở app sau (bản mới vẫn được cài khi thoát).
    var bannerHidden = false

    let currentVersion: String
    private let client: UpdateClient?
    private let installer: UpdateInstaller?
    private var periodicCheck: Task<Void, Never>?
    private static let checkInterval: Duration = .seconds(6 * 3600)

    private init() {
        let info = Bundle.main.infoDictionary ?? [:]
        currentVersion = info["CFBundleShortVersionString"] as? String ?? "0"
        if let feed = (info["ThaigitUpdateFeedURL"] as? String).flatMap(URL.init(string:)),
           let publicKey = info["ThaigitUpdatePublicKey"] as? String, !publicKey.isEmpty,
           let bundleIdentifier = Bundle.main.bundleIdentifier,
           let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first {
            client = UpdateClient(feed: UpdateFeed(manifestURL: feed, allowedHosts: ["github.com"]))
            installer = UpdateInstaller(
                bundleIdentifier: bundleIdentifier,
                publicKey: publicKey,
                stagingDirectory: support.appendingPathComponent("Thaigit/Updates", isDirectory: true)
            )
        } else {
            client = nil
            installer = nil
        }
    }

    /// Bản build có khoá công khai + địa chỉ cập nhật trong Info.plist.
    var isSupported: Bool { client != nil }

    var isBusy: Bool {
        switch phase {
        case .checking, .downloading: return true
        default: return false
        }
    }

    /// Chỉ thay được app nằm trong thư mục Applications và ghi được (không phải bản đang chạy từ thư mục build,
    /// hay bản macOS "dịch chuyển" sang chỗ tạm khi mở thẳng từ file tải về).
    var canInstallInPlace: Bool {
        let app = Bundle.main.bundleURL
        let path = app.path
        guard !path.contains("/AppTranslocation/") else { return false }
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        guard path.hasPrefix("/Applications/") || path.hasPrefix(home + "/Applications/") else { return false }
        return FileManager.default.isWritableFile(atPath: app.deletingLastPathComponent().path)
    }

    func start() {
        guard isSupported, ProcessInfo.processInfo.environment["NHANH_SNAPSHOT_DIR"] == nil, periodicCheck == nil else { return }
        noteLaunchedVersion()
        periodicCheck = Task {
            try? await Task.sleep(for: .seconds(20))
            while !Task.isCancelled {
                if UserDefaults.standard.bool(forKey: Prefs.autoUpdate) {
                    await check(userInitiated: false)
                }
                try? await Task.sleep(for: Self.checkInterval)
            }
        }
    }

    private func noteLaunchedVersion() {
        let defaults = UserDefaults.standard
        if let previous = defaults.string(forKey: Prefs.lastLaunchedVersion).flatMap(AppVersion.init),
           let current = AppVersion(currentVersion), current > previous {
            justUpdated = JustUpdated(version: currentVersion, notes: defaults.string(forKey: Prefs.pendingUpdateNotes))
        }
        defaults.set(currentVersion, forKey: Prefs.lastLaunchedVersion)
        defaults.removeObject(forKey: Prefs.pendingUpdateNotes)
    }

    func check(userInitiated: Bool) async {
        guard let client, let installer else {
            if userInitiated { Self.alert("Bản này không tự cập nhật được", "Bản build từ mã nguồn không có khoá ký bản cập nhật.") }
            return
        }
        if case .ready(let staged) = phase {
            if userInitiated { offerRestart(staged) }
            return
        }
        guard !isBusy else { return }
        phase = .checking
        do {
            let result = try await client.check(currentVersion: currentVersion)
            lastChecked = Date()
            guard case .available(let manifest) = result else {
                phase = .idle
                if userInitiated { Self.alert("Bạn đang dùng bản mới nhất", "Thaigit \(currentVersion) là phiên bản mới nhất.") }
                return
            }
            phase = .downloading(version: manifest.version)
            let archive = try await client.download(manifest, into: installer.stagingDirectory.appendingPathComponent("downloads", isDirectory: true))
            defer { try? FileManager.default.removeItem(at: archive) }
            let staged = try await installer.stage(archive: archive, manifest: manifest)
            phase = .ready(staged)
            bannerHidden = false
            UserDefaults.standard.set(manifest.notes, forKey: Prefs.pendingUpdateNotes)
            if userInitiated { offerRestart(staged) }
        } catch {
            let message = FriendlyError.message(for: error)
            phase = .failed(message)
            if userInitiated { Self.alert("Không kiểm tra được bản cập nhật", message) }
        }
    }

    private func offerRestart(_ staged: StagedUpdate) {
        let alert = NSAlert()
        alert.messageText = "Thaigit \(staged.version) đã sẵn sàng"
        alert.informativeText = (staged.notes.map { $0 + "\n\n" } ?? "") + "Khởi động lại để dùng bản mới, hoặc để sau — bản mới sẽ được cài khi bạn thoát app."
        alert.addButton(withTitle: "Khởi động lại")
        alert.addButton(withTitle: "Để sau")
        if alert.runModal() == .alertFirstButtonReturn { installAndRelaunch() }
    }

    func installAndRelaunch() {
        guard case .ready(let staged) = phase else { return }
        guard canInstallInPlace else {
            Self.alert(
                "Chưa tự cập nhật được",
                "Thaigit đang chạy từ \(Bundle.main.bundleURL.deletingLastPathComponent().path). Hãy chép Thaigit vào thư mục Applications rồi mở lại, hoặc tải bản \(staged.version) trên trang GitHub của Thaigit."
            )
            return
        }
        let app = Bundle.main.bundleURL
        do {
            try UpdateInstaller.install(staged, replacing: app)
        } catch {
            Self.alert("Không cài được bản cập nhật", FriendlyError.message(for: error))
            return
        }
        phase = .idle
        // Chờ tiến trình này thoát hẳn rồi mở lại app (lúc này đã là bản mới).
        let reopen = Process()
        reopen.executableURL = URL(fileURLWithPath: "/bin/sh")
        reopen.arguments = [
            "-c",
            "while /bin/kill -0 \(ProcessInfo.processInfo.processIdentifier) 2>/dev/null; do /bin/sleep 0.2; done; /usr/bin/open \"$0\"",
            app.path,
        ]
        try? reopen.run()
        NSApp.terminate(nil)
    }

    /// Gọi khi app thoát: có bản mới đã tải xong thì cài luôn, lần mở sau là bản mới.
    func installPendingOnQuit() {
        guard case .ready(let staged) = phase, canInstallInPlace else { return }
        try? UpdateInstaller.install(staged, replacing: Bundle.main.bundleURL)
    }

    private static func alert(_ title: String, _ message: String) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = message
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }
}

/// Thẻ kính ở góc dưới bên trái cửa sổ: bản mới đã tải xong, hoặc vừa cập nhật xong.
struct UpdateBanner: View {
    private let updater = AppUpdater.shared
    @Environment(TabsModel.self) private var tabs

    var body: some View {
        if !updater.bannerHidden {
            if let done = updater.justUpdated {
                card(
                    icon: "checkmark.seal.fill",
                    tint: .green,
                    title: "Đã cập nhật lên Thaigit \(done.version)",
                    detail: done.notes
                ) {
                    Button("Có gì mới") { tabs.openReleaseNotes() }
                        .glassButtonStyle(prominent: true)
                    Button("Đóng") { updater.bannerHidden = true }
                        .glassButtonStyle()
                }
            } else if case .ready(let staged) = updater.phase {
                card(
                    icon: "arrow.down.circle.fill",
                    tint: Brand.orange,
                    title: "Thaigit \(staged.version) đã sẵn sàng",
                    detail: staged.notes ?? "Khởi động lại để dùng bản mới."
                ) {
                    Button("Khởi động lại") { updater.installAndRelaunch() }
                        .glassButtonStyle(prominent: true)
                        .tint(Brand.orange)
                    Button("Để sau") { updater.bannerHidden = true }
                        .glassButtonStyle()
                        .help("Bản mới sẽ được cài khi bạn thoát Thaigit")
                }
            }
        }
    }

    private func card<Actions: View>(
        icon: String, tint: Color, title: String, detail: String?, @ViewBuilder actions: () -> Actions
    ) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon)
                .font(.title2)
                .foregroundStyle(tint)
            VStack(alignment: .leading, spacing: 6) {
                Text(title)
                    .font(.callout.weight(.semibold))
                if let detail, !detail.isEmpty {
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(4)
                        .fixedSize(horizontal: false, vertical: true)
                }
                HStack(spacing: 8) { actions() }
                    .controlSize(.small)
                    .padding(.top, 2)
            }
        }
        .padding(12)
        .frame(width: 300, alignment: .leading)
        .glassSurface(in: RoundedRectangle(cornerRadius: 18), tint: tint.opacity(0.14))
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }
}

/// Mục "Cập nhật" trong Cài đặt.
struct UpdateSettingsSection: View {
    @AppStorage(Prefs.autoUpdate) private var autoUpdate = true
    private let updater = AppUpdater.shared

    var body: some View {
        Section("Cập nhật") {
            Toggle("Tự động kiểm tra và tải bản mới", isOn: $autoUpdate)
                .disabled(!updater.isSupported)
            LabeledContent("Phiên bản \(updater.currentVersion)") {
                HStack(spacing: 8) {
                    Text(status)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if case .ready = updater.phase {
                        Button("Khởi động lại") { updater.installAndRelaunch() }
                    } else {
                        Button("Kiểm tra ngay") { Task { await updater.check(userInitiated: true) } }
                            .disabled(updater.isBusy || !updater.isSupported)
                    }
                }
            }
            Text("Bản mới được tải từ GitHub, kiểm tra chữ ký rồi cài khi bạn khởi động lại Thaigit.")
                .font(.callout)
                .foregroundStyle(.secondary)
        }
    }

    private var status: String {
        switch updater.phase {
        case .checking: return "Đang kiểm tra…"
        case .downloading(let version): return "Đang tải bản \(version)…"
        case .ready(let staged): return "Bản \(staged.version) đã sẵn sàng"
        case .failed(let message): return message
        case .idle:
            guard let checked = updater.lastChecked else { return "" }
            return "Đã kiểm tra lúc " + checked.formatted(date: .omitted, time: .shortened)
        }
    }
}
