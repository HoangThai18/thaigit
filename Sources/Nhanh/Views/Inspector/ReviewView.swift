import NhanhCore
import SwiftUI

/// Panel bên phải khi xem một Pull Request / Merge Request (như trang PR / MR trên GitHub / GitLab): tiêu đề, tác giả, nhánh,
/// mô tả, người review, người được gán, rồi các commit và file thay đổi so với nhánh đích — bấm file để xem diff ở giữa màn hình.
struct ReviewView: View {
    @Bindable var model: RepoModel
    let from: String
    let to: String

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if let session = model.review {
                    ReviewHeader(model: model, request: session.request)
                        .id(session.request.number)
                }
                Divider()
                if let comparison = model.comparison, comparison.from == from, comparison.to == to {
                    ComparisonContent(model: model, comparison: comparison, from: from, to: to, revealsCommits: false)
                } else {
                    ProgressView("Đang so sánh…").frame(maxWidth: .infinity)
                }
            }
            .padding(16)
        }
    }
}

/// Phần đầu của panel review: thông tin PR / MR, người review / người được gán và các nút thao tác.
private struct ReviewHeader: View {
    @Bindable var model: RepoModel
    let request: ForgeRequest
    @State private var showFullBody = false

    private var heading: String {
        request.kindName + " " + request.reference
    }

    private var authorSummary: String {
        var text = request.author.isEmpty ? "" : String(localized: "Tác giả: @") + request.author
        if let updated = request.updatedAt { text += String(localized: " · cập nhật ") + VietnameseDate.relative(updated) }
        // Chưa biết tác giả (MR vừa tạo): bỏ dấu phân cách " · " đứng đầu.
        return text.trimmingCharacters(in: CharacterSet(charactersIn: " ·"))
    }

    private var trimmedBody: String {
        request.body.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var isLongBody: Bool {
        let lines = trimmedBody.split(separator: "\n", omittingEmptySubsequences: false).count
        let characters = trimmedBody.count
        return characters > 280 || lines > 7
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            titleBar
            Text(verbatim: request.title)
                .font(.title3.bold())
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
            if !authorSummary.isEmpty {
                Text(authorSummary)
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
            branchLine
            descriptionBlock
            ReviewPeopleRow(model: model, role: .reviewers)
            ReviewPeopleRow(model: model, role: .assignees)
            actionRow
        }
    }

    private var titleBar: some View {
        HStack(spacing: 8) {
            Label(heading, systemImage: "arrow.triangle.pull")
                .font(.callout.weight(.semibold))
                .foregroundStyle(.secondary)
            if request.isDraft {
                Text("Nháp")
                    .font(.caption2.weight(.semibold))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Capsule().fill(Color.primary.opacity(0.1)))
            }
            Spacer(minLength: 4)
            Button {
                model.closeReview()
            } label: {
                Image(systemName: "xmark")
            }
            .buttonStyle(.borderless)
            .help("Đóng review")
        }
    }

    private var branchLine: some View {
        HStack(spacing: 6) {
            Text(verbatim: request.sourceBranch)
                .font(.callout.monospaced())
                .lineLimit(1)
                .truncationMode(.middle)
            Image(systemName: "arrow.right")
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(verbatim: request.targetBranch)
                .font(.callout.monospaced())
                .lineLimit(1)
                .truncationMode(.middle)
        }
    }

    @ViewBuilder private var descriptionBlock: some View {
        if trimmedBody.isEmpty {
            Text("Không có mô tả.")
                .font(.callout)
                .foregroundStyle(.tertiary)
        } else {
            VStack(alignment: .leading, spacing: 4) {
                Text(verbatim: trimmedBody)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .lineLimit(showFullBody ? nil : 6)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                if isLongBody {
                    Button {
                        showFullBody.toggle()
                    } label: {
                        Text(showFullBody ? String(localized: "Thu gọn") : String(localized: "Xem toàn bộ mô tả"))
                            .font(.caption)
                    }
                    .buttonStyle(.link)
                }
            }
        }
    }

    private var actionRow: some View {
        HStack(spacing: 8) {
            Button {
                model.openOnForge(request)
            } label: {
                Label(request.kind == .github ? String(localized: "Mở trên GitHub") : String(localized: "Mở trên GitLab"),
                      systemImage: "safari")
            }
            .disabled(request.webURL == nil)
            Button {
                model.checkoutReview(request)
            } label: {
                Label("Checkout", systemImage: "arrow.uturn.right")
            }
            Button {
                model.reloadReview(request)
            } label: {
                Label("Tải lại", systemImage: "arrow.clockwise")
            }
        }
        .buttonStyle(.bordered)
        .controlSize(.small)
    }
}

/// Một dòng "Người review" / "Người được gán": tên những người hiện có và nút mở bảng chọn người.
private struct ReviewPeopleRow: View {
    @Bindable var model: RepoModel
    let role: ReviewPeopleRole
    @State private var showPicker = false

    private var people: [ForgePerson] {
        guard let request = model.review?.request else { return [] }
        return role == .reviewers ? request.reviewers : request.assignees
    }

