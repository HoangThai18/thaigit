import Foundation

/// Login + token của một tài khoản GitHub. In ra (description, dump, thông báo lỗi của test) không bao giờ lộ token.
public struct GitHubCredential: Sendable, Equatable, CustomStringConvertible, CustomDebugStringConvertible, CustomReflectable {
    public let login: String
    public let token: String

    /// nil nếu login/token rỗng hoặc chứa ký tự điều khiển / khoảng trắng (giao thức credential của git là từng dòng
    /// `key=value`, xuống dòng sẽ chèn được dòng lạ).
    public init?(login: String, token: String) {
        guard Self.isSafe(login), Self.isSafe(token) else { return nil }
        self.login = login
        self.token = token
    }

    private static func isSafe(_ value: String) -> Bool {
        !value.isEmpty && !value.unicodeScalars.contains { CharacterSet.controlCharacters.contains($0) || $0 == " " }
    }

    public var description: String { "GitHubCredential(@\(login), token: <ẩn>)" }
    public var debugDescription: String { description }
    public var customMirror: Mirror { Mirror(self, children: ["login": login, "token": "<ẩn>"]) }
}

/// Các tài khoản đã nạp được token + bảng owner → tài khoản, đưa cho credential helper của Thaigit.
public struct GitHubCredentialSet: Sendable, Equatable {
    /// Đường dẫn script `github-credential.sh` (xem `GitHubCredentialHelper`).
    public let helperPath: String
    /// Thứ tự = chỉ số i trong biến môi trường `THAIGIT_GITHUB_USER_i` / `THAIGIT_GITHUB_TOKEN_i`.
    public let accounts: [GitHubCredential]
    /// owner (viết thường) → login. Owner không có trong bảng dùng tài khoản mặc định.
    public let owners: [String: String]
    public let defaultLogin: String

    /// Dựng từ danh sách tài khoản + token đã nạp (login → token). nil nếu chưa tài khoản nào có token.
    /// Tài khoản không có token bị bỏ khỏi bảng, owner của nó rơi về tài khoản khác theo đúng thứ tự ưu tiên.
    public init?(helperPath: String, state: GitHubAccountsState, tokens: [String: String]) {
        let available = state.profiles.compactMap { profile in
            tokens[profile.login].flatMap { GitHubCredential(login: profile.login, token: $0) }
        }
        let usable = state.restricted(to: Set(available.map(\.login)))
        guard let defaultProfile = usable.defaultProfile else { return nil }
        self.helperPath = helperPath
        accounts = available
        owners = usable.ownerTable
        defaultLogin = defaultProfile.login
    }

    /// Tài khoản cho owner — đúng như script helper chọn (khớp bảng, không thì mặc định).
    public func credential(forOwner owner: String?) -> GitHubCredential {
        let login = owner.flatMap(GitHubAccountsState.normalizedOwner).flatMap { owners[$0] } ?? defaultLogin
        return accounts.first { $0.login == login } ?? accounts.first { $0.login == defaultLogin } ?? accounts[0]
    }
}

/// Đưa token GitHub cho git mà không ghi vào cấu hình hay tham số lệnh.
///
/// Chỉ với lệnh mạng và chỉ khi đã có tài khoản, `GitRunner` thêm:
///
///     -c credential.https://github.com.helper=
///     -c credential.https://github.com.helper=!'<Application Support>/Thaigit/github-credential.sh'
///     -c credential.https://github.com.useHttpPath=true
///
/// Giá trị rỗng xoá các helper của người dùng nhưng CHỈ với URL https://github.com (git so khớp cấu hình theo URL),
/// host khác (gitlab.com…) vẫn dùng helper sẵn có. `useHttpPath` để git gửi `path=owner/repo` cho helper — helper chọn
/// token theo owner. Token nằm trong biến môi trường của riêng tiến trình git đó; tham số lệnh (và nhật ký lệnh) chỉ có
/// đường dẫn script.
public enum GitCredentialInjection {
    public static let helperKey = "credential.https://github.com.helper"
    public static let useHttpPathKey = "credential.https://github.com.useHttpPath"
    public static let accountCountVariable = "THAIGIT_GITHUB_ACCOUNTS"
    public static let ownersVariable = "THAIGIT_GITHUB_OWNERS"
    public static let defaultVariable = "THAIGIT_GITHUB_DEFAULT"
    public static func userVariable(_ index: Int) -> String { "THAIGIT_GITHUB_USER_\(index)" }
    public static func tokenVariable(_ index: Int) -> String { "THAIGIT_GITHUB_TOKEN_\(index)" }

