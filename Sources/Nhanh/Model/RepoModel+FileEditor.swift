import AppKit
import NhanhCore
import SwiftUI

/// A file being edited right in the app (the "Edit" button on an unstaged change's diff, like GitKraken).
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
    /// Editable in-app: a file in the working tree (unstaged, or new), not a deleted file.
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
            let message = FriendlyError.message(for: error)
            toast(.warning, String(localized: "Không sửa được \(file.change.fileName) trong app"), message: message, actions: [
                ToastAction(title: String(localized: "Mở bằng trình soạn thảo")) { [weak self] in self?.openInEditor(path: file.change.path) },
            ])
        }
    }

    /// Save the file being edited. If it changed elsewhere since it was opened, ask before overwriting.
    func saveEditor(overwrite: Bool = false) {
        guard let session = fileEditor, !session.isSaving else { return }
        session.isSaving = true
        defer { session.isSaving = false }
        do {
            let saved = try session.file.save(session.text, in: repository.root, overwrite: overwrite)
            session.didSave(saved)
            toast(.success, String(localized: "Đã lưu \((session.path as NSString).lastPathComponent)"), tag: "editor")
            requestRefresh(.status)
            loadDiff()
        } catch EditableTextFile.Problem.changedOnDisk {
            confirmation = Confirmation(
                title: String(localized: "Ghi đè \((session.path as NSString).lastPathComponent)?"),
                message: String(localized: "File vừa bị sửa ở nơi khác (trình soạn thảo, lệnh git…) sau khi bạn mở. Lưu bây giờ sẽ thay bằng bản của bạn."),
                confirmTitle: String(localized: "Ghi đè"),
                isDestructive: true
            ) { [weak self] in
                self?.saveEditor(overwrite: true)
            }
        } catch {
            showError(String(localized: "Không lưu được \((session.path as NSString).lastPathComponent)"), error)
        }
    }

    /// Stop editing: ask first when there are unsaved changes.
    func cancelEditing() {
        guard let session = fileEditor else { return }
        guard session.isDirty else {
            fileEditor = nil
            return
        }
        confirmation = Confirmation(
            title: String(localized: "Bỏ các thay đổi chưa lưu?"),
            message: String(localized: "Những gì bạn vừa gõ trong \((session.path as NSString).lastPathComponent) sẽ mất."),
            confirmTitle: String(localized: "Bỏ thay đổi"),
            isDestructive: true
        ) { [weak self] in
            self?.fileEditor = nil
        }
    }

    /// Called when switching to another file / closing the diff: an unsaved edit is kept and the user is reminded to come back and save.
    func editorWillLeave(to next: OpenFile?) {
        guard let session = fileEditor, next?.change.path != session.path || next?.source != .unstaged else { return }
        guard session.isDirty else {
            fileEditor = nil
            return
        }
        let path = session.path
        toast(.warning, String(localized: "\((path as NSString).lastPathComponent) còn thay đổi chưa lưu"), message: String(localized: "Bản đang sửa vẫn được giữ."),
              actions: [ToastAction(title: String(localized: "Quay lại sửa")) { [weak self] in self?.reopenEditor(path: path) }], tag: "editor")
    }

    private func reopenEditor(path: String) {
        let change = status.unstaged.first { $0.path == path } ?? FileChange(path: path, kind: .modified)
        openDiff(change, source: .unstaged)
    }
}
