import AppKit
import NhanhCore
import SwiftUI

/// Chi tiết commit: nút thao tác nhanh, message, tác giả, SHA, file thay đổi.
struct CommitDetailView: View {
    @Bindable var model: RepoModel

    var body: some View {
        if let details = model.commitDetails, case .commit(let sha) = model.selection, details.commit.id == sha {
            VStack(spacing: 0) {
                if !model.status.isClean {
                    UncommittedBanner(model: model)
                }
                DetailContent(model: model, details: details, source: .commit(sha))
            }
        } else if model.isLoadingDetails {
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ContentUnavailableView("Không có chi tiết", systemImage: "questionmark.circle")
        }
    }
}

/// Đang xem một commit mà vẫn còn file chưa commit: nhắc ngay đầu panel, kèm nút stage / về màn commit (như dòng WIP của
/// GitKraken) — không phải tự tìm dòng "// WIP" trên graph.
private struct UncommittedBanner: View {
    @Bindable var model: RepoModel

    private var count: Int {
        Set(model.status.staged.map(\.path) + model.status.unstaged.map(\.path) + model.status.conflicts.map(\.path)).count
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: model.status.conflicts.isEmpty ? "pencil.circle.fill" : "exclamationmark.triangle.fill")
                    .foregroundStyle(model.status.conflicts.isEmpty ? Color.orange : Color.red)
                Text("\(count) file chưa commit")
                    .font(.callout.weight(.semibold))
                    .lineLimit(1)
                    .fixedSize()
                Text("trên \(model.headDescription)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            HStack(spacing: 6) {
                if !model.status.unstaged.isEmpty {
                    Button { model.stageAll() } label: { Label("Stage tất cả", systemImage: "plus.circle") }
                        .glassButtonStyle()
                        .fixedSize()
                }
                Button { model.selectWorkingTree() } label: { Label("Xem & commit", systemImage: "checkmark.circle") }
                    .glassButtonStyle(prominent: true)
                    .fixedSize()
                    .help("Mở danh sách file chưa commit để stage, bỏ stage, huỷ và commit (⌘0)")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(.orange.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
        .padding(.horizontal, 10)
        .padding(.top, 10)
    }
}

struct StashDetailView: View {
    @Bindable var model: RepoModel
    let sha: String

    var body: some View {
        if let stash = model.stashes.first(where: { $0.sha == sha }) {
            VStack(spacing: 0) {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Image(systemName: "archivebox.fill").foregroundStyle(.secondary)
                        Text("Stash").font(.headline)
                        Text(stash.selector).font(.caption.monospaced()).foregroundStyle(.secondary)
                        Spacer()
                    }
                    Text(stash.displayMessage.isEmpty ? String(localized: "(không có message)") : stash.displayMessage)
                        .font(.title3.weight(.semibold))
                        .textSelection(.enabled)
                    Text([stash.branchName.map { String(localized: "Từ nhánh \($0)") }, VietnameseDate.absolute(stash.date)]
                        .compactMap { $0 }.joined(separator: " · "))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    HStack {
                        Button { model.applyStash(stash) } label: { Label("Apply", systemImage: "tray.and.arrow.down") }
                            .glassButtonStyle()
                            .help("Apply thay đổi, vẫn giữ stash")
                        Button { model.popStash(stash) } label: { Label("Pop", systemImage: "tray.and.arrow.up") }
                            .glassButtonStyle(prominent: true)
                            .help("Apply thay đổi rồi xoá stash")
                        Spacer()
                        Button(role: .destructive) { model.dropStash(stash) } label: { Label("Xoá", systemImage: "trash") }
                    }
                    .controlSize(.regular)
                }
                .padding(14)
                Divider()
                if let details = model.commitDetails, details.commit.id == sha {
                    FileList(model: model, files: details.files, source: .stash(sha))
                } else {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
        } else {
            ContentUnavailableView("Stash không còn tồn tại", systemImage: "archivebox")
        }
    }
}

private struct DetailContent: View {
    @Bindable var model: RepoModel
    let details: CommitDetails
    let source: DiffSource
    @State private var showFullBody = false

