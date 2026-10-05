import Foundation

/// A signed-in GitHub account (with no token): public info, commit identity, known organisations.
public struct GitHubAccountProfile: Codable, Sendable, Equatable, Identifiable {
    public var account: GitHubAccount
    /// The name / email written into a repo's local config when the account is assigned to a repo (the user can edit it).
    public var commitName: String
    public var commitEmail: String
    /// The organisations the account is a member of (`GET /user/orgs`), kept so a token can be picked by owner.
    public var organizations: [String]
    public var organizationsUpdatedAt: Date?

    public init(account: GitHubAccount, commitName: String? = nil, commitEmail: String? = nil,
                organizations: [String] = [], organizationsUpdatedAt: Date? = nil) {
        self.account = account
        self.commitName = commitName ?? account.displayName
        self.commitEmail = commitEmail ?? Self.noreplyEmail(for: account)
        self.organizations = organizations
        self.organizationsUpdatedAt = organizationsUpdatedAt
    }

    public var id: String { account.login }
    public var login: String { account.login }

    /// GitHub's hidden email: commits still count for the account without exposing a real address.
    public static func noreplyEmail(for account: GitHubAccount) -> String {
        "\(account.id)+\(account.login)@users.noreply.github.com"
    }
}

/// The GitHub accounts, the default account and the owners the user assigned themselves — the non-secret part
/// (UserDefaults). Each account's token lives separately in the Keychain, keyed by login.
public struct GitHubAccountsState: Codable, Sendable, Equatable {
    public var profiles: [GitHubAccountProfile]
    public var defaultLogin: String?
    /// owner (lowercased) → login, as assigned by the user ("GitHub account for this repo").
    public var ownerAssignments: [String: String]

    public init(profiles: [GitHubAccountProfile] = [], defaultLogin: String? = nil, ownerAssignments: [String: String] = [:]) {
        self.profiles = profiles
        self.defaultLogin = defaultLogin
        self.ownerAssignments = ownerAssignments
    }

    public var isEmpty: Bool { profiles.isEmpty }

    /// The default account: `defaultLogin`, or the first account when that's unset.
    public var defaultProfile: GitHubAccountProfile? { profile(login: defaultLogin) ?? profiles.first }

    public func profile(login: String?) -> GitHubAccountProfile? {
        guard let login else { return nil }
        return profiles.first { $0.login.caseInsensitiveCompare(login) == .orderedSame }
    }

    // MARK: - Picking an account by owner

    /// Why a particular account was chosen for an owner.
    public enum Match: Sendable, Equatable {
        /// The user assigned this owner to the account themselves.
        case assigned
        /// The owner is exactly an account's login.
        case login
        /// The owner is an organisation the account is a member of.
        case organization
        /// Nothing matched: use the default account.
        case fallback
    }

    public struct Resolution: Sendable, Equatable {
        public let profile: GitHubAccountProfile
        public let match: Match
    }

    /// The account used for an owner, in priority order: 1. the user's own assignment; 2. an owner matching an
    /// account's login; 3. an organisation the account is a member of (when several accounts share it: the default
    /// account first, then the first account); 4. otherwise the default account. Matching is case-insensitive. nil when there is no account yet.
    public func resolve(owner: String?) -> Resolution? {
        guard let fallback = defaultProfile else { return nil }
        guard let owner, let key = Self.normalizedOwner(owner) else { return Resolution(profile: fallback, match: .fallback) }
        if let login = ownerAssignments[key], let assigned = profile(login: login) {
            return Resolution(profile: assigned, match: .assigned)
        }
        if let own = profile(login: key) {
            return Resolution(profile: own, match: .login)
        }
        let candidates = [fallback] + profiles.filter { $0.login != fallback.login }
        if let member = candidates.first(where: { $0.organizations.contains { Self.normalizedOwner($0) == key } }) {
            return Resolution(profile: member, match: .organization)
        }
        return Resolution(profile: fallback, match: .fallback)
    }

    /// owner (lowercased) → login for every known owner (assigned, login, organisation) — the same result `resolve` gives.
    /// An owner outside the table uses the default account.
    public var ownerTable: [String: String] {
        var owners = Set(ownerAssignments.keys)
        for profile in profiles {
            if let key = Self.normalizedOwner(profile.login) { owners.insert(key) }
            owners.formUnion(profile.organizations.compactMap(Self.normalizedOwner))
        }
        var table: [String: String] = [:]
        for owner in owners {
            if let resolution = resolve(owner: owner) { table[owner] = resolution.profile.login }
        }
        return table
    }

    /// A valid GitHub owner (letters, digits, "-", "_", "."), lowercased; nil when empty or containing odd characters.
    public static func normalizedOwner(_ owner: String) -> String? {
        let trimmed = owner.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, trimmed.count <= 100,
              trimmed.unicodeScalars.allSatisfy({ $0.isASCII && (CharacterSet.alphanumerics.contains($0) || "-_.".unicodeScalars.contains($0)) })
        else { return nil }
        return trimmed.lowercased()
    }

    // MARK: - Mutations

