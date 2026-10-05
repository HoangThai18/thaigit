import Foundation
import NhanhCore
#if canImport(FoundationModels)
import FoundationModels
#endif

/// Writes commit messages with a language model running ENTIRELY ON THE MACHINE (Apple Intelligence, macOS 26+): the
/// diff never leaves the machine and no account or API key is needed.
enum CommitMessageAI {
    /// Master switch: currently TEMPORARILY OFF — the ✨ button and the ⌘P palette command are hidden. To re-enable: change this to `true`.
    static let isEnabled = false

    /// nil when it can be used; otherwise the reason (shown in the button's tooltip).
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

    /// Returns (summary, body) for the staged changes.
    static func suggest(for repository: GitRepository) async throws -> (summary: String, body: String) {
        let staged = try await repository.stagedChangesForPrompt()
        guard !staged.patch.isEmpty else { throw AIError.nothingStaged }
        let subjects = await repository.recentSubjects()
        #if canImport(FoundationModels)
        if #available(macOS 26.0, *) {
            let model = SystemLanguageModel(guardrails: .permissiveContentTransformations)
            var patch = staged.patch
            // A diff too long for the context window: retry with a shorter one (still keeping stats for every file).
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
    /// Fill in the commit message the on-device AI wrote; keep the old one so it can be undone.
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
