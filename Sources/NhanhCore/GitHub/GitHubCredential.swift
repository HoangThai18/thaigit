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
    /// Tài khoản đã nạp được token.
    public let accounts: [GitHubCredential]
    /// owner (viết thường) → login, dựng từ danh sách ĐẦY ĐỦ (kể cả tài khoản chưa có token). Owner không có trong bảng
    /// dùng tài khoản mặc định.
    public let owners: [String: String]
    /// Tài khoản mặc định của danh sách đầy đủ (có thể chưa có token).
    public let defaultLogin: String

    /// Dựng từ danh sách tài khoản + token đã nạp (login → token). nil nếu chưa tài khoản nào có token.
    /// Owner của tài khoản không đọc được token KHÔNG rơi về tài khoản khác (kể cả khi đó là tài khoản mặc định): lệnh git
    /// tới owner đó không có token, git báo lỗi xác thực và app gợi ý đăng nhập lại đúng tài khoản ấy.
    public init?(helperPath: String, state: GitHubAccountsState, tokens: [String: String]) {
        let available = state.profiles.compactMap { profile in
            tokens[profile.login].flatMap { GitHubCredential(login: profile.login, token: $0) }
        }
        guard !available.isEmpty, let defaultProfile = state.defaultProfile else { return nil }
        self.init(helperPath: helperPath, accounts: available, owners: state.ownerTable, defaultLogin: defaultProfile.login)
    }

    private init(helperPath: String, accounts: [GitHubCredential], owners: [String: String], defaultLogin: String) {
        self.helperPath = helperPath
        self.accounts = accounts
        self.owners = owners
        self.defaultLogin = defaultLogin
    }

    /// Cùng bảng, đường dẫn helper khác (không dựng lại bảng owner).
    public func withHelperPath(_ path: String) -> GitHubCredentialSet {
        GitHubCredentialSet(helperPath: path, accounts: accounts, owners: owners, defaultLogin: defaultLogin)
    }

    /// Tài khoản (đã có token) có login này, không phân biệt hoa thường.
    public func account(login: String) -> GitHubCredential? {
        accounts.first { $0.login.caseInsensitiveCompare(login) == .orderedSame }
    }

    /// Tài khoản cho owner (khớp bảng, không thì mặc định). nil nếu tài khoản đó chưa có token.
    public func credential(forOwner owner: String?) -> GitHubCredential? {
        let login = owner.flatMap(GitHubAccountsState.normalizedOwner).flatMap { owners[$0] } ?? defaultLogin
        return accounts.first { $0.login == login }
    }

    /// Tài khoản cho một địa chỉ https://github.com — đúng như script helper chọn: username trong URL
    /// (`https://alice@github.com/…`) trùng login một tài khoản có token thì dùng tài khoản đó, không thì theo owner.
    public func credential(forURL url: String) -> GitHubCredential? {
        if let user = GitHubRemoteURL.username(of: url), let account = account(login: user) { return account }
        return credential(forOwner: GitHubRemoteURL.owner(of: url))
    }
}

/// Đưa token GitHub cho git mà không ghi vào cấu hình hay tham số lệnh.
///
/// Chỉ khi lệnh thật sự chạm một remote HTTPS trên github.com (người gọi truyền địa chỉ đích đọc từ cấu hình remote —
/// xem `GitRunner.run(credentialURLs:)`) và đã có tài khoản, `GitRunner` thêm:
///
///     -c credential.https://github.com.helper=
///     -c credential.https://github.com.helper=!'<Application Support>/Thaigit/github-credential.sh'
///     -c credential.https://github.com.useHttpPath=true
///
/// Giá trị rỗng xoá các helper của người dùng nhưng CHỈ với URL https://github.com (git so khớp cấu hình theo URL),
/// host khác (gitlab.com…) vẫn dùng helper sẵn có. `useHttpPath` để git gửi `path=owner/repo` cho helper — helper chọn
/// token theo owner. Token nằm trong biến môi trường của riêng tiến trình git đó, và chỉ token của các tài khoản dùng cho
/// những remote đó; tham số lệnh (và nhật ký lệnh) chỉ có đường dẫn script. Mọi tiến trình con của lệnh — kể cả hook
/// của chính repo (pre-push, reference-transaction…), filter, merge driver — vẫn thấy các biến này trong lúc lệnh chạy;
/// lệnh không chạm github.com (remote GitLab, thư mục trên máy, `fetch .`, lệnh local) thì không có biến token nào.
public enum GitCredentialInjection {
    public static let helperKey = "credential.https://github.com.helper"
    public static let useHttpPathKey = "credential.https://github.com.useHttpPath"
    public static let accountCountVariable = "THAIGIT_GITHUB_ACCOUNTS"
    public static let ownersVariable = "THAIGIT_GITHUB_OWNERS"
    public static let defaultVariable = "THAIGIT_GITHUB_DEFAULT"
    public static func userVariable(_ index: Int) -> String { "THAIGIT_GITHUB_USER_\(index)" }
    public static func tokenVariable(_ index: Int) -> String { "THAIGIT_GITHUB_TOKEN_\(index)" }
    /// Chỉ số trong bảng owner cho owner của tài khoản chưa có token: helper không trả lời gì.
    public static let missingIndex = "-"

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

