import Foundation

/// Login + token of one GitHub account. Printing it (description, dump, a test's error message) never exposes the token.
public struct GitHubCredential: Sendable, Equatable, CustomStringConvertible, CustomDebugStringConvertible, CustomReflectable {
    public let login: String
    public let token: String

    /// nil when the login / token is empty or contains control characters / whitespace (git's credential protocol is
    /// line-based `key=value`, so a newline would smuggle in an extra line).
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

/// The accounts that have a loaded token plus the owner → account table, handed to Thaigit's credential helper.
public struct GitHubCredentialSet: Sendable, Equatable {
    /// Path of the `github-credential.sh` script (see `GitHubCredentialHelper`).
    public let helperPath: String
    /// Accounts that have a loaded token.
    public let accounts: [GitHubCredential]
    /// owner (lowercased) → login, built from the FULL list (including accounts without a token). An owner not in the
    /// table uses the default account.
    public let owners: [String: String]
    /// The default account of the full list (it may not have a token).
    public let defaultLogin: String

    /// Built from the account list plus the loaded tokens (login → token). nil when no account has a token.
    /// An owner whose account has no readable token does NOT fall back to another account (not even the default):
    /// a git command to that owner has no token, git reports an auth failure and the app suggests signing in
    /// again as exactly that account.
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

    /// The same table with a different helper path (the owner table isn't rebuilt).
    public func withHelperPath(_ path: String) -> GitHubCredentialSet {
        GitHubCredentialSet(helperPath: path, accounts: accounts, owners: owners, defaultLogin: defaultLogin)
    }

    /// The (token-bearing) account with this login, case-insensitively.
    public func account(login: String) -> GitHubCredential? {
        accounts.first { $0.login.caseInsensitiveCompare(login) == .orderedSame }
    }

    /// The account for an owner (table lookup, otherwise the default). nil when that account has no token.
    public func credential(forOwner owner: String?) -> GitHubCredential? {
        let login = owner.flatMap(GitHubAccountsState.normalizedOwner).flatMap { owners[$0] } ?? defaultLogin
        return accounts.first { $0.login == login }
    }

    /// The account for a https://github.com address — exactly as the helper script chooses: a username in the URL
    /// (`https://alice@github.com/…`) matching a token-bearing account wins, otherwise it's by owner.
    public func credential(forURL url: String) -> GitHubCredential? {
        if let user = GitHubRemoteURL.username(of: url), let account = account(login: user) { return account }
        return credential(forOwner: GitHubRemoteURL.owner(of: url))
    }
}

/// Hands a GitHub token to git without writing it into config or the command's arguments.
/// Only when the command really touches an HTTPS remote on github.com (the caller passes the destination addresses read
/// from the remote config — see `GitRunner.run(credentialURLs:)`) and there's an account, `GitRunner` adds:
/// An empty value clears the user's helpers but ONLY for the https://github.com URL (git matches config by URL),
/// so other hosts (gitlab.com…) keep using the existing helpers. `useHttpPath` makes git send `path=owner/repo` to
/// the helper — the helper picks the token by owner. The token lives in environment variables of that git
/// process alone, and only the tokens of the accounts used for those remotes; the command's arguments (and the
/// command log) only ever contain the script path. Every child process of the command — including the repo's
/// own hooks (pre-push, reference-transaction…), filters, merge drivers — still sees these variables while the
/// command runs; a command that doesn't touch github.com (a GitLab remote, a local folder, `fetch .`, a local
/// command) gets no token variables at all.
public enum GitCredentialInjection {
    public static let helperKey = "credential.https://github.com.helper"
    public static let useHttpPathKey = "credential.https://github.com.useHttpPath"
    public static let accountCountVariable = "THAIGIT_GITHUB_ACCOUNTS"
    public static let ownersVariable = "THAIGIT_GITHUB_OWNERS"
    public static let defaultVariable = "THAIGIT_GITHUB_DEFAULT"
    public static func userVariable(_ index: Int) -> String { "THAIGIT_GITHUB_USER_\(index)" }
    public static func tokenVariable(_ index: Int) -> String { "THAIGIT_GITHUB_TOKEN_\(index)" }
    /// Index in the owner table for an owner whose account has no token: the helper answers nothing.
    public static let missingIndex = "-"

    public struct Additions: Sendable, Equatable {
        /// Placed BEFORE the git command name (or as a global `-c`).
        public var arguments: [String]
        public var environment: [String: String]

