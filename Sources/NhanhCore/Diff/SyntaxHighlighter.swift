import Foundation

/// Tô màu cú pháp cho diff (như GitKraken): bộ tách token gọn theo từng dòng — từ khoá, chuỗi, comment, số. Diff chỉ có các
/// hunk rời nên chuỗi / comment nhiều dòng có thể tô chưa đúng; chấp nhận được, như phần lớn công cụ diff. Không phụ thuộc
/// thư viện ngoài, không chạy gì của repo.
public struct SyntaxLanguage: Sendable, Equatable {
    public let lineComments: [String]
    public let blockComment: (open: String, close: String)?
    public let quotes: Set<Character>
    public let keywords: Set<String>
    /// Ngôn ngữ phân biệt hoa / thường của từ khoá (SQL thì không).
    public let caseSensitive: Bool

    public static func == (lhs: SyntaxLanguage, rhs: SyntaxLanguage) -> Bool {
        lhs.lineComments == rhs.lineComments && lhs.blockComment?.open == rhs.blockComment?.open
            && lhs.quotes == rhs.quotes && lhs.keywords == rhs.keywords
    }

    /// Ngôn ngữ theo phần mở rộng của đường dẫn; `nil` khi không biết (vẽ chữ thường).
    public static func forPath(_ path: String) -> SyntaxLanguage? {
        let name = (path as NSString).lastPathComponent.lowercased()
        if name == "dockerfile" || name.hasPrefix("dockerfile.") { return shell }
        if name == "makefile" { return shell }
        switch (name as NSString).pathExtension {
        case "js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts", "vue", "svelte": return javascript
        case "php", "phtml": return php
        case "swift": return swift
        case "py", "pyw": return python
        case "rb", "rake", "gemspec": return ruby
        case "go": return go
        case "rs": return rust
        case "java", "kt", "kts", "scala", "groovy", "gradle", "dart": return java
        case "c", "h", "cc", "cpp", "cxx", "hpp", "hh", "m", "mm": return cLike
        case "cs": return csharp
        case "css", "scss", "sass", "less": return css
        case "json", "jsonc", "json5": return json
        case "yml", "yaml", "toml", "ini", "cfg", "conf", "env", "properties": return config
        case "sh", "bash", "zsh", "fish", "ps1", "bat", "cmd": return shell
        case "sql": return sql
        case "html", "htm", "xml", "svg", "plist", "xib", "storyboard", "blade": return markup
        default: return nil
        }
    }

    private static func words(_ text: String) -> Set<String> { Set(text.split(separator: " ").map(String.init)) }

    static let javascript = SyntaxLanguage(
        lineComments: ["//"], blockComment: ("/*", "*/"), quotes: ["\"", "'", "`"],
        keywords: words("""
        abstract any as async await boolean break case catch class const constructor continue debugger declare default \
        delete do else enum export extends false finally for from function get if implements import in instanceof \
        interface keyof let new null number of private protected public readonly return set static string super switch \
        this throw true try type typeof undefined var void while yield
        """), caseSensitive: true)
    static let php = SyntaxLanguage(
        lineComments: ["//", "#"], blockComment: ("/*", "*/"), quotes: ["\"", "'"],
        keywords: words("""
        abstract and array as break case catch class clone const continue declare default do echo else elseif empty \
        enum extends false final finally fn for foreach function global if implements include include_once instanceof \
        interface isset list match namespace new null or parent private protected public readonly require require_once return \
        self static switch this throw trait true try unset use var while yield
        """), caseSensitive: false)
    static let swift = SyntaxLanguage(
        lineComments: ["//"], blockComment: ("/*", "*/"), quotes: ["\""],
        keywords: words("""
        actor as associatedtype async await break case catch class continue default defer deinit do else enum extension \
        fallthrough false fileprivate final for func guard if import in init inout internal is lazy let mutating nil \
        nonisolated open operator override private protocol public repeat rethrows return self Self some static struct \
        subscript super switch throw throws true try typealias var weak where while any
        """), caseSensitive: true)
    static let python = SyntaxLanguage(
        lineComments: ["#"], blockComment: nil, quotes: ["\"", "'"],
        keywords: words("""
        and as assert async await break class continue def del elif else except False finally for from global if import \
        in is lambda None nonlocal not or pass raise return self True try while with yield
        """), caseSensitive: true)
    static let ruby = SyntaxLanguage(
        lineComments: ["#"], blockComment: nil, quotes: ["\"", "'"],
        keywords: words("""
        alias and begin break case class def defined? do else elsif end ensure false for if in module next nil not or redo \
        require rescue retry return self super then true undef unless until when while yield
        """), caseSensitive: true)
    static let go = SyntaxLanguage(
        lineComments: ["//"], blockComment: ("/*", "*/"), quotes: ["\"", "'", "`"],
        keywords: words("""
        break case chan const continue default defer else fallthrough false for func go goto if import interface map nil \
        package range return select struct switch true type var
        """), caseSensitive: true)
    static let rust = SyntaxLanguage(
        lineComments: ["//"], blockComment: ("/*", "*/"), quotes: ["\""],
        keywords: words("""
        as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut \
        pub ref return self Self static struct super trait true type unsafe use where while
        """), caseSensitive: true)
    static let java = SyntaxLanguage(
        lineComments: ["//"], blockComment: ("/*", "*/"), quotes: ["\"", "'"],
        keywords: words("""
        abstract boolean break byte case catch char class const continue data default do double else enum extends false \
        final finally float for fun if implements import instanceof int interface long native new null object override \
        package private protected public return short static super switch synchronized this throw throws true try val var \
        void volatile when while
        """), caseSensitive: true)
    static let cLike = SyntaxLanguage(
        lineComments: ["//"], blockComment: ("/*", "*/"), quotes: ["\"", "'"],
        keywords: words("""
        auto bool break case char class const continue default define delete do double else enum extern false float for \
        if include inline int long namespace new nullptr private protected public return short signed sizeof static \
        struct switch template this true typedef union unsigned using virtual void volatile while
        """), caseSensitive: true)
    static let csharp = SyntaxLanguage(
        lineComments: ["//"], blockComment: ("/*", "*/"), quotes: ["\"", "'"],
        keywords: words("""
        abstract as async await base bool break case catch class const continue default do double else enum false finally \
        float for foreach get if in int interface internal is namespace new null object override private protected public \
        readonly return sealed set static string struct switch this throw true try using var virtual void while
        """), caseSensitive: true)
    static let css = SyntaxLanguage(
        lineComments: ["//"], blockComment: ("/*", "*/"), quotes: ["\"", "'"],
        keywords: words("important media import keyframes include mixin extend font-face supports root"), caseSensitive: false)
    static let json = SyntaxLanguage(
        lineComments: [], blockComment: nil, quotes: ["\""], keywords: words("true false null"), caseSensitive: true)
    static let config = SyntaxLanguage(
        lineComments: ["#", ";"], blockComment: nil, quotes: ["\"", "'"], keywords: words("true false null yes no on off"),
        caseSensitive: false)
    static let shell = SyntaxLanguage(
        lineComments: ["#"], blockComment: nil, quotes: ["\"", "'"],
        keywords: words("""
        case do done echo elif else esac exit export fi for function if in local return then until while FROM RUN COPY \
        ADD CMD ENTRYPOINT ENV ARG WORKDIR EXPOSE
        """), caseSensitive: true)
    static let sql = SyntaxLanguage(
        lineComments: ["--"], blockComment: ("/*", "*/"), quotes: ["'", "\""],
        keywords: words("""
        add alter and as asc by create delete desc distinct drop exists from group having in index insert into is join \
        key left limit not null on or order primary references right select set table union update values where
        """), caseSensitive: false)
    static let markup = SyntaxLanguage(
        lineComments: [], blockComment: ("<!--", "-->"), quotes: ["\"", "'"], keywords: [], caseSensitive: true)
}