    /// Phần thêm vào một lệnh git chạm các địa chỉ `urls`. Không có địa chỉ HTTPS nào tới github.com, hoặc chưa có tài
    /// khoản nào có token, thì không thêm gì (helper trả lời rỗng sẽ làm hỏng xác thực bằng helper riêng của người dùng).
    /// Bảng owner chỉ gồm owner của các địa chỉ đó; owner mà tài khoản chưa có token ghi chỉ số `missingIndex`.
    public static func additions(forURLs urls: [String], credentials: GitHubCredentialSet?) -> Additions {
        guard let credentials else { return .none }
        let targets = urls.filter(GitHubRemoteURL.isHTTPS)
        guard !targets.isEmpty else { return .none }
        var accounts: [GitHubCredential] = []
        func index(of account: GitHubCredential) -> Int {
            if let existing = accounts.firstIndex(of: account) { return existing }
            accounts.append(account)
            return accounts.count - 1
        }
        var owners: [String: String] = [:]
        for url in targets {
            // https://alice@github.com/…: script chọn theo username, không cần bảng owner.
            if let user = GitHubRemoteURL.username(of: url), let account = credentials.account(login: user) {
                _ = index(of: account)
                continue
            }
            guard let owner = GitHubRemoteURL.owner(of: url).flatMap(GitHubAccountsState.normalizedOwner) else { continue }
            owners[owner] = credentials.credential(forOwner: owner).map { String(index(of: $0)) } ?? missingIndex
        }
        guard !accounts.isEmpty || !owners.isEmpty else { return .none }
        var environment = [accountCountVariable: String(accounts.count)]
        for (index, account) in accounts.enumerated() {
            environment[userVariable(index)] = account.login
            environment[tokenVariable(index)] = account.token
        }
        // Owner ngoài bảng (GitHub chuyển hướng repo đã đổi owner…): chỉ khi lệnh dùng đúng một tài khoản mới dùng nó.
        if accounts.count == 1 { environment[defaultVariable] = "0" }
        environment[ownersVariable] = owners.map { "\($0.key):\($0.value)" }.sorted().joined(separator: ",")
        return Additions(
            arguments: [
                "-c", helperKey + "=",
                "-c", helperKey + "=" + GitHubCredentialHelper.configValue(path: credentials.helperPath),
                "-c", useHttpPathKey + "=true",
            ],
            environment: environment
        )
    }
}

/// Script credential helper cho https://github.com, cài vào `~/Library/Application Support/Thaigit/` (như askpass.sh).
public enum GitHubCredentialHelper {
    public static let fileName = "github-credential.sh"

