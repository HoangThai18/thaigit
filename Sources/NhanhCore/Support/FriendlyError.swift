import Foundation

/// Lỗi mà mô tả (`userMessage`) đã là câu tiếng Việt do Thaigit tự soạn, không chèn lỗi hệ thống — hiện thẳng được.
public protocol UserFacingError: Error {
    var userMessage: String { get }
}

/// Chuyển MỌI lỗi thành một câu tiếng Việt dễ hiểu. Quy tắc của app: giao diện không bao giờ hiện stderr của git, mô tả lỗi của
/// hệ điều hành, mã lỗi hay nội dung exception — người dùng chỉ thấy câu ở đây. Chi tiết kỹ thuật vẫn xem được trong
/// "Nhật ký lệnh git" (người dùng tự mở).
public enum FriendlyError {
    public static let unexpected = String(localized: "Đã xảy ra lỗi không mong muốn. Hãy thử lại; nếu vẫn lỗi, khởi động lại Thaigit.")
    public static let gitFailed = String(localized: "Git không thực hiện được thao tác này. Xem chi tiết trong “Nhật ký lệnh git” (nút Mở ▸ Nhật ký lệnh git…).")
    public static let cancelled = String(localized: "Thao tác đã được huỷ.")
    public static let network = String(localized: "Không kết nối được — kiểm tra mạng rồi thử lại.")
    public static let fileAccess = String(localized: "Không đọc / ghi được file trên máy — kiểm tra quyền truy cập và dung lượng ổ đĩa.")

    /// Mẫu lỗi git quen thuộc → câu thân thiện (theo thứ tự ưu tiên; so không phân biệt hoa thường).
    static let gitPatterns: [(needles: [String], message: String)] = [
        (["Please tell me who you are", "empty ident", "unable to auto-detect email address"],
         String(localized: "Chưa đặt tên và email cho git — chạy git config --global user.name / user.email rồi thử lại.")),
        (["Authentication failed", "could not read Username", "could not read Password", "Permission denied (publickey",
          "returned error: 401", "returned error: 403", "terminal prompts disabled", "Invalid username or password"],
         String(localized: "Remote từ chối đăng nhập — kiểm tra tài khoản / token rồi thử lại.")),
        (["Repository not found", "does not appear to be a git repository", "returned error: 404"],
         String(localized: "Không tìm thấy repository trên remote — sai địa chỉ hoặc tài khoản không có quyền.")),
        (["Could not resolve host", "Connection timed out", "Connection refused", "Failed to connect", "unable to access",
          "Network is unreachable"],
         String(localized: "Không kết nối được tới remote — kiểm tra mạng rồi thử lại.")),
        ([".lock': File exists", "index.lock", "Unable to create", "cannot lock ref"],
         String(localized: "Một tiến trình git khác đang chạy trong repository (file khoá .lock) — đợi nó xong rồi thử lại.")),
        (["would be overwritten", "Please commit your changes or stash them", "Your local changes"],
         String(localized: "Có thay đổi chưa commit chặn thao tác này — commit hoặc stash trước.")),
        (["CONFLICT", "Resolve all conflicts", "could not apply", "unmerged files", "you need to resolve"],
         String(localized: "Có xung đột cần giải quyết trước.")),
        (["Not possible to fast-forward", "divergent"], String(localized: "Nhánh local và remote đã tách nhau.")),
        (["[rejected]", "non-fast-forward", "fetch first", "stale info"], String(localized: "Remote có commit mới mà máy bạn chưa có — hãy pull trước.")),
        (["not fully merged"], String(localized: "Nhánh có commit chưa được merge.")),
        (["no upstream", "has no upstream"], String(localized: "Nhánh chưa có nhánh tương ứng trên remote.")),
        (["nothing to commit", "nothing added to commit"], String(localized: "Không có gì để commit.")),
        (["already exists"], String(localized: "Tên này đã tồn tại.")),
        (["gpg failed", "failed to sign", "signing failed", "error: Load key"], String(localized: "Không ký được commit — kiểm tra cấu hình khoá GPG / SSH.")),
        (["hook declined", "pre-commit hook", "pre-push hook", "commit-msg hook"], String(localized: "Hook của repository đã từ chối thao tác này.")),
        (["No space left"], String(localized: "Ổ đĩa đã đầy.")),
        (["Permission denied", "Operation not permitted"], String(localized: "Không có quyền truy cập file hoặc thư mục.")),
        (["unknown revision", "invalid reference", "not a valid", "did not match any", "bad revision", "ambiguous argument"],
         String(localized: "Không tìm thấy nhánh, commit hoặc file được chỉ định.")),
        (["git-lfs", "git: 'lfs' is not a git command"], String(localized: "Chưa cài Git LFS — cài bằng brew install git-lfs rồi chạy git lfs install.")),
    ]

