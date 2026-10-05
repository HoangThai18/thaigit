import AppKit
import NhanhCore
import SwiftUI

/// Runs an automated script to capture UI screenshots while testing (only enabled when an environment variable
/// is set).
///
///     NHANH_OPEN=/path/to/repo NHANH_SNAPSHOT_DIR=/tmp/shots \
///     NHANH_STEPS="wait:2,snap:graph,select:wip,snap:wip,open:first,snap:diff,quit" Thaigit.app/Contents/MacOS/Thaigit
enum AutomationHarness {
    private static var started = false
    /// A screenshot script is running: never call the real GitHub API (fake data via `act:fakeprs` instead).
    /// Automated run: the secret store is the in-memory one, the real Keychain is never touched (no permission prompt).
    nonisolated static var isActive: Bool { ProcessInfo.processInfo.environment["NHANH_SNAPSHOT_DIR"] != nil }
    /// The launch timestamp (set in applicationDidFinishLaunching) used to measure load speed.
    private static var launchTime = Date()

    /// Force the light/dark appearance while testing (NHANH_APPEARANCE=dark|light).
    static func applyAppearance() {
        switch ProcessInfo.processInfo.environment["NHANH_APPEARANCE"] {
        case "dark": NSApp.appearance = NSAppearance(named: .darkAqua)
        case "light": NSApp.appearance = NSAppearance(named: .aqua)
        default: break
        }
        // In an inactive window the primary button, selection line… are drawn grey. macOS only lets an app come to the
        // front while the user is in the app that opened it (the terminal), so don't steal focus while the user works elsewhere.
        NSApp.activate()
    }

    /// Capture the welcome screen (when no repo is open), then quit.
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
                // Borrow the clipboard to exercise URL auto-fill, then put the old contents back after the shot.
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

    /// An open sheet blocks terminate — close everything then quit; the exit code makes it deterministic.
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
    /// Text pre-typed into the ⌘P command palette when capturing (the palette:<text> step).
    static var paletteQuery: String?
    /// The tabs of the window running the script (the newtab / tab:<path> / notes / selecttab:<n> steps).
    static weak var tabs: TabsModel?

    /// Writes diagnostic logs to stderr while an automated run is in progress.
    static func log(_ message: @autoclosure () -> String) {
        guard ProcessInfo.processInfo.environment["NHANH_SNAPSHOT_DIR"] != nil else { return }
        FileHandle.standardError.write(Data("harness: \(message())\n".utf8))
    }

