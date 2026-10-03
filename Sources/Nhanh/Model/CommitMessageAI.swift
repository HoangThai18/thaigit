import Foundation
import NhanhCore
#if canImport(FoundationModels)
import FoundationModels
#endif

/// Viết commit message bằng mô hình ngôn ngữ chạy NGAY TRÊN MÁY (Apple Intelligence, macOS 26+): diff không rời khỏi
/// máy, không cần tài khoản hay API key.
enum CommitMessageAI {
    /// Công tắc chung: đang TẠM TẮT — nút ✨ và lệnh trong bảng lệnh ⌘P đều ẩn. Bật lại: đổi thành `true`.
    static let isEnabled = false

    /// nil nếu dùng được; không thì lý do (hiện trong tooltip của nút).
    static var unavailableReason: String? {
        #if canImport(FoundationModels)
        if #available(macOS 26.0, *) {
            switch SystemLanguageModel.default.availability {
            case .available:
                return nil
            case .unavailable(.deviceNotEligible):
                return String(localized: "Máy này không hỗ trợ Apple Intelligence")
            case .unavailable(.appleIntelligenceNotEnabled):
                return String(localized: "Bật Apple Intelligence trong Cài đặt hệ thống để dùng")
            case .unavailable(.modelNotReady):
                return String(localized: "Mô hình Apple Intelligence đang tải về — thử lại sau")
            case .unavailable:
                return String(localized: "Apple Intelligence chưa sẵn sàng")
            }
        }
        #endif
        return String(localized: "Cần macOS 26 trở lên (Apple Intelligence)")
    }

    /// Trả về (tóm tắt, phần thân) cho thay đổi đã stage.
    static func suggest(for repository: GitRepository) async throws -> (summary: String, body: String) {
        let staged = try await repository.stagedChangesForPrompt()
        guard !staged.patch.isEmpty else { throw AIError.nothingStaged }
        let subjects = await repository.recentSubjects()
        #if canImport(FoundationModels)
        if #available(macOS 26.0, *) {
            let model = SystemLanguageModel(guardrails: .permissiveContentTransformations)
            var patch = staged.patch
            // Diff quá dài so với cửa sổ ngữ cảnh: thử lại với phần diff ngắn hơn (vẫn giữ thống kê đủ các file).
            for _ in 0..<3 {
                let session = LanguageModelSession(model: model, instructions: "Bạn là trợ lý viết commit message git ngắn gọn, chính xác.")
                do {
                    let response = try await session.respond(to: CommitPrompt.build(stat: staged.stat, patch: patch, recentSubjects: subjects),
                                                             options: GenerationOptions(temperature: 0.3))
                    let parsed = CommitPrompt.parse(response.content)
                    guard !parsed.summary.isEmpty else { throw AIError.emptyAnswer }
                    return parsed
                } catch LanguageModelSession.GenerationError.exceededContextWindowSize {
                    patch = String(patch.prefix(max(500, min(patch.count, CommitPrompt.maxPatchCharacters) / 2)))
                }
            }
            throw AIError.tooLarge
        }
        #endif
        throw AIError.unavailable(unavailableReason ?? "")
    }

    enum AIError: LocalizedError, UserFacingError {
        case nothingStaged
        case emptyAnswer
        case tooLarge
        case unavailable(String)

        var userMessage: String {
            let text = errorDescription ?? ""
            return text.isEmpty ? String(localized: "Apple Intelligence chưa sẵn sàng trên máy này.") : text
        }

        var errorDescription: String? {
            switch self {
            case .nothingStaged: return String(localized: "Chưa có thay đổi nào được stage.")
            case .emptyAnswer: return String(localized: "AI không đưa ra được commit message — thử lại.")
            case .tooLarge: return String(localized: "Thay đổi quá lớn để AI trên máy đọc hết — hãy commit thành nhiều phần nhỏ.")
            case .unavailable(let reason): return reason
            }
        }
    }
}

extension RepoModel {
    /// Điền commit message do AI trên máy viết; giữ lại bản cũ để hoàn tác.
    func fillCommitMessageWithAI() async {
        let previous = (commitSummary, commitBody)
        do {
            let suggestion = try await CommitMessageAI.suggest(for: repository)
            commitSummary = suggestion.summary
            commitBody = suggestion.body
            toast(.success, String(localized: "AI đã viết commit message — xem lại trước khi commit"), actions: previous.0.isEmpty && previous.1.isEmpty ? [] : [
                ToastAction(title: String(localized: "Hoàn tác")) { [weak self] in
                    self?.commitSummary = previous.0
                    self?.commitBody = previous.1
                },
            ], tag: "ai")
        } catch {
            showError(String(localized: "AI chưa viết được commit message"), error)
        }
    }
}
