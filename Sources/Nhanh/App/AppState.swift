import AppKit
import NhanhCore
import SwiftUI

/// Khoá UserDefaults cho phần cài đặt.
enum Prefs {
    static let gitPath = "gitPath"
    static let recentRepositories = "recentRepositories"
    static let commitLimit = "commitLimit"
    static let logOrder = "logOrder"
    static let pullMode = "pullMode"
    static let fetchPrune = "fetchPrune"
    static let autoFetchMinutes = "autoFetchMinutes"
    static let relativeDates = "relativeDates"
    static let diffSplit = "diffSplit"
    static let diffContext = "diffContext"
    static let diffWrap = "diffWrap"
    static let showRemoteBranches = "showRemoteBranches"
    static let showTags = "showTags"
    static let lastCloneDirectory = "lastCloneDirectory"
    static let autoUpdate = "autoUpdate"
    static let lastLaunchedVersion = "lastLaunchedVersion"
    static let pendingUpdateNotes = "pendingUpdateNotes"
    static let settingsTab = "settingsTab"
    static let snapshotsEnabled = "snapshotsEnabled"
    static let snapshotKeepDays = "snapshotKeepDays"
    static let snapshotKeepCount = "snapshotKeepCount"
    static let snapshotsDisabledRepos = "snapshotsDisabledRepos"
    static let snapshotNoticeShown = "snapshotNoticeShown"

    static func register() {
        UserDefaults.standard.register(defaults: [
            commitLimit: 2000,
            logOrder: LogOrder.date.rawValue,
            pullMode: PullMode.merge.rawValue,
            fetchPrune: true,
            autoFetchMinutes: 5,
            relativeDates: true,
            diffSplit: false,
            diffContext: 3,
            diffWrap: true,
            showRemoteBranches: true,
            showTags: true,
            autoUpdate: true,
            snapshotsEnabled: true,
            snapshotKeepDays: SnapshotSpec.defaultKeepDays,
            snapshotKeepCount: SnapshotSpec.defaultKeepCount,
        ])
    }

    static var commitLimitValue: Int { max(200, UserDefaults.standard.integer(forKey: commitLimit)) }
    static var logOrderValue: LogOrder { LogOrder(rawValue: UserDefaults.standard.string(forKey: logOrder) ?? "") ?? .date }
    static var pullModeValue: PullMode { PullMode(rawValue: UserDefaults.standard.string(forKey: pullMode) ?? "") ?? .merge }
    static var fetchPruneValue: Bool { UserDefaults.standard.bool(forKey: fetchPrune) }
    static var autoFetchMinutesValue: Int { UserDefaults.standard.integer(forKey: autoFetchMinutes) }
    static var diffContextValue: Int { min(20, max(0, UserDefaults.standard.integer(forKey: diffContext))) }
    static var showRemoteBranchesValue: Bool { UserDefaults.standard.bool(forKey: showRemoteBranches) }
    static var showTagsValue: Bool { UserDefaults.standard.bool(forKey: showTags) }
    static var snapshotsEnabledValue: Bool { UserDefaults.standard.bool(forKey: snapshotsEnabled) }
    static var snapshotKeepDaysValue: Int { min(90, max(1, UserDefaults.standard.integer(forKey: snapshotKeepDays))) }
    static var snapshotKeepCountValue: Int { min(2000, max(20, UserDefaults.standard.integer(forKey: snapshotKeepCount))) }
    static var snapshotsDisabledReposValue: [String] {
        get { UserDefaults.standard.stringArray(forKey: snapshotsDisabledRepos) ?? [] }
        set { UserDefaults.standard.set(Array(newValue.suffix(500)), forKey: snapshotsDisabledRepos) }
    }
}

/// Trạng thái dùng chung toàn app: môi trường git, repo gần đây, yêu cầu mở từ Finder/Dock.
@Observable
final class AppState {
    static let shared = AppState()

    let environment: GitEnvironmentStore
    private(set) var gitVersion: String?
    private(set) var gitExecutablePath: String
    var recentRepositories: [String]
    /// Đường dẫn chờ mở (kéo thư mục vào Dock, `open -a Thaigit <thư mục>`, tham số dòng lệnh).
    var pendingOpenPaths: [String] = []

    private let askPassPath: String?
    private var loginShellPath: String?

    private init() {
        Prefs.register()
        askPassPath = AskPass.install()
        let environment = GitEnvironment.make(
            customGitPath: UserDefaults.standard.string(forKey: Prefs.gitPath),
            loginShellPath: nil,
            askPassScript: askPassPath
        )
        self.environment = GitEnvironmentStore(environment)
        gitExecutablePath = environment.executable.path
        recentRepositories = UserDefaults.standard.stringArray(forKey: Prefs.recentRepositories) ?? []
        pendingOpenPaths = Self.launchArgumentPaths()
        // Nạp tài khoản GitHub trước khi repo nào kịp chạy lệnh mạng (token đi qua `environment`).
        GitHubAccountManager.shared.bind(to: self.environment)
        Task { await self.loadShellEnvironment() }
    }

    private static func launchArgumentPaths() -> [String] {
        var paths: [String] = []
        if let path = ProcessInfo.processInfo.environment["NHANH_OPEN"], !path.isEmpty {
            paths.append(path)
        }
        for argument in CommandLine.arguments.dropFirst() where argument.hasPrefix("/") {
            var isDirectory: ObjCBool = false
            if FileManager.default.fileExists(atPath: argument, isDirectory: &isDirectory), isDirectory.boolValue {
                paths.append(argument)
            }
        }
        return paths
    }

    private func loadShellEnvironment() async {
        loginShellPath = await GitEnvironment.loginShellPATH()
        rebuildEnvironment()
    }

    func rebuildEnvironment() {
        let environment = GitEnvironment.make(
            customGitPath: UserDefaults.standard.string(forKey: Prefs.gitPath),
            loginShellPath: loginShellPath,
            askPassScript: askPassPath
        )
        self.environment.update(environment)
        gitExecutablePath = environment.executable.path
        Task {
            let runner = GitRunner(environmentStore: self.environment, workingDirectory: nil)
            let version = try? await runner.output(["--version"])
            self.gitVersion = version?.trimmingCharacters(in: .whitespacesAndNewlines)
        }
    }

    func noteRecent(_ path: String) {
        recentRepositories.removeAll { $0 == path }
        recentRepositories.insert(path, at: 0)
        if recentRepositories.count > 20 { recentRepositories.removeLast(recentRepositories.count - 20) }
        UserDefaults.standard.set(recentRepositories, forKey: Prefs.recentRepositories)
    }

    func removeRecent(_ path: String) {
        recentRepositories.removeAll { $0 == path }
        UserDefaults.standard.set(recentRepositories, forKey: Prefs.recentRepositories)
    }

    /// Hộp thoại chọn thư mục repository.
    func chooseRepositoryFolder(prompt: String = String(localized: "Mở")) -> String? {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = prompt
        panel.message = String(localized: "Chọn thư mục chứa Git repository")
        guard panel.runModal() == .OK, let url = panel.url else { return nil }
        return url.path
    }
}
