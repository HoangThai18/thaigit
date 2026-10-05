import AppKit
import NhanhCore
import SwiftUI

/// Chạy kịch bản tự động để chụp ảnh giao diện khi kiểm thử (chỉ bật khi có biến môi trường).
///
///     NHANH_OPEN=/đường/dẫn/repo NHANH_SNAPSHOT_DIR=/tmp/anh \
///     NHANH_STEPS="wait:2,snap:graph,select:wip,snap:wip,open:first,snap:diff,quit" Thaigit.app/Contents/MacOS/Thaigit
enum AutomationHarness {
    private static var started = false
    /// Đang chạy kịch bản chụp ảnh: không gọi API GitHub thật (dùng dữ liệu giả qua `act:fakeprs`).
    /// Chạy tự động: kho bí mật dùng bản trong bộ nhớ, không đụng Keychain thật (không bật hộp hỏi quyền).
    nonisolated static var isActive: Bool { ProcessInfo.processInfo.environment["NHANH_SNAPSHOT_DIR"] != nil }
    /// Mốc thời gian khởi động (đặt trong applicationDidFinishLaunching) để đo tốc độ tải.
    private static var launchTime = Date()

    /// Áp dụng giao diện sáng/tối ép buộc khi kiểm thử (NHANH_APPEARANCE=dark|light).
    static func applyAppearance() {
        switch ProcessInfo.processInfo.environment["NHANH_APPEARANCE"] {
        case "dark": NSApp.appearance = NSAppearance(named: .darkAqua)
        case "light": NSApp.appearance = NSAppearance(named: .aqua)
        default: break
        }
        // Cửa sổ không active thì nút chính, dòng chọn… vẽ màu xám. macOS chỉ cho app lên trước khi người dùng
        // đang ở app đã mở nó (terminal), nên không giành focus khi người dùng đang làm việc khác.
        NSApp.activate()
    }

    /// Chụp màn hình chào (khi không mở repo nào) rồi thoát.
    static func attachWelcome() {
        let environment = ProcessInfo.processInfo.environment
        guard !started, environment["NHANH_OPEN"] == nil, let directory = environment["NHANH_SNAPSHOT_DIR"] else { return }
        started = true
        applyAppearance()
        try? FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
        Task {
            try? await Task.sleep(for: .seconds(2))
            snapshot(to: (directory as NSString).appendingPathComponent("welcome.png"))
            if environment["NHANH_STEPS"]?.contains("clone") == true {
                // Mượn clipboard để thử tự điền URL, chụp xong trả lại nội dung cũ.
                let pasteboard = NSPasteboard.general
                let saved = pasteboard.pasteboardItems?.map { item in
                    item.types.reduce(into: [NSPasteboard.PasteboardType: Data]()) { $0[$1] = item.data(forType: $1) }
                } ?? []
                pasteboard.clearContents()
                pasteboard.setString("https://github.com/apple/swift-format.git", forType: .string)
                if let actions = welcomeActions { actions.showClone() }
                try? await Task.sleep(for: .seconds(1.5))
                snapshot(to: (directory as NSString).appendingPathComponent("clone.png"))
                pasteboard.clearContents()
                pasteboard.writeObjects(saved.map { contents in
                    let item = NSPasteboardItem()
                    for (type, data) in contents { item.setData(data, forType: type) }
                    return item
                })
            }
            await quit()
        }
    }

    /// Sheet đang mở chặn terminate — đóng hết rồi thoát; chốt chặn bằng exit.
    private static func quit() async {
        for window in NSApp.windows {
            for sheet in window.sheets { window.endSheet(sheet) }
        }
        NSApp.terminate(nil)
        try? await Task.sleep(for: .seconds(2))
        exit(0)
    }

    static var welcomeActions: WindowActions?
    static weak var windowActions: WindowActions?
    /// Chữ gõ sẵn vào bảng lệnh ⌘P khi chụp ảnh (bước palette:<chữ>).
    static var paletteQuery: String?
    /// Các tab của cửa sổ đang chạy kịch bản (bước newtab / tab:<đường dẫn> / notes / selecttab:<n>).
    static weak var tabs: TabsModel?

    /// Ghi log chẩn đoán ra stderr khi đang chạy kiểm thử tự động.
    static func log(_ message: @autoclosure () -> String) {
        guard ProcessInfo.processInfo.environment["NHANH_SNAPSHOT_DIR"] != nil else { return }
        FileHandle.standardError.write(Data("harness: \(message())\n".utf8))
    }

