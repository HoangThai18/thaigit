import Foundation
import NhanhCore

/// Trạng thái panel Dòng thời gian (snapshot tự động của thư mục làm việc).
struct TimelineState {
    var isOpen = false
    var entries: [SnapshotEntry] = []
    var isLoading = false
    var selected: SnapshotEntry?
    /// Mốc đã chọn so với "bây giờ" (mốc chụp ngay lúc chọn, nên thấy cả file chưa track).
    var comparison: (target: SnapshotEntry, now: SnapshotEntry, files: [FileChange])?
    var isComparing = false
}

/// Dòng thời gian: tự lưu khi working tree đổi (đợi file yên, không dày hơn khoảng tối thiểu — cùng thông số với app Tauri),
/// xem / so sánh / khôi phục mốc có hỏi trước và Hoàn tác. Cửa sổ ẩn vẫn chụp: agent AI thường sửa file lúc app nằm nền.
extension RepoModel {
    var snapshotsEnabledForRepo: Bool {
        Prefs.snapshotsEnabledValue && !Prefs.snapshotsDisabledReposValue.contains(repository.root.path)
    }

    var snapshotsDisabledForRepo: Bool { Prefs.snapshotsDisabledReposValue.contains(repository.root.path) }

    func setSnapshotsEnabledForRepo(_ enabled: Bool) {
        var list = Prefs.snapshotsDisabledReposValue.filter { $0 != repository.root.path }
        if !enabled { list.append(repository.root.path) }
        Prefs.snapshotsDisabledReposValue = list
        // Đổi cài đặt ngoài @Observable: gán lại để giao diện vẽ lại.
        timeline.isOpen = timeline.isOpen
    }

    // MARK: - Tự lưu

    /// Working tree vừa đổi (hoặc vừa mở repo): hẹn chụp sau khi file yên, mỗi thay đổi mới đẩy lùi.
    func noteWorkingTreeChangeForSnapshots() {
        snapshotTask?.cancel()
        snapshotTask = Task { [weak self] in
            await self?.runScheduledSnapshot()
        }
    }

    private func runScheduledSnapshot() async {
        while !Task.isCancelled {
            let earliest = lastSnapshotAt.addingTimeInterval(SnapshotSpec.minIntervalSeconds)
            let wait = max(SnapshotSpec.quietSeconds, earliest.timeIntervalSinceNow)
            try? await Task.sleep(for: .seconds(wait))
            guard !Task.isCancelled else { return }
            guard snapshotsEnabledForRepo else { return }
            // Đang chạy thao tác của app: đợi xong rồi chụp.
            if runningOperations > 0 { continue }
            do {
                try await repository.takeSnapshot(reason: .auto)
                lastSnapshotAt = Date()
                showFirstSnapshotNoticeIfNeeded()
                if Date().timeIntervalSince(lastSnapshotPruneAt) >= SnapshotSpec.pruneIntervalSeconds {
                    lastSnapshotPruneAt = Date()
                    _ = try? await repository.pruneSnapshots(now: Int(Date().timeIntervalSince1970),
                                                             keepDays: Prefs.snapshotKeepDaysValue,
                                                             keepCount: Prefs.snapshotKeepCountValue)
                }
                if timeline.isOpen { await reloadTimeline() }
            } catch {
                // Lỗi (repo hỏng, git thiếu…): bỏ lần này; khoảng tối thiểu tránh thử lại dồn dập. Chi tiết không hiện ra ngoài.
                lastSnapshotAt = Date()
            }
            return
        }
    }

    private func showFirstSnapshotNoticeIfNeeded() {
        let defaults = UserDefaults.standard
        guard !defaults.bool(forKey: Prefs.snapshotNoticeShown) else { return }
        defaults.set(true, forKey: Prefs.snapshotNoticeShown)
        toast(.info, String(localized: "Thaigit sẽ tự lưu thư mục làm việc khi file thay đổi để bạn quay lại được nếu code bị hỏng (Dòng thời gian, ở panel thay đổi). Mốc chỉ nằm trên máy, không bao giờ được push."),
              actions: [ToastAction(title: String(localized: "Tắt tự lưu cho repo này")) { [weak self] in
                  self?.setSnapshotsEnabledForRepo(false)
              }])
    }

    // MARK: - Panel

    func openTimeline() {
        timeline.isOpen = true
        Task { await reloadTimeline() }
    }

