import Foundation

/// Cờ rủi ro trước khi commit (không AI) — port của `packages/core/src/risk/` (app Tauri); hai bên test cùng
/// `packages/contracts/risk-rules.vectors.json`. Chỉ cảnh báo, không chặn commit; kết quả chỉ có ĐƯỜNG DẪN, không bao giờ có
/// nội dung bí mật.
public enum RiskCode: String, Sendable, CaseIterable {
    case testsRemoved = "tests-removed"
    case testsSkipped = "tests-skipped"
    case depsChanged = "deps-changed"
    case ciChanged = "ci-changed"
    case largeFile = "large-file"
    case secret
}

public struct RiskInput: Sendable, Equatable {
    public enum Status: String, Sendable { case added, modified, deleted }
    public let path: String
    public let status: Status
    /// Dòng được thêm (không kèm dấu `+`).
    public var addedLines: [String]
    /// Kích thước file hiện tại (byte); nil = không rõ.
    public var size: Int?

    public init(path: String, status: Status, addedLines: [String] = [], size: Int? = nil) {
        self.path = path
        self.status = status
        self.addedLines = addedLines
        self.size = size
    }
}

public struct RiskFlag: Sendable, Equatable, Identifiable {
    public let code: RiskCode
    public let paths: [String]
    public var id: String { code.rawValue }

    public init(code: RiskCode, paths: [String]) {
        self.code = code
        self.paths = paths
    }
}

public enum RiskRules {
    public static let largeFileBytes = 1024 * 1024

    private static func regex(_ pattern: String, _ options: NSRegularExpression.Options = []) -> NSRegularExpression {
        // Mẫu cố định trong code: lỗi cú pháp là lỗi lập trình (test vector bắt ngay).
        try! NSRegularExpression(pattern: pattern, options: options)
    }

    private static func matches(_ regex: NSRegularExpression, _ text: String) -> Bool {
        regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil
    }

    // MARK: Test / thư viện / CI