    /// Chụp ảnh nếu sau một lúc kịch bản vẫn chưa chạy (để chẩn đoán).
    static func startWatchdog() {
        let environment = ProcessInfo.processInfo.environment
        guard let directory = environment["NHANH_SNAPSHOT_DIR"] else { return }
        launchTime = Date()
        Task {
            try? await Task.sleep(for: .seconds(8))
            guard !started else { return }
            try? FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
            log("watchdog: kịch bản chưa chạy, windows=\(NSApp.windows.map { "\(type(of: $0)) visible=\($0.isVisible) title=\($0.title)" })")
            snapshot(to: (directory as NSString).appendingPathComponent("watchdog.png"))
        }
    }

    static func attach(_ model: RepoModel) {
        let environment = ProcessInfo.processInfo.environment
        log("attach \(model.repository.root.path) started=\(started)")
        guard !started, let directory = environment["NHANH_SNAPSHOT_DIR"] else { return }
        // Chỉ chạy trên repo được chỉ định (bỏ qua các tab được macOS khôi phục).
        if let target = environment["NHANH_OPEN"], !target.isEmpty,
           URL(fileURLWithPath: target).resolvingSymlinksInPath().path != model.repository.root.resolvingSymlinksInPath().path {
            return
        }
        started = true
        applyAppearance()
        let steps = (environment["NHANH_STEPS"] ?? "wait:3,snap:graph,quit")
            .split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        try? FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
        Task {
            for step in steps {
                await run(step, model: model, directory: directory)
            }
        }
    }