    func closeTimeline() {
        timeline.isOpen = false
        timeline.selected = nil
        timeline.comparison = nil
        if case .compare = openFile?.source { closeFile() }
    }

    func reloadTimeline() async {
        timeline.isLoading = true
        defer { timeline.isLoading = false }
        do {
            timeline.entries = try await repository.snapshots()
        } catch {
            showError(String(localized: "Không đọc được dòng thời gian"), error)
        }
    }

    func selectSnapshot(_ entry: SnapshotEntry) {
        timeline.selected = entry
        timeline.comparison = nil
        timeline.isComparing = true
        Task {
            defer { timeline.isComparing = false }
            do {
                let now = try await repository.takeSnapshot(reason: .auto, quiet: false)
                let files = try await repository.snapshotDifferences(from: entry.sha, to: now.sha)
                guard timeline.selected == entry else { return }
                timeline.comparison = (entry, now, files)
                await reloadTimeline()
            } catch {
                showError(String(localized: "Không đọc được dòng thời gian"), error)
            }
        }
    }

    func takeSnapshotNow() {
        Task {
            do {
                try await repository.takeSnapshot(reason: .manual)
                toast(.success, String(localized: "Đã lưu mốc"))
                if timeline.isOpen { await reloadTimeline() }
            } catch {
                showError(String(localized: "Không lưu được mốc"), error)
            }
        }
    }

    /// Khôi phục `paths` (nil = tất cả) về mốc đã chọn — hỏi trước, có Hoàn tác.
    func restoreSelectedSnapshot(paths: [String]?) {
        guard let comparison = timeline.comparison else { return }
        let count = paths?.count ?? comparison.files.count
        guard count > 0 else {
            toast(.info, String(localized: "Thư mục làm việc đã giống mốc này."))
            return
        }
        let target = comparison.target
        confirmation = Confirmation(
            title: count == 1 ? String(localized: "Khôi phục 1 file về mốc này?") : String(localized: "Khôi phục \(count) file về mốc này?"),
            message: String(localized: "Thư mục làm việc hiện tại được lưu thành một mốc trước khi ghi đè nên bạn hoàn tác được. File tạo sau mốc này được chuyển vào Thùng rác. Phần đã stage không đổi."),
            confirmTitle: String(localized: "Khôi phục"),
            isDestructive: true
        ) { [weak self] in
            self?.performSnapshotRestore(target: target, paths: paths)
        }
    }

    private func performSnapshotRestore(target: SnapshotEntry, paths: [String]?) {
        var result: SnapshotRestoreResult?
        perform(String(localized: "Khôi phục từ dòng thời gian"), refresh: .status) { repo in
            result = try await repo.restoreSnapshot(target.sha, paths: paths)
        } onSuccess: { [weak self] in
            guard let self, let result else { return }
            let changed = result.restored.count + result.trashed.count
            if changed == 0 {
                toast(.info, String(localized: "Thư mục làm việc đã giống mốc này."))
            } else {
                toast(.success, String(localized: "Đã khôi phục \(changed) file"),
                      actions: [ToastAction(title: String(localized: "Hoàn tác")) { [weak self] in
                          self?.undoSnapshotRestore(before: result.before, paths: paths)
                      }])
            }
            if timeline.isOpen, timeline.selected == target { selectSnapshot(target) }
        }
    }

    private func undoSnapshotRestore(before: SnapshotEntry, paths: [String]?) {
        perform(String(localized: "Hoàn tác khôi phục"), refresh: .status) { repo in
            _ = try await repo.restoreSnapshot(before.sha, paths: paths)
        } onSuccess: { [weak self] in
            guard let self else { return }
            toast(.success, String(localized: "Đã đưa thư mục làm việc về như trước khi khôi phục"))
            if timeline.isOpen, let selected = timeline.selected { selectSnapshot(selected) }
        }
    }
}

/// Cờ rủi ro trước khi commit: tính lại sau mỗi lần làm mới trạng thái (gom các lần sát nhau). Chỉ là gợi ý — lỗi thì im lặng.
extension RepoModel {
    func scheduleRiskCheck() {
        riskTask?.cancel()
        riskTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(1500))
            guard let self, !Task.isCancelled else { return }
            let status = self.status
            guard let inputs = try? await repository.riskInputs(status: status), !Task.isCancelled else { return }
            let flags = RiskRules.detect(inputs)
            if flags != riskFlags { riskFlags = flags }
        }
    }
}
