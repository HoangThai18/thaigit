import NhanhCore
import SwiftUI

/// The Timeline panel (replacing the right-hand details when opened): the auto-saved milestones; pick one to see which files
/// differ from now — click a file for its diff in the centre, and restore just the file in view or everything (always confirmed, with Undo).
struct TimelineView: View {
    @Bindable var model: RepoModel
    @AppStorage(Prefs.relativeDates) private var relativeDates = true
    @AppStorage(Prefs.snapshotsEnabled) private var snapshotsEnabled = true

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider()
            entries
            if let comparison = model.timeline.comparison {
                Divider()
                compare(comparison)
            } else if model.timeline.isComparing {
                Divider()
                ProgressView("Đang so với bây giờ…").frame(maxWidth: .infinity, minHeight: 120)
            }
            Divider()
            footer
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Label("Dòng thời gian", systemImage: "clock.arrow.circlepath")
                    .font(.headline)
                Spacer()
                Button {
                    model.takeSnapshotNow()
                } label: {
                    Image(systemName: "plus")
                }
                .help("Lưu mốc ngay")
                Button {
                    model.closeTimeline()
                } label: {
                    Image(systemName: "xmark")
                }
                .help("Đóng dòng thời gian")
            }
            .buttonStyle(.borderless)
            Text(statusText)
                .font(.caption)
                .foregroundStyle(snapshotsEnabled && !model.snapshotsDisabledForRepo ? Color.secondary : Color.orange)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }

    private var statusText: String {
        if !snapshotsEnabled { return String(localized: "Tự lưu đang tắt trong Cài đặt.") }
        if model.snapshotsDisabledForRepo { return String(localized: "Đang tắt tự lưu cho repo này.") }
        return String(localized: "Thaigit tự lưu thư mục làm việc mỗi khi file thay đổi, kể cả file chưa commit. Chọn một mốc để xem khác gì so với bây giờ rồi khôi phục.")
    }

    @ViewBuilder private var entries: some View {
        if model.timeline.entries.isEmpty {
            Text(model.timeline.isLoading ? "Đang đọc dòng thời gian…" : "Chưa có mốc nào. Thaigit sẽ tự lưu khi file trong repo thay đổi.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .padding(14)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        } else {
            List(model.timeline.entries, selection: Binding(
                get: { model.timeline.selected?.id },
                set: { id in
                    if let entry = model.timeline.entries.first(where: { $0.id == id }) { model.selectSnapshot(entry) }
                }
            )) { entry in
                VStack(alignment: .leading, spacing: 2) {
                    Text(timeText(entry)).font(.callout.weight(.medium))
                    Text(metaText(entry)).font(.caption).foregroundStyle(.secondary)
                }
                .tag(entry.id)
            }
            .listStyle(.inset)
            .frame(minHeight: 100)
        }
    }

    private func compare(_ comparison: (target: SnapshotEntry, now: SnapshotEntry, files: [FileChange])) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if comparison.files.isEmpty {
                Text("Thư mục làm việc giống hệt mốc này.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            } else {
                Text("Khác với bây giờ").font(.callout.weight(.semibold))
                FileList(model: model, files: comparison.files, source: .compare(from: comparison.target.sha, to: comparison.now.sha))
                HStack {
                    if let open = model.openFile, open.source == .compare(from: comparison.target.sha, to: comparison.now.sha) {
                        Button("Khôi phục file này") { model.restoreSelectedSnapshot(paths: [open.change.path]) }
                    }
                    Spacer()
                    Button("Khôi phục tất cả về mốc này") { model.restoreSelectedSnapshot(paths: nil) }
                        .buttonStyle(.borderedProminent)
                }
            }
        }
        .padding(14)
        .frame(maxHeight: .infinity, alignment: .top)
    }

    @ViewBuilder private var footer: some View {
        Group {
            if model.snapshotsDisabledForRepo {
                Button("Bật lại tự lưu cho repo này") { model.setSnapshotsEnabledForRepo(true) }
            } else if snapshotsEnabled {
                Button("Tắt tự lưu cho repo này") { model.setSnapshotsEnabledForRepo(false) }
            }
        }
        .buttonStyle(.link)
        .font(.caption)
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
    }

    private func timeText(_ entry: SnapshotEntry) -> String {
        if relativeDates, Date().timeIntervalSince(entry.date) < 7 * 86_400 {
            return entry.date.formatted(.relative(presentation: .named))
        }
        return entry.date.formatted(date: .numeric, time: .shortened)
    }

    private func metaText(_ entry: SnapshotEntry) -> String {
        let reason = switch entry.reason {
        case .auto: String(localized: "Tự lưu")
        case .beforeRestore: String(localized: "Trước khi khôi phục")
        case .manual: String(localized: "Lưu thủ công")
        }
        guard let files = entry.files else { return reason }
        return reason + " · " + String(localized: "\(files) file khác HEAD")
    }
}