    private static func run(_ step: String, model: RepoModel, directory: String) async {
        let parts = step.split(separator: ":", maxSplits: 1).map(String.init)
        let command = parts[0]
        let argument = parts.count > 1 ? parts[1] : ""
        switch command {
        case "wait":
            try? await Task.sleep(for: .seconds(Double(argument) ?? 1))
        case "settings":
            // Mở Cài đặt ở thẻ chỉ định (general / git / account / ssh) — cửa sổ Cài đặt được lưu riêng khi "snap".
            UserDefaults.standard.set(argument.isEmpty ? SettingsTab.general.rawValue : argument, forKey: Prefs.settingsTab)
            if let menu = NSApp.mainMenu?.items.first?.submenu,
               let index = menu.items.firstIndex(where: { $0.keyEquivalent == "," }) {
                menu.performActionForItem(at: index)
            }
        case "snap":
            try? await Task.sleep(for: .milliseconds(400))
            snapshot(to: (directory as NSString).appendingPathComponent((argument.isEmpty ? "snap" : argument) + ".png"))
        case "size":
            let dims = argument.split(separator: "x").compactMap { Double($0) }
            if dims.count == 2, let window = NSApp.windows.first(where: \.isVisible) {
                var frame = window.frame
                frame.size = NSSize(width: dims[0], height: dims[1])
                window.setFrame(frame, display: true)
            }
        case "select":
            if argument == "wip" {
                model.select(.workingTree, reveal: true)
            } else if argument == "head" {
                model.revealHead()
            } else if let row = Int(argument), let entry = model.entry(at: row) {
                model.select(entry.commit.isWorkingTree ? .workingTree : .commit(entry.commit.id), reveal: true)
            }
        case "open":
            try? await Task.sleep(for: .milliseconds(500))
            switch model.selection {
            case .workingTree:
                if argument == "conflict", let entry = model.status.conflicts.first {
                    model.openConflict(entry)
                } else if argument == "staged", let change = model.status.staged.first {
                    model.openDiff(change, source: .staged)
                } else if let change = model.status.unstaged.first(where: { $0.path == argument }) {
                    model.openDiff(change, source: .unstaged)
                } else if let change = model.status.unstaged.first(where: { $0.kind != .untracked }) ?? model.status.unstaged.first {
                    model.openDiff(change, source: .unstaged)
                }
            case .commit(let sha):
                if let change = model.commitDetails?.files.first { model.openDiff(change, source: .commit(sha)) }
            case .compare(let from, let to):
                if let change = model.comparison?.files.first(where: { $0.path == argument }) ?? model.comparison?.files.first {
                    model.openDiff(change, source: .compare(from: from, to: to))
                }
            default:
                break
            }
        case "close":
            model.closeFile()
        case "split":
            UserDefaults.standard.set(argument == "on", forKey: Prefs.diffSplit)
        case "search":
            model.searchText = argument
        case "inspector":
            model.showInspector = argument != "off"
        case "newtab":
            tabs?.newTab()
        case "tab":
            tabs?.open(path: argument)
        case "notes":
            tabs?.openReleaseNotes()
        case "palette":
            paletteQuery = argument.isEmpty ? nil : argument
            windowActions?.showPalette()
        case "selecttab":
            tabs?.select(number: Int(argument) ?? 1)
        case "selectlines":
            // Chọn n dòng thay đổi đầu tiên của hunk đầu tiên.
            if case .text(let presentation) = model.diffState, let hunk = presentation.hunks.first {
                let count = Int(argument) ?? 1
                for line in hunk.lines.filter({ $0.kind == .addition || $0.kind == .deletion }).prefix(count) {
                    model.toggleLine(hunk: hunk, index: line.index, extend: false)
                }
            }
        case "toast":
            model.toast(.success, "Đã commit vào main", actions: [ToastAction(title: "Hoàn tác") {}])
        case "drag":
            // Mô phỏng thả nhánh `a` lên nhánh `b`: drag:a>b
            let names = argument.split(separator: ">").map(String.init)
            if names.count == 2,
               let source = model.refs.first(where: { $0.name == names[0] }),
               let target = model.refs.first(where: { $0.name == names[1] }) {
                model.dragRequest = DragRequest(source: source, target: .ref(target))
            }
        case "append":
            // Giả lập sửa file từ bên ngoài app (để kiểm tra tự làm mới): append:đường/dẫn
            let url = model.repository.root.appendingPathComponent(argument)
            if let handle = try? FileHandle(forWritingTo: url) {
                handle.seekToEndOfFile()
                handle.write(Data("// sửa từ bên ngoài\n".utf8))
                try? handle.close()
            } else {
                try? Data("mới\n".utf8).write(to: url)
            }
        case "summary":
            model.commitSummary = argument
        case "dump":
            // Ghi các dòng đang có trên graph (kiểm tra khi ảnh chụp không đủ rõ).
            log("graph: " + model.entries.map { $0.commit.subject + ($0.labels.isEmpty ? "" : " [" + $0.labels.map(\.text).joined(separator: ",") + "]") }
                .joined(separator: " | "))
        case "act":
            let pieces = argument.split(separator: ":", maxSplits: 1).map(String.init)
            let value = pieces.count > 1 ? pieces[1] : ""
            switch pieces[0] {
            case "stageall": model.stageAll()
            case "commit": model.commit()
            case "merge": model.merge(value, label: value)
            case "checkout":
                if let ref = model.refs.first(where: { $0.name == value }) { model.checkout(ref) }
            case "stagehunk":
                if case .text(let presentation) = model.diffState, let hunk = presentation.hunks.first { model.apply(.stage, hunk: hunk) }
            case "stagelines": model.applySelectedLines(.stage)
            case "stash": model.quickStash()
            case "pop": model.popLatestStash()
            case "fetch": model.fetch()
            case "push": model.push()
            case "pull": model.pull()
            case "undolast":
                // Như bấm nút Undo trên thanh công cụ (chỉ chạy khi nút đang bật).
                log("canUndoLast=\(model.canUndoLast) \(model.lastUndo?.title ?? "-")")
                model.undoLast()
            case "undo":
                // Bấm nút đầu tiên của thông báo mới nhất (thường là "Hoàn tác").
                if let toast = model.toasts.last(where: { !$0.actions.isEmpty }), let action = toast.actions.first {
                    model.dismissToast(toast.id)
                    action.handler()
                }
            case "newbranch":
                model.beginCreateBranchAtHead()
            case "compare":
                // So sánh commit ở dòng a (gốc) với dòng b: act:compare:5:1
                let rows = value.split(separator: ":").compactMap { Int($0) }
                if rows.count == 2, let from = model.entry(at: rows[0]), let to = model.entry(at: rows[1]) {
                    model.select(.compare(from: from.commit.id, to: to.commit.id))
                }
            case "blame":
                // Blame file trong working tree: act:blame:đường/dẫn
                model.sheet = .blame(path: value, rev: nil)
            case "irebase":
                // Interactive rebase từ commit ở dòng n của graph: act:irebase:4
                if let entry = model.entry(at: Int(value) ?? 3) { model.beginInteractiveRebase(from: entry.commit) }
            case "reword":
                // Mở hộp sửa message cho commit ở dòng n: act:reword:2
                if let entry = model.entry(at: Int(value) ?? 1) { model.beginReword(entry.commit) }
            case "moveup", "movedown":
                // Đổi chỗ commit ở dòng n với commit liền sau / liền trước: act:moveup:3
                if let entry = model.entry(at: Int(value) ?? 1) { model.move(entry.commit, up: pieces[0] == "moveup") }
            case "fakeprs":
                // PR giả cho mọi nhánh của remote GitHub (trừ main) và một PR từ fork — không gọi mạng.
                if let github = model.githubRemote {
                    var pulls = model.remoteBranches
                        .filter { $0.remoteName == github.name && $0.shortBranchName != "main" && $0.shortBranchName != "HEAD" }
                        .enumerated().map { index, ref in
                            GitHubPullRequest(number: 12 + index * 3, title: model.commit(for: ref.target)?.subject ?? ref.shortBranchName,
                                              isDraft: index == 1,
                                              webURL: URL(string: "https://github.com/\(github.repo.owner)/\(github.repo.name)/pull/\(12 + index * 3)"),
                                              author: index == 0 ? "tuan-bui" : "ngoc-anh", headBranch: ref.shortBranchName, headSHA: ref.target,
                                              headRepository: "\(github.repo.owner)/\(github.repo.name)", baseBranch: "main",
                                              updatedAt: Date().addingTimeInterval(Double(-3600 * (index + 1))))
                        }
                    pulls.append(GitHubPullRequest(number: 9, title: "Sửa lỗi hiển thị giá trên điện thoại", author: "ban-dong-gop",
                                                   headBranch: "sua-gia", headSHA: String(repeating: "a", count: 40),
                                                   headRepository: "ban-dong-gop/\(github.repo.name)", baseBranch: "main"))
                    model.pullRequestsTask?.cancel()
                    model.pullRequests = PullRequestList(state: .loaded, items: pulls, repo: github.repo, remoteName: github.name,
                                                         loadedAt: Date())
                    model.refreshLabels()
                }
            case "edit":
                // Sửa file đang mở trong app; act:edit:<chữ> thêm chữ vào cuối (để thấy trạng thái "Chưa lưu").
                if let file = model.openFile {
                    model.beginEditing(file)
                    if !value.isEmpty { model.fileEditor?.text += value + "\n" }
                }
            case "term":
                // Mở terminal trong app và chạy lệnh: act:term:git status
                if model.terminal?.isVisible != true { model.toggleTerminal() }
                model.terminal?.send(value)
            case "ai":
                // AI viết commit message cho thay đổi đã stage, ghi kết quả ra log.
                log("ai: " + (CommitMessageAI.unavailableReason ?? "sẵn sàng"))
                await model.fillCommitMessageWithAI()
                log("ai summary: \(model.commitSummary) | body: \(model.commitBody.replacingOccurrences(of: "\n", with: " / "))")
            case "sheet":
                // Mở hộp thoại theo tên: act:sheet:signing | worktree | flowinit | flowstart | lfs
                switch value {
                case "signing": model.sheet = .commitSigning
                case "worktree": model.sheet = .addWorktree
                case "flowinit": model.sheet = .gitFlowInit
                case "flowstart": model.sheet = .gitFlowStart(.feature)
                case "lfs": model.sheet = .lfsTrack
                case "issues": model.sheet = .issues
                default: break
                }
            case "hide", "solo":
                // Ẩn / solo nhánh theo tên: act:hide:thu-nghiem, act:solo:main
                if let ref = model.refs.first(where: { $0.kind != .tag && $0.name == value }) {
                    if pieces[0] == "hide" { model.toggleHidden(ref) } else { model.toggleSolo(ref) }
                }
            case "createpr":
                model.beginCreatePullRequest(from: model.localBranches.first { $0.name == value } ?? model.currentBranchRef)
            case "addremote":
                model.sheet = .addRemote
            case "switchbranch":
                model.sheet = .switchBranch
            case "resolve":
                if let entry = model.status.conflicts.first { model.resolveConflict(entry, useOurs: value != "theirs") }
            case "continue": model.continueOperation()
            case "abort": model.abortOperation()
            default: break
            }
        case "confirm":
            if let confirmation = model.confirmation {
                model.confirmation = nil
                confirmation.action()
            }
        case "dropoption":
            if let request = model.dragRequest {
                let index = Int(argument) ?? 0
                let actions = model.dropOptions(request).compactMap { item -> (() -> Void)? in
                    if case .action(_, _, _, let enabled, let handler) = item, enabled { return handler }
                    return nil
                }
                model.dragRequest = nil
                if actions.indices.contains(index) { actions[index]() }
            }
        case "ready":
            // Chờ graph tải xong rồi ghi thời gian kể từ lúc mở app.
            while !model.hasLoaded || model.entries.isEmpty {
                try? await Task.sleep(for: .milliseconds(20))
            }
            log(String(format: "ready sau %.2fs: %d hàng, %d ref, graph rộng %d làn",
                       Date().timeIntervalSince(launchTime), model.entries.count, model.refs.count, model.graphWidth))
            for record in model.commandLog.records {
                log(String(format: "  +%.2fs %.3fs git %@", record.startedAt.timeIntervalSince(launchTime), record.duration,
                           record.arguments.prefix(4).joined(separator: " ")))
            }
        case "more":
            let before = Date()
            model.loadMoreHistory()
            try? await Task.sleep(for: .milliseconds(20))
            while model.isLoadingHistory { try? await Task.sleep(for: .milliseconds(20)) }
            log(String(format: "tải thêm %.2fs → %d hàng", Date().timeIntervalSince(before), model.entries.count))
        case "benchselect":
            // Chọn lần lượt N commit, đo thời gian trung bình luồng chính xử lý mỗi lần (đã trừ thời gian chờ).
            let count = Int(argument) ?? 20
            let before = Date()
            for row in 1...count {
                if let entry = model.entry(at: row) { model.select(.commit(entry.commit.id), reveal: true) }
                try? await Task.sleep(for: .milliseconds(10))
            }
            let average = (Date().timeIntervalSince(before) - Double(count) * 0.010) / Double(count)
            log(String(format: "chọn commit: trung bình %.1f ms/lần", average * 1000))
        case "refresh":
            let before = Date()
            await model.refreshAndWait(.all)
            log(String(format: "làm mới %.2fs", Date().timeIntervalSince(before)))
        case "log":
            log("sheet=\(String(describing: model.sheet)) windows=\(NSApp.windows.map { "\(type(of: $0)) visible=\($0.isVisible) sheet=\($0.isSheet) \(Int($0.frame.width))x\(Int($0.frame.height)) sheets=\($0.sheets.count)" })")
        case "tree":
            // Chẩn đoán bố cục: chuỗi view cha của từng bảng (graph, sidebar…) kèm frame/bounds.
            guard let window = NSApp.windows.first(where: { $0.isVisible && $0.frame.width > 600 }), let root = window.contentView else { break }
            for (index, table) in tables(in: root).enumerated() {
                var chain: [String] = []
                var view: NSView? = table
                while let current = view {
                    let bounds = current.bounds
                    var entry = "\(type(of: current)) f=\(Int(current.frame.minX)),\(Int(current.frame.minY)) \(Int(current.frame.width))x\(Int(current.frame.height))"
                    if bounds.origin != .zero { entry += " b.origin=\(Int(bounds.minX)),\(Int(bounds.minY))" }
                    if let scroll = current as? NSScrollView { entry += " insets.top=\(Int(scroll.contentInsets.top)) auto=\(scroll.automaticallyAdjustsContentInsets)" }
                    chain.append(entry)
                    view = current.superview
                }
                log("[\(argument)] table \(index) rows=\(table.numberOfRows):\n    " + chain.joined(separator: "\n    "))
            }
        case "graphselect":
            // Chọn hàng thứ N của graph như người dùng bấm.
            guard let window = NSApp.windows.first(where: { $0.isVisible && $0.frame.width > 600 }), let root = window.contentView,
                  let table = tables(in: root).first(where: { $0 is CommitNSTableView }), let row = Int(argument), row < table.numberOfRows else { break }
            table.selectRowIndexes(IndexSet(integer: row), byExtendingSelection: false)
        case "quit":
            await quit()
        default:
            break
        }
    }