        public init(arguments: [String], environment: [String: String]) {
            self.arguments = arguments
            self.environment = environment
        }

        public static let none = Additions(arguments: [], environment: [:])
        public var isEmpty: Bool { arguments.isEmpty && environment.isEmpty }
    }

    /// The part added to a git command touching the addresses `urls`. With no HTTPS address to github.com, or when
    /// no account has a token, nothing is added (an empty helper answer would break authentication through the
    /// user's own helper). The owner table only holds the owners of those addresses; an owner whose account has
    /// no token gets `missingIndex`.
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
            // https://alice@github.com/…: the script chooses by username, no owner table needed.
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
        // An owner outside the table (GitHub redirected a repo that changed owner…): only used when the command ends up using exactly one account.
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

/// The credential helper script for https://github.com, installed into `~/Library/Application Support/Thaigit/` (like askpass.sh).
public enum GitHubCredentialHelper {
    public static let fileName = "github-credential.sh"

    public static let script = #"""
    #!/bin/sh
    # Thaigit — credential helper for https://github.com (git calls: <script> get|store|erase).
    # Pick the account by the owner in path=owner/repo (git sends the path thanks to
    # credential.https://github.com.useHttpPath=true): the table THAIGIT_GITHUB_OWNERS="owner:i,…" maps to
    # account i ("-": an account without a token, answer nothing); with no match, THAIGIT_GITHUB_DEFAULT is used
    # (unset: answer nothing). When the URL carries a username (https://alice@github.com/…) that matches an
    # account's login, that account wins. Account i's username / token live in THAIGIT_GITHUB_USER_i /
    # THAIGIT_GITHUB_TOKEN_i — environment variables of that git process alone, never on disk. Only "get" is
    # answered: store / erase are ignored so the token isn't copied into another helper (osxkeychain) and a
    # token the user saved themselves isn't deleted.
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

    /// Default install directory: ~/Library/Application Support/Thaigit.
    public static func defaultDirectory() -> URL? {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
            .appendingPathComponent("Thaigit", isDirectory: true)
    }

    /// Write the script (mode 0755) into `directory` when its content differs from the current one; returns the path.
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

    /// The `credential.<url>.helper` value: `!'<path>'`. Git runs it through a shell (`'<path>' get`), so single quotes
    /// keep the spaces in "Application Support" intact; single quotes inside the path are escaped as `'\''`.
    public static func configValue(path: String) -> String {
        "!'" + path.replacingOccurrences(of: "'", with: #"'\''"#) + "'"
    }
}

/// An authentication / permission failure when fetching / pulling / pushing to an HTTPS remote on github.com — used to suggest signing in or switching account.
public struct GitHubAuthFailure: Sendable, Equatable {
    public enum Kind: Sendable, Equatable {
        /// Missing or wrong credentials (401, no helper answered…).
        case unauthenticated
        /// Signed in but not permitted (403 "Permission to … denied").
        case forbidden
        /// GitHub answered "Repository not found" (404) — a private repo the current account can't see.
        case notFound
    }

    public let kind: Kind
    /// The owner in the URL that was refused (`https://github.com/<owner>/…`), when it could be read.
    public let owner: String?

    public init(kind: Kind, owner: String?) {
        self.kind = kind
        self.owner = owner
    }

    /// Read from git's ERROR LINES, each naming the exact URL that was refused — never from any github.com URL
    /// in the output (`fetch --all` prints "From https://github.com/<other owner>" for remotes that succeeded
    /// before the broken one failed):
    ///    `unable to access '<url>': … error: 401` → missing / wrong credentials;
    ///  - `unable to access '<url>': … error: 403` (with `Permission to <owner>/… denied to …`) → no permission;
    ///  - `repository '<url>' not found` → repo not visible.
    /// The URL must be exactly https://github.com (github.cong-ty.com must not match); "From …" / "To …" lines are ignored.
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

    /// `<prefix>'<url>'` in an error line → `<url>`.
    private static func quotedURL(in line: String, after prefix: String) -> String? {
        guard let start = line.range(of: prefix + "'", options: .caseInsensitive) else { return nil }
        let rest = line[start.upperBound...]
        guard let end = rest.firstIndex(of: "'") else { return nil }
        return String(rest[..<end])
    }

    /// Exactly https://github.com (optionally with a username), not another host merely containing "github.com".
    private static func isGitHub(_ url: String) -> Bool {
        guard let components = URLComponents(string: url) else { return false }
        return components.scheme?.lowercased() == "https" && components.host?.lowercased() == "github.com"
    }
}