    var body: some View {
        let commit = details.commit
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 12) {
                actionBar(commit)
                // Không dùng fixedSize dọc: khi SwiftUI đo chiều cao tối thiểu của cột ở bề rộng rất hẹp, chữ dài
                // thành hàng trăm dòng → cả cửa sổ bị đẩy cao hơn màn hình và lệch lên dưới toolbar.
                Text(details.summary)
                    .font(.title3.weight(.semibold))
                    .textSelection(.enabled)
                    .lineLimit(4)
                if !details.body.isEmpty {
                    messageBody
                }
                HStack(spacing: 10) {
                    AvatarView(name: commit.authorName, email: commit.authorEmail, repo: model.githubRepo, size: 32)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(commit.authorName).font(.callout.weight(.semibold))
                        Text(commit.authorEmail).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(VietnameseDate.absolute(commit.authorDate)).font(.caption)
                        Text(VietnameseDate.relative(commit.authorDate))
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                }
                if commit.committerName != commit.authorName || commit.committerEmail != commit.authorEmail {
                    Text("Commit bởi \(commit.committerName) · \(VietnameseDate.absolute(commit.commitDate))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Text("commit").font(.caption).foregroundStyle(.secondary).frame(width: 46, alignment: .leading)
                        Text(String(commit.id.prefix(12))).font(.caption.monospaced()).textSelection(.enabled)
                        Button { model.copy(commit.id, label: "SHA") } label: { Image(systemName: "doc.on.doc") }
                            .buttonStyle(.borderless)
                            .help("Sao chép SHA đầy đủ")
                    }
                    if !commit.parents.isEmpty {
                        HStack(spacing: 6) {
                            Text("parent").font(.caption).foregroundStyle(.secondary)
                                .frame(width: 46, alignment: .leading)
                            ForEach(commit.parents, id: \.self) { parent in
                                Button(String(parent.prefix(7))) { model.reveal(commit: parent) }
                                    .buttonStyle(.link)
                                    .font(.caption.monospaced())
                                    .help("Tới commit parent")
                            }
                        }
                    }
                    if !commit.isWorkingTree {
                        // id theo commit: chọn commit khác thì trạng thái (đã ký? đã xác minh?) làm lại từ đầu.
                        SignatureRow(repository: model.repository, sha: commit.id)
                            .id(commit.id)
                    }
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            Divider()
            FileList(model: model, files: details.files, source: source)
        }
        .onChange(of: details.commit.id) { showFullBody = false }
    }

    @ViewBuilder
    private var messageBody: some View {
        let isLong = details.body.count > 280 || details.body.filter({ $0 == "\n" }).count > 6
        if showFullBody && isLong {
            ScrollView {
                Text(details.body)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxHeight: 260)
        } else {
            Text(details.body)
                .font(.callout)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
                .lineLimit(6)
        }
        if isLong {
            Button(showFullBody ? String(localized: "Thu gọn") : String(localized: "Xem toàn bộ mô tả")) { showFullBody.toggle() }
                .buttonStyle(.link)
                .font(.caption)
        }
    }

    @ViewBuilder
    private func actionBar(_ commit: Commit) -> some View {
        HStack(spacing: 4) {
            QuickButton(symbol: "arrow.triangle.branch", help: String(localized: "Tạo nhánh tại commit này")) { model.beginCreateBranch(at: commit) }
            QuickButton(symbol: "tag", help: String(localized: "Tạo tag tại commit này")) { model.beginCreateTag(at: commit) }
            QuickButton(symbol: "arrow.uturn.right", help: String(localized: "Checkout commit này")) {
                model.checkoutDetached(commit.id, label: "commit \(commit.shortSHA)")
            }
            .disabled(commit.id == model.headOID)
            QuickButton(symbol: "leaf", help: String(localized: "Cherry-pick vào nhánh hiện tại")) { model.cherryPick(commit) }
                .disabled(commit.id == model.headOID)
            QuickButton(symbol: "arrow.uturn.backward", help: String(localized: "Revert commit này…")) { model.revert(commit) }
            Spacer()
            if let url = model.webURL(forCommit: commit.id) {
                QuickButton(symbol: "safari", help: String(localized: "Mở trên web")) { NSWorkspace.shared.open(url) }
            }
            Menu {
                MenuSpecContent(items: model.menu(for: GraphEntry(commit: commit, row: GraphRow(lane: 0, color: 0, lines: [], width: 1),
                                                                  labels: model.entries.first { $0.commit.id == commit.id }?.labels ?? [])))
            } label: {
                Image(systemName: "ellipsis.circle")
            }
            .menuStyle(.borderlessButton)
            .fixedSize()
        }
    }
}

private struct QuickButton: View {
    let symbol: String
    let help: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .frame(width: 26, height: 22)
        }
        .glassButtonStyle()
        .controlSize(.small)
        .help(help)
    }
}

