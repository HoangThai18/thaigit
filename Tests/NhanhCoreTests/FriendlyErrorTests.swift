import Foundation
import Testing
@testable import NhanhCore

/// App rule: the UI never surfaces a raw error (git's stderr, a system error description, an error code, an exception).
@Suite("Thông báo lỗi thân thiện")
struct FriendlyErrorTests {
    private func git(_ stderr: String) -> GitError {
        GitError(arguments: ["push", "origin"], exitCode: 1, stdout: "", stderr: stderr)
    }

    @Test func familiarGitErrorsBecomePlainVietnamese() {
        let cases: [(String, String)] = [
            ("fatal: Authentication failed for 'https://github.com/x/y.git/'", "từ chối đăng nhập"),
            ("fatal: unable to access 'https://x/': Could not resolve host: x", "Không kết nối được"),
            ("remote: Repository not found.", "Không tìm thấy repository trên remote"),
            ("fatal: Unable to create '/r/.git/index.lock': File exists.", "file khoá .lock"),
            ("error: Your local changes to the following files would be overwritten by checkout", "chưa commit"),
            ("CONFLICT (content): Merge conflict in a.txt", "xung đột"),
            (" ! [rejected]        main -> main (fetch first)", "pull trước"),
            ("error: the branch 'x' is not fully merged", "chưa được merge"),
            ("Author identity unknown\n*** Please tell me who you are.", "user.name"),
            ("error: gpg failed to sign the data", "ký được commit"),
        ]
        for (stderr, expected) in cases {
            let message = FriendlyError.message(for: git(stderr))
            #expect(message.contains(expected), "\(stderr) → \(message)")
            #expect(!message.contains("fatal") && !message.contains("error:"))
        }
        #expect(FriendlyError.message(for: git("fatal: something nobody expected")) == FriendlyError.gitFailed)
    }

    @Test func systemAndNetworkErrorsNeverLeakTheirDescription() {
        let posix = NSError(domain: NSPOSIXErrorDomain, code: 13, userInfo: [NSLocalizedDescriptionKey: "Permission denied (os error 13)"])
        #expect(FriendlyError.message(for: posix) == FriendlyError.fileAccess)
        #expect(FriendlyError.message(for: CocoaError(.fileWriteOutOfSpace)) == FriendlyError.fileAccess)
        #expect(FriendlyError.message(for: URLError(.notConnectedToInternet)) == FriendlyError.network)
        #expect(FriendlyError.message(for: URLError(.cancelled)) == FriendlyError.cancelled)
        #expect(FriendlyError.message(for: CancellationError()) == FriendlyError.cancelled)
        let launch = ProcessLaunchError(executable: "/usr/bin/git", underlying: "The file “git” doesn’t exist.")
        #expect(!FriendlyError.message(for: launch).contains("doesn’t exist"))
        struct Strange: Error {}
        #expect(FriendlyError.message(for: Strange()) == FriendlyError.unexpected)
    }

    @Test func appErrorsWithEmbeddedDetailsAreReworded() {
        #expect(!FriendlyError.message(for: GitHubError.network("The Internet connection appears to be offline.")).contains("offline"))
        #expect(!FriendlyError.message(for: GitHubError.badResponse(502)).contains("502"))
        #expect(!FriendlyError.message(for: GitHubError.keychain(-25300)).contains("25300"))
        #expect(!FriendlyError.message(for: UpdateError.cannotInstall("errno 1")).contains("errno"))
        #expect(!FriendlyError.message(for: JiraError.network("timed out")).contains("timed out"))
        #expect(FriendlyError.message(for: GitHubRepoAPIError.rejected("A pull request already exists for x:y.")) == "Đã có Pull Request cho nhánh này.")
        #expect(!FriendlyError.message(for: GitHubRepoAPIError.rejected("Validation Failed: head sha")).contains("Validation"))
    }

    @Test func authoredMessagesStayAsWritten() {
        #expect(FriendlyError.message(for: RepositoryError.invalidName("a b")) == "Tên “a b” không hợp lệ.")
        #expect(FriendlyError.message(for: GitHubError.expired) == "Mã xác nhận đã hết hạn — hãy đăng nhập lại để lấy mã mới.")
        let flow = GitFlowStepError(step: "merge release/1.0 vào main", remaining: ["tag v1.0"], underlying: "CONFLICT (content): Merge conflict in a.txt")
        let message = FriendlyError.message(for: flow)
        #expect(message.hasPrefix("Dừng ở bước: merge release/1.0 vào main. Còn lại: tag v1.0."))
        #expect(message.contains("xung đột") && !message.contains("CONFLICT"))
    }
}