    private static func tables(in view: NSView) -> [NSTableView] {
        if let table = view as? NSTableView { return [table] }
        return view.subviews.flatMap { tables(in: $0) }
    }

    /// Chụp toàn bộ cửa sổ (kể cả thanh tiêu đề/toolbar) của chính app — không cần quyền ghi màn hình.
    /// Ảnh chính ghép sẵn sheet/alert/popover đang mở lên cửa sổ như trên màn hình.
    static func snapshot(to path: String) {
        let mainWindow = NSApp.windows.first(where: { $0.isVisible && $0.sheetParent == nil && $0.contentView != nil && $0.frame.width > 600 })
        guard let window = mainWindow else { return }
        // NSApp.orderedWindows bỏ qua panel (alert của confirmationDialog) nên tự xếp theo thứ tự trên màn hình, sau ra trước.
        let overlays = NSApp.windows
            .filter { $0 !== window && $0.isVisible && $0.frame.width > 40 }
            .sorted { $0.orderedIndex > $1.orderedIndex }
        if let image = composedImage(of: window, overlays: overlays) {
            write(image, to: path)
        } else {
            write(window, to: path)
        }
        // Từng sheet/alert/popover cũng lưu riêng.
        for (index, other) in overlays.enumerated() {
            log("extra window \(index + 1): \(type(of: other)) \(Int(other.frame.width))x\(Int(other.frame.height))")
            let extraPath = path.replacingOccurrences(of: ".png", with: "-w\(index + 1).png")
            if let image = windowServerImage(of: other) { write(image, to: extraPath) } else { write(other, to: extraPath) }
        }
    }

