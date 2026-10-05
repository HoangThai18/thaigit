import Foundation

/// Git Flow configuration (the same `gitflow.*` keys as git-flow AVH / GitKraken, so it interoperates with those tools).
public struct GitFlowConfig: Sendable, Equatable {
    public var main: String
    public var develop: String
    public var featurePrefix: String
    public var releasePrefix: String
    public var hotfixPrefix: String
    public var versionTagPrefix: String

    public init(main: String = "main", develop: String = "develop", featurePrefix: String = "feature/",
                releasePrefix: String = "release/", hotfixPrefix: String = "hotfix/", versionTagPrefix: String = "") {
        self.main = main
        self.develop = develop
        self.featurePrefix = featurePrefix
        self.releasePrefix = releasePrefix
        self.hotfixPrefix = hotfixPrefix
        self.versionTagPrefix = versionTagPrefix
    }

    public func prefix(_ kind: GitFlowKind) -> String {
        switch kind {
        case .feature: return featurePrefix
        case .release: return releasePrefix
        case .hotfix: return hotfixPrefix
        }
    }

    /// The starting branches: feature / release from develop, hotfix from main.
    public func base(_ kind: GitFlowKind) -> String {
        kind == .hotfix ? main : develop
    }

    /// The Git Flow branch (kind + short name) a local branch belongs to, nil when it matches no prefix.
    public func classify(_ branch: String) -> (kind: GitFlowKind, name: String)? {
        for kind in GitFlowKind.allCases {
            let prefix = prefix(kind)
            if !prefix.isEmpty, branch.hasPrefix(prefix), branch.count > prefix.count {
                return (kind, String(branch.dropFirst(prefix.count)))
            }
        }
        return nil
    }

    static var keys: [(String, WritableKeyPath<GitFlowConfig, String>)] {
        [
            ("gitflow.branch.master", \.main),
            ("gitflow.branch.develop", \.develop),
            ("gitflow.prefix.feature", \.featurePrefix),
            ("gitflow.prefix.release", \.releasePrefix),
            ("gitflow.prefix.hotfix", \.hotfixPrefix),
            ("gitflow.prefix.versiontag", \.versionTagPrefix),
        ]
    }
}

public enum GitFlowKind: String, Sendable, CaseIterable, Identifiable {
    case feature
    case release
    case hotfix

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .feature: return "Feature"
        case .release: return "Release"
        case .hotfix: return "Hotfix"
        }
    }
}

/// A Git Flow step that stopped midway (usually a merge conflict): the earlier steps are done, the rest still has to run.
public struct GitFlowStepError: LocalizedError, Sendable {
    public let step: String
    public let remaining: [String]
    public let underlying: String

    public var errorDescription: String? {
        var text = String(localized: "Dừng ở bước: \(step).")
        if !remaining.isEmpty { text += String(localized: " Còn lại: ") + remaining.joined(separator: "; ") + "." }
        return text + "\n" + underlying
    }
}

extension GitRepository {
    /// The repo's Git Flow config, nil when it isn't initialised (gitflow.branch.develop missing).
    public func gitFlowConfig() async -> GitFlowConfig? {
        guard let output = try? await runner.output(["config", "--get-regexp", #"^gitflow\."#]) else { return nil }
        var values: [String: String] = [:]
        for line in output.split(separator: "\n") {
            let pair = line.split(separator: " ", maxSplits: 1, omittingEmptySubsequences: false)
            values[String(pair[0]).lowercased()] = pair.count > 1 ? String(pair[1]) : ""
        }
        guard values["gitflow.branch.develop"] != nil else { return nil }
        var config = GitFlowConfig()
        for (key, path) in GitFlowConfig.keys {
            if let value = values[key] { config[keyPath: path] = value }
        }
        return config
    }

    /// Initialise Git Flow: write the config into the repo and create the develop branch from main when it doesn't exist.
    public func initGitFlow(_ config: GitFlowConfig) async throws {
        guard (try? await resolveCommit(config.main)) != nil else {
            throw GitFlowStepError(step: String(localized: "Kiểm tra nhánh \(config.main)"), remaining: [],
                                   underlying: String(localized: "Chưa có nhánh \(config.main) (cần ít nhất một commit)."))
        }
        for (key, path) in GitFlowConfig.keys {
            try await setConfig(key, config[keyPath: path], global: false)
        }
        if (try? await resolveCommit("refs/heads/\(config.develop)")) == nil {
            try await createBranch(config.develop, at: config.main, checkout: false)
        }
    }

    /// Start a feature / release / hotfix: create branch `<prefix><name>` from the source branch and check it out.
    public func startFlow(_ kind: GitFlowKind, name: String, config: GitFlowConfig) async throws {
        try await createBranch(config.prefix(kind) + name, at: config.base(kind), checkout: true)
    }

    /// Finish a Git Flow branch like git-flow does: a feature merges (--no-ff) into develop; a release / hotfix merges
    /// into main, gets the version tag, then merges into develop. The branch is deleted afterwards. On a
    /// mid-way conflict it stops (the repo is left in an unfinished merge state) and reports the remaining steps.
    public func finishFlow(_ kind: GitFlowKind, name: String, config: GitFlowConfig, tagMessage: String? = nil) async throws {
        let branch = config.prefix(kind) + name
        var steps: [(String, () async throws -> Void)] = []
        if kind == .feature {
            steps.append((String(localized: "Chuyển sang \(config.develop)"), { try await self.switchTo(branch: config.develop) }))
            steps.append((String(localized: "Merge \(branch) vào \(config.develop)"), { try await self.merge(branch, style: .noFastForward) }))
        } else {
            let tag = config.versionTagPrefix + name
            steps.append((String(localized: "Chuyển sang \(config.main)"), { try await self.switchTo(branch: config.main) }))
            steps.append((String(localized: "Merge \(branch) vào \(config.main)"), { try await self.merge(branch, style: .noFastForward) }))
            steps.append((String(localized: "Gắn tag \(tag)"), { try await self.createTag(tag, at: "HEAD", message: tagMessage ?? "\(kind.title) \(name)") }))
            steps.append((String(localized: "Chuyển sang \(config.develop)"), { try await self.switchTo(branch: config.develop) }))
            steps.append((String(localized: "Merge \(branch) vào \(config.develop)"), { try await self.merge(branch, style: .noFastForward) }))
        }
        steps.append((String(localized: "Xoá nhánh \(branch)"), { try await self.deleteBranch(branch, force: false) }))
        for (index, step) in steps.enumerated() {
            do {
                try await step.1()
            } catch {
                throw GitFlowStepError(step: step.0, remaining: steps[(index + 1)...].map(\.0),
                                       underlying: (error as? LocalizedError)?.errorDescription ?? error.localizedDescription)
            }
        }
    }
}