    public static let script = #"""
    #!/bin/sh
    # Thaigit — credential helper cho https://github.com (git gọi: <script> get|store|erase).
    # Chọn tài khoản theo owner trong path=owner/repo (git gửi path nhờ credential.https://github.com.useHttpPath=true):
    # bảng THAIGIT_GITHUB_OWNERS="owner:i,…" → tài khoản i ("-": tài khoản chưa có token, không trả lời); không khớp thì
    # THAIGIT_GITHUB_DEFAULT (không đặt: không trả lời). URL có username (https://alice@github.com/…) trùng login một
    # tài khoản thì dùng tài khoản đó. Username / token của tài khoản i nằm trong THAIGIT_GITHUB_USER_i /
    # THAIGIT_GITHUB_TOKEN_i — biến môi trường của riêng tiến trình git, không ghi ra đĩa. Chỉ trả lời "get": store /
    # erase bỏ qua để token không bị chép vào helper khác (osxkeychain) và token người dùng tự lưu không bị xoá.
    [ "$1" = "get" ] || exit 0
    set -f
    owner=""
    username=""
    while IFS= read -r line; do
      [ -n "$line" ] || break
      case "$line" in
        path=*) owner=${line#path=}; owner=${owner#/}; owner=${owner%%/*} ;;
        username=*) username=${line#username=} ;;
      esac
    done
    lower() { printf '%s' "$1" | /usr/bin/tr '[:upper:]' '[:lower:]'; }
    owner=$(lower "$owner")
    username=$(lower "$username")
    index=${THAIGIT_GITHUB_DEFAULT-}
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
    if [ -n "$username" ]; then
      i=0
      while [ "$i" -lt "${THAIGIT_GITHUB_ACCOUNTS:-0}" ] 2>/dev/null; do
        eval "candidate=\${THAIGIT_GITHUB_USER_$i-}"
        if [ "$(lower "$candidate")" = "$username" ]; then
          index=$i
          break
        fi
        i=$((i + 1))
      done
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

    /// Đọc từ các DÒNG LỖI của git, mỗi dòng nêu đúng URL bị từ chối — không lấy URL github.com bất kỳ trong output
    /// (`fetch --all` in "From https://github.com/<owner khác>" của remote thành công trước lỗi của remote hỏng):
    ///  - `Authentication failed for '<url>'`, `could not read Username|Password for '<url>'`,
    ///    `unable to access '<url>': … error: 401` → thiếu / sai đăng nhập;
    ///  - `unable to access '<url>': … error: 403` (kèm `Permission to <owner>/… denied to …`) → không có quyền;
    ///  - `repository '<url>' not found` → không thấy repo.
    /// URL phải đúng https://github.com (không khớp github.cong-ty.com); dòng "From …" / "To …" bỏ qua.
    public static func detect(in error: GitError) -> GitHubAuthFailure? {
        var permissionOwner: String?
        for rawLine in error.combinedOutput.split(whereSeparator: \.isNewline) {
            let line = rawLine.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("From ") || line.hasPrefix("To ") { continue }
            if let range = line.range(of: "Permission to ", options: .caseInsensitive),
               line.range(of: " denied", options: .caseInsensitive) != nil {
                permissionOwner = line[range.upperBound...].split(separator: "/").first.map(String.init)
                    .flatMap { GitHubAccountsState.normalizedOwner($0) == nil ? nil : $0 }
                continue
            }
            if let url = quotedURL(in: line, after: "Authentication failed for ")
                ?? quotedURL(in: line, after: "could not read Username for ")
                ?? quotedURL(in: line, after: "could not read Password for ") {
                if isGitHub(url) { return GitHubAuthFailure(kind: .unauthenticated, owner: GitHubRemoteURL.owner(of: url)) }
            } else if let url = quotedURL(in: line, after: "unable to access "), isGitHub(url) {
                if line.contains("error: 401") { return GitHubAuthFailure(kind: .unauthenticated, owner: GitHubRemoteURL.owner(of: url)) }
                if line.contains("error: 403") {
                    return GitHubAuthFailure(kind: .forbidden, owner: permissionOwner ?? GitHubRemoteURL.owner(of: url))
                }
            } else if let url = quotedURL(in: line, after: "repository "), line.hasSuffix("not found"), isGitHub(url) {
                return GitHubAuthFailure(kind: .notFound, owner: GitHubRemoteURL.owner(of: url))
            }
        }
        return nil
    }

    /// `<prefix>'<url>'` trong dòng lỗi → `<url>`.
    private static func quotedURL(in line: String, after prefix: String) -> String? {
        guard let start = line.range(of: prefix + "'", options: .caseInsensitive) else { return nil }
        let rest = line[start.upperBound...]
        guard let end = rest.firstIndex(of: "'") else { return nil }
        return String(rest[..<end])
    }

    /// Đúng https://github.com (có thể kèm username), không phải host khác chứa chữ "github.com".
    private static func isGitHub(_ url: String) -> Bool {
        guard let components = URLComponents(string: url) else { return false }
        return components.scheme?.lowercased() == "https" && components.host?.lowercased() == "github.com"
    }
}