public enum SyntaxTokenKind: Sendable, Equatable {
    case keyword, string, comment, number
}

public struct SyntaxToken: Sendable, Equatable {
    /// Vị trí theo Character trong dòng.
    public let range: Range<Int>
    public let kind: SyntaxTokenKind
}

public enum SyntaxHighlighter {
    /// Dòng dài hơn chừng này ký tự thì không tô (file minified) để diff vẫn mượt.
    public static let maxLineLength = 2000

    public static func tokens(_ line: String, language: SyntaxLanguage) -> [SyntaxToken] {
        let chars = Array(line)
        guard !chars.isEmpty, chars.count <= maxLineLength else { return [] }
        var result: [SyntaxToken] = []
        var i = 0

        func hasPrefix(_ prefix: String, at index: Int) -> Bool {
            let p = Array(prefix)
            guard !p.isEmpty, index + p.count <= chars.count else { return false }
            return Array(chars[index..<index + p.count]) == p
        }

        while i < chars.count {
            let c = chars[i]
            if language.lineComments.contains(where: { hasPrefix($0, at: i) }) {
                result.append(SyntaxToken(range: i..<chars.count, kind: .comment))
                break
            }
            if let block = language.blockComment, hasPrefix(block.open, at: i) {
                var j = i + block.open.count
                while j < chars.count, !hasPrefix(block.close, at: j) { j += 1 }
                let end = min(chars.count, j + (j < chars.count ? block.close.count : 0))
                result.append(SyntaxToken(range: i..<end, kind: .comment))
                i = end
                continue
            }
            if language.quotes.contains(c) {
                var j = i + 1
                while j < chars.count, chars[j] != c {
                    j += chars[j] == "\\" ? 2 : 1
                }
                let end = min(chars.count, j + 1)
                result.append(SyntaxToken(range: i..<end, kind: .string))
                i = end
                continue
            }
            if c.isNumber, i == 0 || !(chars[i - 1].isLetter || chars[i - 1] == "_" || chars[i - 1] == "$") {
                var j = i + 1
                while j < chars.count, chars[j].isHexDigit || chars[j] == "." || chars[j] == "x" || chars[j] == "_" { j += 1 }
                result.append(SyntaxToken(range: i..<j, kind: .number))
                i = j
                continue
            }
            if c.isLetter || c == "_" || c == "$" || c == "@" {
                var j = i + 1
                while j < chars.count, chars[j].isLetter || chars[j].isNumber || chars[j] == "_" { j += 1 }
                var word = String(chars[i..<j])
                if word.hasPrefix("$") || word.hasPrefix("@") { word.removeFirst() }
                let isKeyword = language.caseSensitive ? language.keywords.contains(word)
                    : language.keywords.contains(word.lowercased())
                if isKeyword, !(i > 0 && chars[i - 1] == ".") {
                    result.append(SyntaxToken(range: i..<j, kind: .keyword))
                }
                i = j
                continue
            }
            i += 1
        }
        return result
    }
}