    private var title: String {
        role == .reviewers ? String(localized: "Người review") : String(localized: "Người được gán")
    }

    private var editHelp: String {
        role == .reviewers ? String(localized: "Chọn người review") : String(localized: "Chọn người được gán")
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .frame(width: 96, alignment: .leading)
            VStack(alignment: .leading, spacing: 4) {
                if people.isEmpty {
                    Text("Chưa có ai")
                        .font(.callout)
                        .foregroundStyle(.tertiary)
                }
                ForEach(people) { person in
                    ReviewPersonLabel(person: person)
                }
            }
            Spacer(minLength: 4)
            editButton
        }
    }

    private var editButton: some View {
        Button {
            model.loadReviewPeople()
            showPicker = true
        } label: {
            Image(systemName: "gearshape")
        }
        .buttonStyle(.borderless)
        .help(editHelp)
        .disabled(model.review?.isSaving == true)
        .popover(isPresented: $showPicker, arrowEdge: .bottom) {
            ReviewPeoplePicker(model: model, role: role, isPresented: $showPicker)
        }
    }
}

private struct ReviewPersonLabel: View {
    let person: ForgePerson

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "person.circle.fill")
                .foregroundStyle(.secondary)
            Text(verbatim: person.displayName)
                .font(.callout)
                .lineLimit(1)
            if person.displayName != person.username {
                Text(verbatim: "@" + person.username)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
    }
}

/// Bảng chọn người (người review hoặc người được gán): tìm theo tên, tick chọn, rồi bấm "Áp dụng" để gửi lên máy chủ.
private struct ReviewPeoplePicker: View {
    @Bindable var model: RepoModel
    let role: ReviewPeopleRole
    @Binding var isPresented: Bool
    @State private var query = ""
    @State private var chosen: [ForgePerson] = []

    private var current: [ForgePerson] {
        guard let request = model.review?.request else { return [] }
        return role == .reviewers ? request.reviewers : request.assignees
    }

    private var changed: Bool {
        Set(chosen.map(\.id)) != Set(current.map(\.id))
    }

    private var heading: String {
        role == .reviewers ? String(localized: "Nhờ review") : String(localized: "Gán cho")
    }

    /// Ứng viên: danh sách từ máy chủ cộng thêm những người đã được chọn mà không có trong danh sách; người review không gồm tác giả.
    private var candidates: [ForgePerson] {
        guard let session = model.review, case .loaded(let all) = session.people else { return [] }
        var list = all
        for person in current where !list.contains(person) {
            list.append(person)
        }
        if role == .reviewers {
            list = list.filter { $0.username.caseInsensitiveCompare(session.request.author) != .orderedSame }
        }
        let text = query.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return list }
        return list.filter { $0.username.localizedStandardContains(text) || ($0.name ?? "").localizedStandardContains(text) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(heading)
                .font(.headline)
            TextField("Tìm theo tên…", text: $query)
                .textFieldStyle(.roundedBorder)
            peopleList
            HStack {
                Spacer()
                Button("Huỷ") {
                    isPresented = false
                }
                Button("Áp dụng") {
                    model.updateReviewPeople(role, to: chosen)
                    isPresented = false
                }
                .buttonStyle(.borderedProminent)
                .disabled(!changed)
            }
        }
        .padding(14)
        .frame(width: 320)
        .onAppear { chosen = current }
    }

    @ViewBuilder private var peopleList: some View {
        switch model.review?.people ?? .idle {
        case .idle, .loading:
            ProgressView()
                .frame(maxWidth: .infinity, minHeight: 80)
        case .failed(let message):
            VStack(spacing: 8) {
                Text(message)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                Button("Thử lại") {
                    model.reloadReviewPeople()
                }
            }
            .frame(maxWidth: .infinity, minHeight: 80)
        case .loaded:
            loadedList
        }
    }

    private var loadedList: some View {
        let rows = Array(candidates.prefix(200))
        return ScrollView {
            LazyVStack(alignment: .leading, spacing: 2) {
                ForEach(rows) { person in
                    ReviewPickerRow(person: person, isChosen: chosen.contains(person)) {
                        toggle(person)
                    }
                }
                if rows.isEmpty {
                    Text("Không thấy ai khớp")
                        .foregroundStyle(.tertiary)
                        .padding(8)
                }
            }
        }
        .frame(height: 220)
    }

    private func toggle(_ person: ForgePerson) {
        if let index = chosen.firstIndex(of: person) {
            chosen.remove(at: index)
        } else {
            chosen.append(person)
        }
    }
}

private struct ReviewPickerRow: View {
    let person: ForgePerson
    let isChosen: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: isChosen ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(isChosen ? Color.accentColor : Color.secondary)
                Text(verbatim: person.displayName)
                if person.displayName != person.username {
                    Text(verbatim: "@" + person.username)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
            .padding(.vertical, 3)
            .padding(.horizontal, 4)
        }
        .buttonStyle(.plain)
    }
}
