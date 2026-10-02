# Scout report — current Swift app (port inventory)

> **Đính chính (2026-10-02 — khi mâu thuẫn, `plan.md` là chuẩn):** app Swift nay tên **Thaigit** (`com.phanthai.thaigit`, `build/Thaigit.app`), **48 test** (thêm 7 test cập nhật + 1 test repository); sang Vitest port 39 test (Parser 10, Diff 6, GraphLayout 8, Repository 15), 2 test watcher sang Rust, 7 test cập nhật không port. "Paths never argv" không đúng hẳn: vài lệnh truyền path sau `--` (an toàn nhờ `GIT_LITERAL_PATHSPECS=1`). Env Swift đầy đủ ở `GitEnvironment.swift:33-49` (bỏ `LC_ALL`, `LANGUAGE=en`, `GIT_MERGE_AUTOEDIT=no`, pager) và cờ `-c` ở `GitRunner.swift:67-78` (có `core.fsmonitor=false`). App layer `Sources/Nhanh` ≈ 7,8k dòng. Repo lớn: 1.077 ref. Harness: dùng WebdriverIO + `@wdio/tauri-service` (phase 4a).

Source: thư mục gốc repo (Swift 6 / SwiftPM, macOS 14+, built with CLT + MacOSX26 SDK). 11,467 lines Swift. 40 tests (Swift Testing), all passing.

## Core (`Sources/NhanhCore`, ~2.8k lines) → port 1:1 to TypeScript (`packages/core`)

| Swift file | Lines | Responsibility | Port target / notes |
|---|---|---|---|
| Support/ProcessRunner.swift | 159 | spawn, concurrent stdout/stderr, stderr line callback (\r/\n), cancellation → SIGTERM | **Rust** `git_exec` (streaming via Tauri Channel), kill on cancel |
| Git/GitEnvironment.swift | 180 | resolve git path, login-shell PATH (macOS), askpass script (osascript), env vars | Rust: git discovery per OS; askpass helper per OS |
| Git/GitRunner.swift | 137 | global `-c` flags, env, accept exit codes, progress parse, CancellationError, command log record | TS `GitRunner` over Rust exec |
| Git/Models.swift | 383 | Commit, GitRef (+date), HeadState, Stash (displayMessage "WIP trên…"), FileChange, ConflictKind, WorkingTreeStatus, RepoOperation (title/shortName/canContinue/canSkip), CommitDetails | TS types |
| Git/Parsers.swift | 328 | log -z, for-each-ref %1f (+creatordate), status porcelain v2 -z, name-status -z, stash list, remotes, progress %, unquote git paths | TS, keep exact formats |
| Git/GitRepository.swift | 653 | ~80 operations (see below) | TS `Repository` class |
| Diff/Diff.swift | 285 | unified diff parser, hunks, line numbers, inline word diff | TS |
| Diff/PatchBuilder.swift | 159 | partial staging patches (forward/reverse), interleave del/add, `\ No newline` fix-ups, anchors | TS — **highest-risk port**, port all edge-case tests |
| Diff/ConflictFile.swift | 142 | conflict markers (incl. diff3 base), resolutions, CRLF preserve | TS |
| Diff/DiffPresentation.swift | 106 | display text (tabs→4 spaces, 1200 char cap), split rows | TS (UI helper) |
| Graph/GraphLayout.swift | 110 | lane assignment, per-lane color, WIP dashed lane | TS (pure, fast; tested 5k commits < 2s) |
| Support/RepoWatcher.swift | 124 | FSEvents, classify .git paths (ignore objects/, logs/, *.lock), realpath + case-insensitive prefix match | **Rust** `notify` crate; keep classifier in Rust or TS |
| Support/CommandLog.swift | 25 | ring buffer of executed commands | TS |

Git subcommands used: stash(7) reset(6) push(6) branch(5) switch(4) revert(4) rebase(4) cherry-pick(4) add(4) tag(3) rm(3) remote(3) merge(3) diff(3) config(3) update-ref(2) rev-parse(2) restore(2) log(2) fetch(2) diff-tree(2) check-ref-format(2) status show pull init for-each-ref commit clone checkout cat-file apply.

Invariants to keep:
- Global flags: `-c core.quotepath=false -c color.ui=false …`; env `GIT_TERMINAL_PROMPT=0`, `GIT_EDITOR=true`, `LC_MESSAGES=C`, `GIT_OPTIONAL_LOCKS=0` for status, `GIT_LITERAL_PATHSPECS=1`.
- Paths passed via `--pathspec-from-file=- --pathspec-file-nul` (stdin), never argv (Windows argv length limit too).
- Partial staging: `git apply --cached --recount` (unstage/discard = reverse patch).
- Undo: soft reset, `reset --merge`, `update-ref`, `stash store`, `stash create` snapshot + `restore --source`.
- Cancellation must surface as "cancelled", not a git error (exit 15 bug fixed earlier).

## Tests (`Tests/NhanhCoreTests`, 40) → port to Vitest

ParserTests 10 · DiffTests 6 (incl. EOF/no-newline patch cases) · GraphLayoutTests 8 · RepositoryTests 14 (real temp repos: staging lines, merge conflict lifecycle, rebase abort, stash round-trip, fetch/push/pull with local bare remote) · RepoWatcherTests 2. TestRepo helper isolates config (`GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1`).

## App layer (`Sources/Nhanh`, ~8.6k lines) → rebuild in web UI (spec, not code)

- Model: RepoModel (706) state/refresh pipeline (async parallel loads, fingerprint → reload history, debounce FS events 300 ms, defer while ops run, serialized operation chain, toasts w/ undo), +Actions (1252: every user action, menus, drop options, error→recovery toasts), +Diff (356: open diff, line selection, hunk/line apply, conflict resolve).
- Views: graph table (687+369: custom-drawn lanes/pills, drag source/target, context menu, column fitting/auto-hide, load-more on scroll), sidebar (480: LOCAL/REMOTE/TAGS/STASHES tree, lazy sections, paging "Hiện thêm", filter), staging (351), commit detail (260), diff pane (533: unified/split, hunk header buttons, line selection bar, image diff), conflict resolver (283), sheets (501: create/rename branch, tag, push, stash, identity, remote, command log, file history, switch-branch ⌘B), settings (116), welcome/clone (343), window/toolbar/menus (413+101).

## Lessons from Swift build (apply to Tauri port)

- Big repos: SwiftUI List diffing 1k refs cost ~1 s/update → UI lists must be virtualized + lazy (only expanded nodes), and not re-render on unrelated state (status/selection).
- Graph: 30k commits → load 2k at a time, lane layout off main thread, virtualized rows.
- Watcher: compare realpaths (macOS `/tmp`→`/private/tmp`), case-insensitive on default APFS/NTFS.
- Columns: commit message column flexes; shrink author/date/refs to floors, then hide SHA→date→author when narrow.
- Test harness via env vars (open repo, run steps, snapshot) was essential for UI verification — keep an equivalent (Playwright/WebDriver for Tauri, or in-app script runner).

## Branding

Current name "Nhánh" (bundle `com.phanthai.nhanh`, exec `Nhanh`, app support dir `Nhanh`, askpass title "Nhánh"). User decision 2026-10-02: rename product to **Thaigit**; logo to be generated by user with Meta "Muse Image" (no API/tool access from agent).