/// Danh sách file của một commit/stash; bấm để mở diff.
struct FileList: View {
    @Bindable var model: RepoModel
    let files: [FileChange]
    let source: DiffSource

    private var selection: Binding<String?> {
        Binding(
            get: {
                guard let open = model.openFile, open.source == source else { return nil }
                return open.change.path
            },
            set: { path in
                guard let path, let change = files.first(where: { $0.path == path }) else { return }
                model.openDiff(change, source: source)
            }
        )
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("\(files.count) file thay đổi")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                summary
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 7)
            List(selection: selection) {
                ForEach(files) { change in
                    FileRow(change: change)
                        .tag(change.path)
                }
            }
            .listStyle(.inset)
            .contextMenu(forSelectionType: String.self) { paths in
                if let path = paths.first, let change = files.first(where: { $0.path == path }) {
                    MenuSpecContent(items: model.fileMenu(change, source: source))
                }
            }
        }
    }

    private var summary: some View {
        let added = files.filter { $0.kind == .added || $0.kind == .untracked }.count
        let modified = files.filter { $0.kind == .modified || $0.kind == .renamed || $0.kind == .typeChanged }.count
        let deleted = files.filter { $0.kind == .deleted }.count
        return HStack(spacing: 8) {
            if added > 0 { Label("\(added)", systemImage: "plus").foregroundStyle(.green) }
            if modified > 0 { Label("\(modified)", systemImage: "pencil").foregroundStyle(.orange) }
            if deleted > 0 { Label("\(deleted)", systemImage: "minus").foregroundStyle(.red) }
        }
        .font(.caption.monospacedDigit())
        .labelStyle(.titleAndIcon)
    }
}

/// Dòng "chữ ký" của commit: biết commit có ký hay không ngay (đọc object, không chạy chương trình ngoài); bấm
/// "Xác minh" mới chạy gpg / ssh-keygen để kiểm.
private struct SignatureRow: View {
    let repository: GitRepository
    let sha: String
    @State private var format: SignatureFormat?
    @State private var verification: SignatureVerification?
    @State private var verifying = false

    var body: some View {
        if let format {
            HStack(spacing: 6) {
                Text("chữ ký").font(.caption).foregroundStyle(.secondary).frame(width: 46, alignment: .leading)
                Label(format.title, systemImage: "signature").font(.caption)
                if let verification {
                    result(verification)
                } else if verifying {
                    ProgressView().controlSize(.mini)
                } else {
                    Button("Xác minh") {
                        verifying = true
                        Task {
                            verification = await repository.verifySignature(of: sha)
                            verifying = false
                        }
                    }
                    .buttonStyle(.link)
                    .font(.caption)
                }
            }
        } else {
            Color.clear.frame(height: 0)
                .task(id: sha) {
                    verification = nil
                    format = await repository.signatureFormat(of: sha)
                }
        }
    }

    @ViewBuilder
    private func result(_ value: SignatureVerification) -> some View {
        switch value {
        case .good(let signer, _, let trusted):
            Label(trusted ? String(localized: "Hợp lệ") : String(localized: "Hợp lệ (khoá chưa tin cậy)"), systemImage: "checkmark.seal.fill")
                .font(.caption).foregroundStyle(trusted ? .green : .orange)
                .help(signer)
        case .bad:
            Label("Sai chữ ký", systemImage: "xmark.seal.fill").font(.caption).foregroundStyle(.red)
        case .expired:
            Label("Đã hết hạn", systemImage: "clock.badge.exclamationmark").font(.caption).foregroundStyle(.orange)
        case .revoked:
            Label("Khoá đã bị thu hồi", systemImage: "xmark.seal").font(.caption).foregroundStyle(.red)
        case .cannotCheck(let key):
            Label("Không kiểm được", systemImage: "questionmark.circle").font(.caption).foregroundStyle(.secondary)
                .help("Thiếu khoá công khai \(key) hoặc chưa cấu hình gpg.ssh.allowedSignersFile")
        case .unsigned:
            Text("Không có chữ ký").font(.caption).foregroundStyle(.secondary)
        }
    }
}