    /// Add an account, or update an existing one — looked up by GitHub id first (a login can change case or be
    /// renamed), then by login. Commit identity edits the user made are preserved; when the login changes the
    /// assigned owners and the default account follow the new login. The first account becomes the default.
    /// A nil `organizations` keeps the old organisation list.
    public mutating func upsert(_ account: GitHubAccount, organizations: [String]?, at date: Date = Date()) {
        if let index = profiles.firstIndex(where: { $0.account.id == account.id })
            ?? profiles.firstIndex(where: { $0.login.caseInsensitiveCompare(account.login) == .orderedSame }) {
            let oldLogin = profiles[index].login
            profiles[index].account = account
            if oldLogin != account.login {
                ownerAssignments = ownerAssignments.mapValues { $0 == oldLogin ? account.login : $0 }
                if defaultLogin == oldLogin { defaultLogin = account.login }
            }
            if let organizations {
                profiles[index].organizations = organizations
                profiles[index].organizationsUpdatedAt = date
            }
        } else {
            profiles.append(GitHubAccountProfile(account: account, organizations: organizations ?? [],
                                                 organizationsUpdatedAt: organizations == nil ? nil : date))
        }
        if profile(login: defaultLogin) == nil { defaultLogin = profiles.first?.login }
    }

    /// Remove an account (and the owners assigned to it). Removing the default account makes the first remaining one the default.
    public mutating func remove(login: String) {
        profiles.removeAll { $0.login.caseInsensitiveCompare(login) == .orderedSame }
        ownerAssignments = ownerAssignments.filter { $0.value.caseInsensitiveCompare(login) != .orderedSame }
        if profile(login: defaultLogin) == nil { defaultLogin = profiles.first?.login }
    }

    public mutating func setDefault(login: String) {
        guard let profile = profile(login: login) else { return }
        defaultLogin = profile.login
    }

    /// Assign an owner to an account (a nil `login` clears the assignment). An invalid owner or a missing account is ignored.
    public mutating func assign(owner: String, to login: String?) {
        guard let key = Self.normalizedOwner(owner) else { return }
        if let login, let profile = profile(login: login) {
            ownerAssignments[key] = profile.login
        } else {
            ownerAssignments[key] = nil
        }
    }

    public mutating func setCommitIdentity(login: String, name: String, email: String) {
        guard let index = profiles.firstIndex(where: { $0.login == login }) else { return }
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)
        profiles[index].commitName = trimmedName.isEmpty ? profiles[index].account.displayName : trimmedName
        profiles[index].commitEmail = trimmedEmail.isEmpty ? GitHubAccountProfile.noreplyEmail(for: profiles[index].account) : trimmedEmail
    }

    public mutating func setOrganizations(login: String, _ organizations: [String], at date: Date = Date()) {
        guard let index = profiles.firstIndex(where: { $0.login == login }) else { return }
        profiles[index].organizations = organizations
        profiles[index].organizationsUpdatedAt = date
    }

    /// The repo picked from account `login`'s repository list (the Clone dialog): when the owner in use is a
    /// different account (by the organisation / default rule), assign the owner to `login` so that the clone —
    /// and every fetch / push afterwards — uses the very account that listed the repo. Returns true when it
    /// just assigned.
    @discardableResult
    public mutating func assignOwnerForPickedRepository(owner: String, login: String) -> Bool {
        guard let picked = profile(login: login), let current = resolve(owner: owner),
              current.profile.login != picked.login else { return false }
        assign(owner: owner, to: picked.login)
        return true
    }
}

/// Reads the owner (user / organisation) from a github.com remote address.
public enum GitHubRemoteURL {
    /// `https://github.com/owner/repo(.git)`, `git@github.com:owner/repo.git`, `ssh://git@github.com/owner/repo`…
    /// nil when the remote isn't on github.com.
    public static func owner(of remote: String) -> String? {
        let text = remote.trimmingCharacters(in: .whitespacesAndNewlines)
        var path: Substring?
        if let components = URLComponents(string: text), components.scheme != nil, let host = components.host?.lowercased() {
            guard ["github.com", "www.github.com", "ssh.github.com"].contains(host) else { return nil }
            path = Substring(components.path)
        } else if let separator = text.range(of: "@github.com:", options: .caseInsensitive) {
            // scp form of ssh: git@github.com:owner/repo.git
            path = text[separator.upperBound...]
        } else if text.lowercased().hasPrefix("github.com:") {
            path = text.dropFirst("github.com:".count)
        }
        guard let path, let owner = path.split(separator: "/").first.map(String.init),
              GitHubAccountsState.normalizedOwner(owner) != nil else { return nil }
        return owner
    }

    /// The username in the URL (`https://alice@github.com/…` → "alice"), when there is one.
    public static func username(of remote: String) -> String? {
        guard let user = URLComponents(string: remote.trimmingCharacters(in: .whitespacesAndNewlines))?.user, !user.isEmpty else {
            return nil
        }
        return user
    }

    /// A remote that uses HTTPS to github.com (only these go through Thaigit's credential helper; SSH uses SSH keys).
    public static func isHTTPS(_ remote: String) -> Bool {
        guard let components = URLComponents(string: remote.trimmingCharacters(in: .whitespacesAndNewlines)) else { return false }
        return components.scheme?.lowercased() == "https" && components.host?.lowercased() == "github.com"
    }
}