    /// Take a screenshot if the script still hasn't run after a while (for diagnosis).
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
        // Only act on the repo that was named (skip tabs macOS restored by itself).
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
            // Open Settings at the given tab (general / git / account / ssh) — the Settings window is saved separately on "snap".
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
            // Select the first n changed lines of the first hunk.
            if case .text(let presentation) = model.diffState, let hunk = presentation.hunks.first {
                let count = Int(argument) ?? 1
                for line in hunk.lines.filter({ $0.kind == .addition || $0.kind == .deletion }).prefix(count) {
                    model.toggleLine(hunk: hunk, index: line.index, extend: false)
                }
            }
        case "toast":
            model.toast(.success, "Đã commit vào main", actions: [ToastAction(title: "Hoàn tác") {}])
        case "drag":
            // Simulate dropping branch `a` onto branch `b`: drag:a>b
            let names = argument.split(separator: ">").map(String.init)
            if names.count == 2,
               let source = model.refs.first(where: { $0.name == names[0] }),
               let target = model.refs.first(where: { $0.name == names[1] }) {
                model.dragRequest = DragRequest(source: source, target: .ref(target))
            }
        case "append":
            // Simulate an outside edit of a file (to check the auto-refresh): append:<path>
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
            // Write the lines currently on the graph (useful when the screenshot isn't clear enough).
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
                // Like pressing the Undo button on the toolbar (only runs when the button is enabled).
                log("canUndoLast=\(model.canUndoLast) \(model.lastUndo?.title ?? "-")")
                model.undoLast()
            case "undo":
                // Press the first button of the most recent notification (usually "Undo").
                if let toast = model.toasts.last(where: { !$0.actions.isEmpty }), let action = toast.actions.first {
                    model.dismissToast(toast.id)
                    action.handler()
                }
            case "newbranch":
                model.beginCreateBranchAtHead()
            case "compare":
                // Compare the commit at row a (base) with row b: act:compare:5:1
                let rows = value.split(separator: ":").compactMap { Int($0) }
                if rows.count == 2, let from = model.entry(at: rows[0]), let to = model.entry(at: rows[1]) {
                    model.select(.compare(from: from.commit.id, to: to.commit.id))
                }
            case "blame":
                // Blame a file in the working tree: act:blame:<path>
                model.sheet = .blame(path: value, rev: nil)
            case "irebase":
                // Interactive rebase from the commit at graph row n: act:irebase:4
                if let entry = model.entry(at: Int(value) ?? 3) { model.beginInteractiveRebase(from: entry.commit) }
            case "reword":
                // Open the message editor for the commit at row n: act:reword:2
                if let entry = model.entry(at: Int(value) ?? 1) { model.beginReword(entry.commit) }
            case "moveup", "movedown":
                // Swap the commit at row n with the next / previous one: act:moveup:3
                if let entry = model.entry(at: Int(value) ?? 1) { model.move(entry.commit, up: pieces[0] == "moveup") }
            case "fakeprs":
                // Fake PRs for every branch of the GitHub remote (except main) plus one forked PR — no network.
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
                // Edit the open file in-app; act:edit:<text> appends text (so the "Unsaved" state is visible).
                if let file = model.openFile {
                    model.beginEditing(file)
                    if !value.isEmpty { model.fileEditor?.text += value + "\n" }
                }
            case "term":
                // Open the in-app terminal and run a command: act:term:git status
                if model.terminal?.isVisible != true { model.toggleTerminal() }
                model.terminal?.send(value)
            case "ai":
                // Have the AI write a commit message for the staged changes, logging the result.
                log("ai: " + (CommitMessageAI.unavailableReason ?? "sẵn sàng"))
                await model.fillCommitMessageWithAI()
                log("ai summary: \(model.commitSummary) | body: \(model.commitBody.replacingOccurrences(of: "\n", with: " / "))")
            case "sheet":
                // Open a dialog by name: act:sheet:signing | worktree | flowinit | flowstart | lfs
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
                // Hide / solo a branch by name: act:hide:thu-nghiem, act:solo:main
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
            // Wait for the graph to finish loading, then write the time since the app opened.
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
            // Pick n commits in turn, measuring the average time the main thread spends on each (waiting time excluded).
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
            // Layout diagnosis: the parent view chain of each list (graph, sidebar…) plus frame/bounds.
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
            // Select the graph's Nth row as a user click would.
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

    /// Capture the whole window (title bar / toolbar included) of the app itself — no screen-recording permission needed.
    /// The main image has any open sheet / alert / popover composited onto the window as on screen.
    static func snapshot(to path: String) {
        let mainWindow = NSApp.windows.first(where: { $0.isVisible && $0.sheetParent == nil && $0.contentView != nil && $0.frame.width > 600 })
        guard let window = mainWindow else { return }
        // NSApp.orderedWindows skips panels (a confirmationDialog's alert), so they are ordered by their on-screen order instead: later first.
        let overlays = NSApp.windows
            .filter { $0 !== window && $0.isVisible && $0.frame.width > 40 }
            .sorted { $0.orderedIndex > $1.orderedIndex }
        if let image = composedImage(of: window, overlays: overlays) {
            write(image, to: path)
        } else {
            write(window, to: path)
        }
        // Each sheet / alert / popover is also saved on its own.
        for (index, other) in overlays.enumerated() {
            log("extra window \(index + 1): \(type(of: other)) \(Int(other.frame.width))x\(Int(other.frame.height))")
            let extraPath = path.replacingOccurrences(of: ".png", with: "-w\(index + 1).png")
            if let image = windowServerImage(of: other) { write(image, to: extraPath) } else { write(other, to: extraPath) }
        }
    }

    /// A capture produced by the window server — it includes Liquid Glass and the blurred materials that `cacheDisplay` can't draw.
    /// The app capturing its own window needs no screen-recording permission. CGWindowListCreateImage is hidden from
    /// newer SDKs (still present in CoreGraphics) so it's called via dlsym; without it, fall back to `cacheDisplay`.
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

    /// When the screen is locked or off the window server returns a solid-colour image: use `cacheDisplay` then.
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