    private static let testDirs: Set<String> = ["test", "tests", "__tests__", "spec", "specs"]
    private static let testFile = [#"\.(?:test|spec)\.[a-z0-9]+$"#, #"_test\.[a-z0-9]+$"#, #"^test_.+\.py$"#].map { regex($0) }
    private static let testSkip = [
        #"\b(?:it|test|describe|context|suite)\.(?:skip|only)\s*\("#,
        #"\bx(?:it|test|describe)\s*\("#,
        #"#\[ignore\]"#,
        #"@pytest\.mark\.skip"#,
        #"@(?:Disabled|Ignore)\b"#,
        #"\bXCTSkip\b"#,
    ].map { regex($0) }
    private static let depsFiles: Set<String> = [
        "package.json", "package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb",
        "cargo.toml", "cargo.lock", "package.swift", "package.resolved", "go.mod", "go.sum", "pyproject.toml", "poetry.lock",
        "pipfile", "pipfile.lock", "uv.lock", "gemfile", "gemfile.lock", "composer.json", "composer.lock", "build.gradle",
        "build.gradle.kts", "pom.xml", "podfile", "podfile.lock", "pubspec.yaml", "pubspec.lock",
    ]
    private static let depsPattern = regex(#"^requirements.*\.txt$"#)
    private static let ciNames = [
        #"^\.gitlab-ci\.ya?ml$"#, #"^jenkinsfile$"#, #"^azure-pipelines\.ya?ml$"#, #"^dockerfile(?:\..+)?$"#, #"\.dockerfile$"#,
        #"^docker-compose.*\.ya?ml$"#, #"^compose\.ya?ml$"#,
    ].map { regex($0) }

    private static func segments(_ path: String) -> [String] {
        path.lowercased().split(separator: "/", omittingEmptySubsequences: false).map(String.init)
    }

    public static func isTestPath(_ path: String) -> Bool {
        let parts = segments(path)
        let name = parts.last ?? ""
        return parts.dropLast().contains { testDirs.contains($0) } || testFile.contains { matches($0, name) }
    }

    private static func isDepsFile(_ path: String) -> Bool {
        let name = segments(path).last ?? ""
        return depsFiles.contains(name) || matches(depsPattern, name)
    }

    private static func isCIFile(_ path: String) -> Bool {
        let lower = path.lowercased()
        if lower.hasPrefix(".github/workflows/") || lower.hasPrefix(".circleci/") { return true }
        let name = segments(path).last ?? ""
        return ciNames.contains { matches($0, name) }
    }

    // MARK: Bí mật (port của `ai/secret-scan.ts`)

    private static let sensitiveFiles = [
        #"^\.env(?:\..*)?$"#, #"\.env$"#, #"\.(?:pem|key|p12|pfx|jks|keystore|kdbx|ovpn|ppk|asc|gpg)$"#,
        #"^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$"#, #"^\.(?:npmrc|pypirc|netrc|git-credentials|htpasswd|pgpass|dockercfg)$"#,
        #"^_netrc$"#, #"^credentials.*\.json$"#, #"^service[-_]?account.*\.json$"#, #"^secrets?\..+$"#,
        #"\.tfvars(?:\.json)?$"#, #"\.tfstate(?:\.backup)?$"#, #"^kubeconfig$"#, #"^appsettings.*\.json$"#,
        #"^google-services\.json$"#, #"^googleservice-info\.plist$"#,
    ].map { regex($0) }

    private static let secretRules = [
        #"-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----"#,
        #"\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b"#,
        #"\b(?:ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{36,}\b"#,
        #"\bgithub_pat_[0-9A-Za-z_]{22,}\b"#,
        #"\bglpat-[0-9A-Za-z_-]{20,}\b"#,
        #"\bxox[abposr]-[0-9A-Za-z-]{10,}\b"#,
        #"hooks\.slack\.com/services/T[0-9A-Z]+/B[0-9A-Z]+/[0-9A-Za-z]+"#,
        #"\bsk-(?:ant-|proj-|or-)?[0-9A-Za-z_-]{20,}\b"#,
        #"\b(?:sk|rk|pk)_(?:live|test)_[0-9A-Za-z]{20,}\b"#,
        #"\bAIza[0-9A-Za-z_-]{35}\b"#,
        #"\bnpm_[0-9A-Za-z]{36}\b"#,
        #"\bpypi-AgEIcHlwaS5vcmc[0-9A-Za-z_-]{40,}"#,
        #"\bSG\.[0-9A-Za-z_-]{22}\.[0-9A-Za-z_-]{43}\b"#,
        #"\b\d{8,10}:AA[0-9A-Za-z_-]{33}\b"#,
        #"discord(?:app)?\.com/api/webhooks/\d+/[0-9A-Za-z_-]{20,}"#,
        #"\beyJ[0-9A-Za-z_-]{10,}\.eyJ[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]{10,}"#,
    ].map { regex($0) } + [regex(#"\b[a-z][a-z0-9+.-]{1,20}://[^\s:@/'"]{1,64}:[^\s@/'"]{3,}@[^\s'"]+"#, .caseInsensitive)]

    private static let sensitiveAssignment = regex(
        #"(?:secret|token|passw(?:or)?d|passwd|pwd|api[_-]?key|access[_-]?key|private[_-]?key|auth[_-]?key|credential)[\w.-]*["']?\s*(?::=|=>|[:=])\s*["'`]?([^\s"'`,;)]{8,})"#,
        .caseInsensitive)
    private static let referencePatterns = [
        regex(#"^[A-Za-z_$][\w$]*(?:\.[\w$]+)+$"#),
        regex(#"[()\[\]{}<>]"#),
        regex(#"^(?:process\.env|os\.environ|env|getenv|ENV)\b"#, .caseInsensitive),
        regex(#"^(?:x{4,}|\*{4,}|changeme|password|secret|example|placeholder|dummy|test|your[_-].*)$"#, .caseInsensitive),
        regex(#"^[a-z]+(?:_[a-z]+)*$"#),
    ]

    static func isSensitivePath(_ path: String) -> Bool {
        let parts = segments(path)
        let name = parts.last ?? ""
        if sensitiveFiles.contains(where: { matches($0, name) }) { return true }
        return parts.dropLast().contains { $0 == ".ssh" || $0 == ".aws" || $0 == ".kube" }
    }

    static func shannonEntropy(_ text: String) -> Double {
        guard !text.isEmpty else { return 0 }
        var counts: [Character: Int] = [:]
        for character in text { counts[character, default: 0] += 1 }
        let length = Double(text.count)
        return counts.values.reduce(0) { entropy, count in
            let p = Double(count) / length
            return entropy - p * log2(p)
        }
    }

    static func containsSecret(_ text: String) -> Bool {
        if secretRules.contains(where: { matches($0, text) }) { return true }
        let range = NSRange(text.startIndex..., in: text)
        for match in sensitiveAssignment.matches(in: text, range: range) {
            guard let valueRange = Range(match.range(at: 1), in: text) else { continue }
            let value = String(text[valueRange])
            if referencePatterns.contains(where: { matches($0, value) }) { continue }
            if value.count >= 12 ? shannonEntropy(value) >= 3.2 : shannonEntropy(value) >= 2.8 { return true }
        }
        return false
    }

    // MARK: Luật

    private static func applies(_ code: RiskCode, to file: RiskInput) -> Bool {
        let present = file.status != .deleted
        switch code {
        case .testsRemoved:
            return file.status == .deleted && isTestPath(file.path)
        case .testsSkipped:
            return present && isTestPath(file.path) && file.addedLines.contains { line in testSkip.contains { matches($0, line) } }
        case .depsChanged:
            return isDepsFile(file.path)
        case .ciChanged:
            return isCIFile(file.path)
        case .largeFile:
            return present && (file.size ?? 0) > largeFileBytes
        case .secret:
            return present && (isSensitivePath(file.path) || file.addedLines.contains(where: containsSecret))
        }
    }

    /// Các cờ theo thứ tự `RiskCode.allCases`, mỗi cờ kèm đường dẫn đã sắp xếp (theo mã Unicode, như bản TS).
    public static func detect(_ files: [RiskInput]) -> [RiskFlag] {
        RiskCode.allCases.compactMap { code in
            let paths = files.filter { applies(code, to: $0) }.map(\.path)
                .sorted { $0.unicodeScalars.lexicographicallyPrecedes($1.unicodeScalars) }
            return paths.isEmpty ? nil : RiskFlag(code: code, paths: paths)
        }
    }

    /// `git diff -U0` → các dòng được thêm theo đường dẫn mới.
    public static func addedLinesByPath(_ patch: String) -> [String: [String]] {
        var result: [String: [String]] = [:]
        var current: String?
        var oldPath: String?
        var inHeader = false
        let normalized = patch.replacingOccurrences(of: "\r\n", with: "\n")
        for line in normalized.split(separator: "\n", omittingEmptySubsequences: false).map(String.init) {
            if line.hasPrefix("diff --git ") {
                current = nil
                oldPath = nil
                inHeader = true
                continue
            }
            if inHeader {
                if line.hasPrefix("--- ") {
                    let raw = String(line.dropFirst(4))
                    oldPath = raw == "/dev/null" ? nil : String(raw.unquotedGitPath.trimmingPrefix("a/"))
                } else if line.hasPrefix("+++ ") {
                    let raw = String(line.dropFirst(4))
                    current = raw == "/dev/null" ? oldPath : String(raw.unquotedGitPath.trimmingPrefix("b/"))
                } else if line.hasPrefix("@@") {
                    inHeader = false
                }
                continue
            }
            if let current, line.hasPrefix("+") {
                result[current, default: []].append(String(line.dropFirst()))
            }
        }
        return result
    }
}

extension GitRepository {
    private static let riskMaxDiffBytes = 8 * 1024 * 1024
    private static let riskMaxNewFiles = 100

    /// Đầu vào cho cờ rủi ro từ thay đổi chưa commit: một lần `git diff HEAD -U0`, đọc file mới để biết kích thước và nội dung.
    public func riskInputs(status: WorkingTreeStatus) async throws -> [RiskInput] {
        var order: [String] = []
        var files: [String: RiskInput] = [:]
        // Working tree là thứ sẽ được commit khi "Stage tất cả & commit": thay đổi chưa stage đè lên đã stage.
        for change in status.staged + status.unstaged {
            let riskStatus: RiskInput.Status = switch change.kind {
            case .deleted: .deleted
            case .added, .untracked: .added
            default: .modified
            }
            if files[change.path] == nil { order.append(change.path) }
            files[change.path] = RiskInput(path: change.path, status: riskStatus)
        }
        guard !files.isEmpty else { return [] }

        if status.head.oid != nil {
            let output = try await runner.run(["diff", "HEAD", "-U0", "--no-color", "--no-renames", "--no-ext-diff", "--no-textconv"])
            if output.stdout.count <= Self.riskMaxDiffBytes {
                for (path, lines) in RiskRules.addedLinesByPath(String(decoding: output.stdout, as: UTF8.self)) {
                    files[path]?.addedLines = lines
                }
            }
        }

        var read = 0
        for path in order {
            guard var file = files[path], file.status == .added, read < Self.riskMaxNewFiles else { continue }
            read += 1
            let url = root.appendingPathComponent(path)
            guard let size = (try? FileManager.default.attributesOfItem(atPath: url.path))?[.size] as? Int else { continue }
            file.size = size
            if file.addedLines.isEmpty, size <= RiskRules.largeFileBytes, let data = try? Data(contentsOf: url), !data.contains(0) {
                file.addedLines = String(decoding: data, as: UTF8.self)
                    .replacingOccurrences(of: "\r\n", with: "\n")
                    .split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
            }
            files[path] = file
        }
        return order.compactMap { files[$0] }
    }
}
