import AppKit
import NhanhCore
import SwiftUI

/// File đang sửa ngay trong app (nút "Sửa" trên diff của thay đổi chưa stage, như GitKraken).
@Observable
final class FileEditorSession {
    private(set) var file: EditableTextFile
    var text: String
    var isSaving = false

    init(file: EditableTextFile) {
        self.file = file
        text = file.text
    }

    var path: String { file.path }
    var isDirty: Bool { text != file.text }

    func didSave(_ saved: EditableTextFile) {
        file = saved
        text = saved.text
    }
}

extension RepoModel {
    /// Sửa được trong app: file trong working tree (chưa stage hoặc file mới), không phải file đã xoá.
    func canEditInApp(_ file: OpenFile) -> Bool {
        file.source == .unstaged && file.change.kind != .deleted && file.change.kind != .conflicted
    }

    func isEditing(_ file: OpenFile) -> Bool {
        fileEditor?.path == file.change.path && file.source == .unstaged
    }

    func beginEditing(_ file: OpenFile) {
        if let session = fileEditor, session.path == file.change.path { return }
        do {
            fileEditor = FileEditorSession(file: try EditableTextFile.open(path: file.change.path, in: repository.root))
        } catch {
            let message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            toast(.warning, "Không sửa được \(file.change.fileName) trong app", message: message, actions: [
                ToastAction(title: "Mở bằng trình soạn thảo") { [weak self] in self?.openInEditor(path: file.change.path) },
            ])
        }
    }

    /// Lưu file đang sửa. File bị sửa ở nơi khác sau khi mở thì hỏi trước khi ghi đè.
    func saveEditor(overwrite: Bool = false) {
        guard let session = fileEditor, !session.isSaving else { return }
        session.isSaving = true
        defer { session.isSaving = false }
        do {
            let saved = try session.file.save(session.text, in: repository.root, overwrite: overwrite)
            session.didSave(saved)
            toast(.success, "Đã lưu \((session.path as NSString).lastPathComponent)", tag: "editor")
            requestRefresh(.status)
            loadDiff()
        } catch EditableTextFile.Problem.changedOnDisk {
            confirmation = Confirmation(
                title: "Ghi đè \((session.path as NSString).lastPathComponent)?",
                message: "File vừa bị sửa ở nơi khác (trình soạn thảo, lệnh git…) sau khi bạn mở. Lưu bây giờ sẽ thay bằng bản của bạn.",
                confirmTitle: "Ghi đè",
                isDestructive: true
            ) { [weak self] in
                self?.saveEditor(overwrite: true)
            }
        } catch {
            showError("Không lưu được \((session.path as NSString).lastPathComponent)", error)
        }
    }

    /// Thôi sửa: còn thay đổi chưa lưu thì hỏi trước.
    func cancelEditing() {
        guard let session = fileEditor else { return }
        guard session.isDirty else {
            fileEditor = nil
            return
        }
        confirmation = Confirmation(
            title: "Bỏ các thay đổi chưa lưu?",
            message: "Những gì bạn vừa gõ trong \((session.path as NSString).lastPathComponent) sẽ mất.",
            confirmTitle: "Bỏ thay đổi",
            isDestructive: true
        ) { [weak self] in
            self?.fileEditor = nil
        }
    }

    /// Gọi khi chuyển sang file khác / đóng diff: bản sửa chưa lưu được giữ lại và nhắc người dùng quay lại lưu.
    func editorWillLeave(to next: OpenFile?) {
        guard let session = fileEditor, next?.change.path != session.path || next?.source != .unstaged else { return }
        guard session.isDirty else {
            fileEditor = nil
            return
        }
        let path = session.path
        toast(.warning, "\((path as NSString).lastPathComponent) còn thay đổi chưa lưu", message: "Bản đang sửa vẫn được giữ.",
              actions: [ToastAction(title: "Quay lại sửa") { [weak self] in self?.reopenEditor(path: path) }], tag: "editor")
    }

    private func reopenEditor(path: String) {
        let change = status.unstaged.first { $0.path == path } ?? FileChange(path: path, kind: .modified)
        openDiff(change, source: .unstaged)
    }
}