    public struct Additions: Sendable, Equatable {
        /// Đặt TRƯỚC tên lệnh git (tuỳ chọn `-c` toàn cục).
        public var arguments: [String]
        public var environment: [String: String]

        public init(arguments: [String], environment: [String: String]) {
            self.arguments = arguments
            self.environment = environment
        }

        public static let none = Additions(arguments: [], environment: [:])
        public var isEmpty: Bool { arguments.isEmpty && environment.isEmpty }
    }

    /// Phần thêm vào lệnh `arguments`. Chưa có tài khoản thì không thêm gì: helper trả lời rỗng sẽ làm hỏng xác thực
    /// bằng helper riêng của người dùng.
    public static func additions(for arguments: [String], credentials: GitHubCredentialSet?) -> Additions {
        guard let credentials, !credentials.accounts.isEmpty, isNetworkCommand(arguments) else { return .none }
        var environment = [accountCountVariable: String(credentials.accounts.count)]
        var indexByLogin: [String: Int] = [:]
        for (index, account) in credentials.accounts.enumerated() {
            environment[userVariable(index)] = account.login
            environment[tokenVariable(index)] = account.token
            indexByLogin[account.login] = index
        }
        environment[defaultVariable] = String(indexByLogin[credentials.defaultLogin] ?? 0)
        environment[ownersVariable] = credentials.owners
            .compactMap { owner, login in indexByLogin[login].map { "\(owner):\($0)" } }
            .sorted()
            .joined(separator: ",")
        return Additions(
            arguments: [
                "-c", helperKey + "=",
                "-c", helperKey + "=" + GitHubCredentialHelper.configValue(path: credentials.helperPath),
                "-c", useHttpPathKey + "=true",
            ],
            environment: environment
        )
    }

    /// Lệnh có thể cần xác thực với remote: fetch, pull, push, clone, ls-remote, remote update, submodule update.
    public static func isNetworkCommand(_ arguments: [String]) -> Bool {
        var index = arguments.startIndex
        // Bỏ qua tuỳ chọn toàn cục đặt trước tên lệnh (`-c key=value`, `-C dir`, `--no-pager`…).
        while index < arguments.endIndex, arguments[index].hasPrefix("-") {
            index += (arguments[index] == "-c" || arguments[index] == "-C") ? 2 : 1
        }
        guard index < arguments.endIndex else { return false }
        let firstOperand = arguments[(index + 1)...].first { !$0.hasPrefix("-") }
        switch arguments[index] {
        case "fetch", "pull", "push", "clone", "ls-remote": return true
        case "remote", "submodule": return firstOperand == "update"
        default: return false
        }
    }
}

/// Script credential helper cho https://github.com, cài vào `~/Library/Application Support/Thaigit/` (như askpass.sh).
public enum GitHubCredentialHelper {
    public static let fileName = "github-credential.sh"