    /// Câu thân thiện cho output của một lệnh git thất bại.
    public static func gitMessage(forOutput output: String) -> String {
        for pattern in gitPatterns where pattern.needles.contains(where: { output.range(of: $0, options: .caseInsensitive) != nil }) {
            return pattern.message
        }
        return gitFailed
    }

    /// Câu thân thiện cho một lỗi bất kỳ.
    public static func message(for error: any Error) -> String {
        switch error {
        case let error as UserFacingError: return error.userMessage
        case is CancellationError: return cancelled
        case let error as GitError: return gitMessage(forOutput: error.combinedOutput)
        case let error as GitFlowStepError: return error.userMessage
        case let error as UpdateError: return message(for: error)
        case let error as GitHubError: return message(for: error)
        case let error as GitHubRepoAPIError: return message(for: error)
        case let error as JiraError: return message(for: error)
        case is ProcessLaunchError: return String(localized: "Không chạy được công cụ cần thiết (git / git-lfs…) — kiểm tra đã cài đặt.")
        case let error as URLError: return error.code == .cancelled ? cancelled : network
        case is CocoaError: return fileAccess
        default:
            let domain = (error as NSError).domain
            if domain == NSPOSIXErrorDomain || domain == NSCocoaErrorDomain { return fileAccess }
            if domain == NSURLErrorDomain { return network }
            return unexpected
        }
    }

    static func message(for error: UpdateError) -> String {
        switch error {
        case .badResponse: return String(localized: "Máy chủ cập nhật đang gặp sự cố — thử lại sau.")
        case .invalidManifest, .untrustedURL, .invalidBundle: return String(localized: "Thông tin bản cập nhật không hợp lệ nên Thaigit bỏ qua bản này.")
        case .archiveTooLarge, .checksumMismatch: return String(localized: "File cập nhật tải về bị hỏng — thử lại sau.")
        case .badSignature: return String(localized: "Chữ ký của bản cập nhật không hợp lệ — file có thể đã bị sửa nên không cài.")
        case .cannotInstall: return String(localized: "Không cài được bản cập nhật — thử thoát Thaigit rồi mở lại.")
        }
    }

    static func message(for error: GitHubError) -> String {
        switch error {
        case .notConfigured: return String(localized: "Đăng nhập GitHub chưa được cấu hình trong bản Thaigit này.")
        case .expired: return String(localized: "Mã xác nhận đã hết hạn — hãy đăng nhập lại để lấy mã mới.")
        case .accessDenied: return String(localized: "Bạn đã từ chối cấp quyền cho Thaigit trên GitHub.")
        case .unauthorized: return String(localized: "Token GitHub không còn hợp lệ — đăng nhập lại.")
        case .network: return String(localized: "Không kết nối được tới GitHub — kiểm tra mạng rồi thử lại.")
        case .badResponse, .invalidResponse: return String(localized: "GitHub đang gặp sự cố — thử lại sau.")
        case .oauth: return String(localized: "GitHub từ chối đăng nhập — thử đăng nhập lại.")
        case .keychain: return String(localized: "Không truy cập được Keychain — mở khoá Keychain rồi thử lại.")
        }
    }

    static func message(for error: GitHubRepoAPIError) -> String {
        switch error {
        case .rejected(let text):
            // Thông báo của GitHub (tiếng Anh): chỉ nhận vài trường hợp quen thuộc.
            if text.range(of: "already exists", options: .caseInsensitive) != nil { return String(localized: "Đã có Pull Request cho nhánh này.") }
            if text.range(of: "No commits between", options: .caseInsensitive) != nil {
                return String(localized: "Hai nhánh không có commit nào khác nhau nên chưa tạo được Pull Request.")
            }
            return String(localized: "GitHub từ chối yêu cầu — kiểm tra lại thông tin rồi thử lại.")
        default:
            return error.errorDescription ?? unexpected
        }
    }

    static func message(for error: JiraError) -> String {
        switch error {
        case .network: return String(localized: "Không kết nối được tới Jira — kiểm tra mạng rồi thử lại.")
        case .badResponse, .invalidResponse: return String(localized: "Jira đang gặp sự cố — thử lại sau.")
        default: return error.errorDescription ?? unexpected
        }
    }
}

extension RepositoryError: UserFacingError {
    public var userMessage: String { errorDescription ?? FriendlyError.unexpected }
}

extension RebaseError: UserFacingError {
    public var userMessage: String { errorDescription ?? FriendlyError.unexpected }
}

extension GitFlowStepError {
    /// "Dừng ở bước …" + câu thân thiện thay cho output thô của git.
    public var userMessage: String {
        var text = String(localized: "Dừng ở bước: \(step).")
        if !remaining.isEmpty { text += String(localized: " Còn lại: ") + remaining.joined(separator: "; ") + "." }
        return text + "\n" + FriendlyError.gitMessage(forOutput: underlying)
    }
}