    /// Bản chụp do window server dựng — có cả Liquid Glass và vật liệu mờ, thứ mà `cacheDisplay` không vẽ được.
    /// App chụp cửa sổ của chính nó thì không cần quyền ghi màn hình. CGWindowListCreateImage bị ẩn khỏi SDK mới
    /// (vẫn có trong CoreGraphics) nên gọi qua dlsym; không có thì quay về `cacheDisplay`.
    private static func windowServerImage(of window: NSWindow) -> CGImage? {
        typealias CreateImage = @convention(c) (CGRect, UInt32, UInt32, UInt32) -> Unmanaged<CGImage>?
        guard let symbol = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "CGWindowListCreateImage") else { return nil }
        let create = unsafeBitCast(symbol, to: CreateImage.self)
        let includingWindow: UInt32 = 1 << 3
        let ignoreFramingBestResolution: UInt32 = (1 << 0) | (1 << 3)
        guard let image = create(.null, includingWindow, UInt32(window.windowNumber), ignoreFramingBestResolution)?.takeRetainedValue(),
              image.width > 1, !isBlank(image) else { return nil }
        return image
    }

    /// Màn hình đang khoá / tắt thì window server trả về ảnh một màu: khi đó dùng `cacheDisplay`.
    private static func isBlank(_ image: CGImage) -> Bool {
        let side = 24
        var pixels = [UInt8](repeating: 0, count: side * side * 4)
        guard let context = CGContext(data: &pixels, width: side, height: side, bitsPerComponent: 8, bytesPerRow: side * 4,
                                      space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
        context.draw(image, in: CGRect(x: 0, y: 0, width: side, height: side))
        let first = Array(pixels[0..<4])
        return stride(from: 0, to: pixels.count, by: 4).allSatisfy { Array(pixels[$0..<$0 + 4]) == first }
    }

    private static func composedImage(of window: NSWindow, overlays: [NSWindow]) -> CGImage? {
        guard let base = windowServerImage(of: window) else { return nil }
        let scale = CGFloat(base.width) / window.frame.width
        guard let context = CGContext(
            data: nil, width: base.width, height: base.height, bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { return nil }
        context.draw(base, in: CGRect(x: 0, y: 0, width: base.width, height: base.height))
        for overlay in overlays {
            guard let image = windowServerImage(of: overlay) else { continue }
            let frame = overlay.frame
            let rect = CGRect(
                x: (frame.minX - window.frame.minX) * scale, y: (frame.minY - window.frame.minY) * scale,
                width: frame.width * scale, height: frame.height * scale
            )
            context.saveGState()
            context.setShadow(offset: CGSize(width: 0, height: -8 * scale), blur: 28 * scale, color: NSColor.black.withAlphaComponent(0.28).cgColor)
            context.draw(image, in: rect)
            context.restoreGState()
        }
        return context.makeImage()
    }

    private static func write(_ image: CGImage, to path: String) {
        let representation = NSBitmapImageRep(cgImage: image)
        if let data = representation.representation(using: .png, properties: [:]) {
            try? data.write(to: URL(fileURLWithPath: path))
        }
    }

    private static func write(_ window: NSWindow, to path: String) {
        guard let content = window.contentView else { return }
        let view = content.superview ?? content
        guard let representation = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return }
        view.cacheDisplay(in: view.bounds, to: representation)
        if let data = representation.representation(using: .png, properties: [:]) {
            try? data.write(to: URL(fileURLWithPath: path))
        }
    }
}