    public static let script = #"""
    #!/bin/sh
    # Thaigit — credential helper cho https://github.com (git gọi: <script> get|store|erase).
    # Chọn tài khoản theo owner trong path=owner/repo (git gửi path nhờ credential.https://github.com.useHttpPath=true):
    # bảng THAIGIT_GITHUB_OWNERS="owner:i,…" → tài khoản i; không khớp thì THAIGIT_GITHUB_DEFAULT. Username / token
    # của tài khoản i nằm trong THAIGIT_GITHUB_USER_i / THAIGIT_GITHUB_TOKEN_i — biến môi trường của riêng tiến trình
    # git, không ghi ra đĩa. Chỉ trả lời "get": store / erase bỏ qua để token không bị chép vào helper khác (osxkeychain)
    # và token người dùng tự lưu không bị xoá.
    [ "$1" = "get" ] || exit 0
    set -f
    owner=""
    while IFS= read -r line; do
      [ -n "$line" ] || break
      case "$line" in
        path=*) owner=${line#path=}; owner=${owner#/}; owner=${owner%%/*} ;;
      esac
    done
    owner=$(printf '%s' "$owner" | /usr/bin/tr '[:upper:]' '[:lower:]')
    index=${THAIGIT_GITHUB_DEFAULT:-0}
    if [ -n "$owner" ]; then
      IFS=,
      for pair in $THAIGIT_GITHUB_OWNERS; do
        if [ "${pair%%:*}" = "$owner" ]; then
          index=${pair#*:}
          break
        fi
      done
      unset IFS
    fi
    case "$index" in
      ''|*[!0-9]*) exit 0 ;;
    esac
    [ "$index" -lt "${THAIGIT_GITHUB_ACCOUNTS:-0}" ] 2>/dev/null || exit 0
    eval "user=\${THAIGIT_GITHUB_USER_$index-}"
    eval "token=\${THAIGIT_GITHUB_TOKEN_$index-}"
    [ -n "$user" ] && [ -n "$token" ] || exit 0
    printf 'username=%s\npassword=%s\n' "$user" "$token"

    """#

    /// Thư mục cài mặc định: ~/Library/Application Support/Thaigit.
    public static func defaultDirectory() -> URL? {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
            .appendingPathComponent("Thaigit", isDirectory: true)
    }

    /// Ghi script (quyền 0755) vào `directory` nếu nội dung khác bản hiện có; trả về đường dẫn.
    @discardableResult
    public static func install(in directory: URL) throws -> URL {
        let fileManager = FileManager.default
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appendingPathComponent(fileName)
        let data = Data(script.utf8)
        if (try? Data(contentsOf: url)) != data {
            try data.write(to: url, options: .atomic)
        }
        try fileManager.setAttributes([.posixPermissions: 0o755], ofItemAtPath: url.path)
        return url
    }

    /// Giá trị `credential.<url>.helper`: `!'<đường dẫn>'`. Git chạy qua shell (`'<đường dẫn>' get`), nháy đơn giữ
    /// nguyên dấu cách trong "Application Support"; dấu nháy đơn trong đường dẫn được thoát thành `'\''`.
    public static func configValue(path: String) -> String {
        "!'" + path.replacingOccurrences(of: "'", with: #"'\''"#) + "'"
    }
}

/// Lỗi xác thực / quyền khi fetch / pull / push tới remote HTTPS trên github.com — để gợi ý đăng nhập hoặc đổi tài khoản.
public struct GitHubAuthFailure: Sendable, Equatable {
    public enum Kind: Sendable, Equatable {
        /// Thiếu hoặc sai thông tin đăng nhập (401, không có helper nào trả lời…).
        case unauthenticated
        /// Đăng nhập được nhưng không có quyền (403 "Permission to … denied").
        case forbidden
        /// GitHub trả "Repository not found" (404) — repo riêng tư mà tài khoản đang dùng không thấy.
        case notFound
    }

    public let kind: Kind
    /// Owner trong URL bị từ chối (`https://github.com/<owner>/…`), nếu đọc được.
    public let owner: String?

    public init(kind: Kind, owner: String?) {
        self.kind = kind
        self.owner = owner
    }

    public static func detect(in error: GitError) -> GitHubAuthFailure? {
        let text = error.combinedOutput
        func has(_ needle: String) -> Bool { text.range(of: needle, options: .caseInsensitive) != nil }
        guard has("https://github.com") else { return nil }
        let owner = owner(in: text)
        let unauthenticated = [
            "Authentication failed", "Invalid username or token", "Password authentication is not supported",
            "could not read Username", "could not read Password", "returned error: 401",
        ]
        if unauthenticated.contains(where: has) { return GitHubAuthFailure(kind: .unauthenticated, owner: owner) }
        if has("returned error: 403") || (has("Permission to") && has("denied to")) {
            return GitHubAuthFailure(kind: .forbidden, owner: owner)
        }
        if has("Repository not found") || (has("repository 'https://github.com/") && has("' not found")) {
            return GitHubAuthFailure(kind: .notFound, owner: owner)
        }
        return nil
    }

    /// Owner trong `https://github.com/<owner>/…` đầu tiên của thông báo lỗi.
    static func owner(in text: String) -> String? {
        guard let range = text.range(of: "https://github.com/", options: .caseInsensitive) else { return nil }
        let owner = text[range.upperBound...].prefix { $0.isASCII && ($0.isLetter || $0.isNumber || "-_.".contains($0)) }
        return owner.isEmpty ? nil : String(owner)
    }
}
