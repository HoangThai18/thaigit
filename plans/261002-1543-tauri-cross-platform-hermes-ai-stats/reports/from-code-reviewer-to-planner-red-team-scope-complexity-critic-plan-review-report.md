# Red-team plan review: scope & complexity critic and contract verifier

- **Plan:** `plans/261002-1543-tauri-cross-platform-hermes-ai-stats/` (plan.md, phase-01..09, research/*, reports/scout-report.md)
- **Reference codebase:** Swift app at the repo root (`Sources/`, `Tests/`, `scripts/`, `Resources/`)
- **Date:** 2026-10-02
- **Perspective:** YAGNI enforcer, plus cross-phase contract verification
- **Not re-litigated (user decisions):** Tauri 2 single codebase for Windows and macOS; AI through the owner's proxy holding the Hermes key; backend on the owner's VPS; expanded scope
- **Method:** every claim below was checked with grep/wc against the plan files and the Swift sources. `research/make-big-repo.py` was actually run. Tauri and `trash` crate behaviour was checked against current docs (sources at the end).

---

## Finding 1: No MVP cut line. The first usable Windows build lands at weeks 8–11 and is gated on the whole VPS server
- **Severity:** Critical
- **Location:** plan.md, section "Thứ tự & song song"; Phase 8 frontmatter `dependencies` and "Implementation Steps" step 6; Phase 1 "Requirements"
- **Flaw:** The only Windows artifact before the beta is phase 1's "Hello" window. The first build a user can run is phase 8 step 6 "Bản beta v0.1.0", and phase 8 depends on phases 4, 5 **and 7**. Phase 7 is on that path only because the updater manifest and release registration live on the VPS. The "10–13 weeks" estimate equals the raw sum of the phase estimates (47–65 working days = 9.4–13.0 weeks), so it has zero contingency. Phase 8 itself adds an unbounded Apple-enrolment wait. "Phase 7 in parallel" is not parallel for one developer. No milestone says what ships if work stops at that point.
- **Failure scenario:** Around week 7, phase 5 (DnD, conflicts, split diff) slips, and phase 7 is half-done because it was "parallel". Nothing is distributable. Windows-only defects (CRLF line staging, Defender spawn latency, WebView2 DPI canvas blur) have only been seen in CI or a VM. The beta feedback loop that phase 9 depends on starts after every feature is built, which is when rework costs the most.
- **Evidence:**
  - plan.md:52 "1 → 2 → 3 → 4 → 5 → 9 là đường chính. Phase 7 (server) làm song song từ sau phase 1 … Phase 8 cần 4, 5, 7."
  - plan.md:53 "khoảng 10–13 tuần cho 1 người"
  - Effort fields: phase-01-foundation-branding.md:6 "2-3 ngày", phase-02-rust-backend-bridge.md:6 "4-6", phase-03-typescript-core-port.md:6 "6-8", phase-04-ui-shell-graph-sidebar.md:6 "8-10", phase-05-staging-diff-conflicts-drag-drop.md:6 "10-14", phase-06-ai-commit-features-hermes.md:6 "3-4 ngày (client)", phase-07-vps-server-ai-proxy-stats-updater.md:6 "5-7", phase-08-landing-page-release-pipeline.md:6 "4-6 ngày (+ thời gian chờ duyệt Apple Developer…)", phase-09-windows-hardening-qa-launch.md:6 "5-7". Sum: 47–65 days.
  - phase-08-landing-page-release-pipeline.md:7 "dependencies: [4, 5, 7]"; :60 "Bản beta v0.1.0 cho nhóm nhỏ dùng thử". P1–P5 + P7 + P8 is 39–54 working days before any user build exists.
  - phase-08-landing-page-release-pipeline.md:33 updater endpoint `https://<domain>/v1/update/...`; :45 `POST /admin/api/releases`
  - phase-01-foundation-branding.md:25 (Hello window only); :57 "Chạy được trên Windows (máy thật hoặc VM/CI artifact)"
  - phase-07-vps-server-ai-proxy-stats-updater.md:20 "Làm song song được với phase 3–5."
  - plan.md:55-62: six open questions. #1 (domain) and #5 (public/private repo) gate phases 7 and 8.
- **Suggested fix:** Add milestones that each produce an installable build:
  - **M1 "Windows read-only viewer"** (P1 + P2 without askpass + P3 + P4-lite: open repo, graph, sidebar, commit detail). Unsigned NSIS from CI; dogfood on real Windows by about week 4–5.
  - **M2 "daily driver"** (stage file/line, commit, undo, push/pull, stash, conflict banner). First beta. The updater reads a static `latest.json` (tauri-action on GitHub Releases, or a static file served by Caddy), so no Hono server is needed.
  - **M3:** AI commit message on a minimal server (stream, cancel, consent, error states only; options menu, style learning and per-repo toggle come later).
  - **M4:** stats, admin, landing. Then 1.0.
  - Remove 7 from phase 8's dependencies. Either budget 20–30% contingency or label 13 weeks as best case.

## Finding 2: Phases 4 and 5 are each a full product rewrite with all-or-nothing exit criteria
- **Severity:** High
- **Location:** Phase 4 "Requirements", "Success Criteria", "Risk Assessment"; Phase 5 "Requirements", "Todo List", "Success Criteria"; Phase 2 "Requirements" (OS integration)
- **Flaw:**
  - **Phase 4** re-implements the spec of **3,540 Swift lines** in 8–10 days: RepoWindowView 413, CommitGraphView 687, GraphCells 369, GraphStyle 65, SidebarView 480, CommitDetailView 260, WelcomeView 182, CloneSheet 161, SettingsView 116, AppCommands 101, RepoModel 706. It also adds net-new work the Swift app does not have: in-app tabs with restore, i18n, a canvas overlay, a worker pipeline and theme tokens.
  - **Phase 5** re-implements **3,276 Swift lines** in 10–14 days: StagingView 351, DiffPane 533, ConflictResolverView 283, Sheets 501, RepoModel+Diff 356, RepoModel+Actions 1252. It adds a custom DnD engine, two virtualized diff renderers and UI-test scenarios.
  - Both exit gates are binary: "the entire Swift regression suite on both OSes" and "graph identical to Swift (screenshot compare)".
  - Phase 4 also requires manual visual testing on both OSes for **every PR**.
  - Phase 2 widens OS integration beyond Swift. It detects four terminals and four editors per OS for an "Open with…" menu, while Swift opens the first one it finds (Sources/Nhanh/Model/RepoModel+Actions.swift:975-997).
- **Failure scenario:** On day 10 of phase 4, graph and sidebar work, but tabs, settings, i18n, column reorder and search are half-done. The phase cannot close, so staging (the feature that makes the app usable) has not started by week 5. For a solo developer, "test both OSes on each PR" means booting a Windows machine or VM for every small PR.
- **Evidence:**
  - phase-04-ui-shell-graph-sidebar.md:13 "Đạt tương đương bản Swift ở các phần này"; :16 (Swift spec files); :28-35 (welcome, tabs, toolbar, graph, sidebar, inspector, settings, RepoStore); :78 "graph đúng như bản Swift (so ảnh chụp)"; :83 "test trực quan cả 2 OS mỗi PR"
  - phase-05-staging-diff-conflicts-drag-drop.md:59-67 (8 todo items); :70 "Toàn bộ kịch bản hồi quy của bản Swift chạy đúng trên cả 2 OS"
  - phase-02-rust-backend-bridge.md:34, :58 ("Mở bằng…" detection lists)
  - `wc -l`: Sources/Nhanh/Model/RepoModel+Actions.swift 1252, Sources/Nhanh/Model/RepoModel.swift 706, Sources/Nhanh/Views/Graph/CommitGraphView.swift 687, Sources/Nhanh/Views/Diff/DiffPane.swift 533, Sources/Nhanh/Views/Sheets/Sheets.swift 501
- **Suggested fix:** Split into vertical slices, each ending in a runnable build:
  - 4a: RepoStore, graph, sidebar (read-only)
  - 4b: toolbar, branch switch, welcome, clone
  - 5a: file-level stage, commit, undo
  - 5b: unified diff with hunk/line staging
  - 5c: conflict resolver, banners, dialogs
  - 5d (after M2): split view, image diff, DnD

  Replace "parity with Swift" with a numbered MVP feature list. Replace "dual-OS manual test per PR" with "Windows CI green per PR, plus a manual Windows pass per milestone". OS integration should open the first app found, as Swift does.

## Finding 3: The "single `Exec` interface" core contract is false. About 10 of the 80 operations need filesystem/OS access that no phase exposes
- **Severity:** High
- **Location:** Phase 3 "Key Insights", "Architecture", step 9; Phase 2 "Requirements", "Architecture", "Related Code Files", "Security Considerations"; Phase 4 "Related Code Files" (capabilities); Phase 5 "Key Insights", step 4
- **Flaw:** Phase 3 says the TS core depends only on `Exec`, with a Node adapter for tests and a Rust adapter for the app. The Swift `GitRepository` does direct filesystem I/O in **10 public operations**:
  - `open` (fileExists)
  - `workingFileData`
  - `operationState` (reads `.git/MERGE_HEAD`, `rebase-merge/*`)
  - `pendingCommitMessage`
  - `trashUntracked`
  - `addToGitignore`
  - `readWorkingFile` and `writeWorkingFile`
  - `clone` and `initialize` (mkdir)

  Phase 2 exposes no filesystem commands, phase 4's capability list has no fs plugin, and phase 5 refers in passing to an undefined "working file qua Rust" command. Related contract defects:
  - **(a) Trash-undo cannot be ported to macOS.** Swift's undo depends on `FileManager.trashItem(resultingItemURL:)` followed by `moveItem` back. The plan's `trash` crate returns `Result<(), Error>` (no resulting path), and its restore API (`os_limited::restore_all`) exists only on Windows/Linux.
  - **(b) Env ownership is split.** Phase 2 puts the standard env in Rust; phase 3 puts "cùng cờ chung và env như Swift" in the TS runner. `acceptExitCodes` is owned by both layers. Swift's `merge --continue` and `rebase --continue` have no `--no-edit` and rely on `GIT_EDITOR=true` from env. If env lives in Rust, the Vitest suite (Node adapter) runs without it.
  - **(c) The env list is labelled "giữ nguyên như Swift" but it is not the same.** Swift removes `LC_ALL` and sets `GIT_MERGE_AUTOEDIT=no`, `GIT_PAGER`/`PAGER=cat`, a default `LANG`, and `LANGUAGE=en`. The plan lists `LANGUAGE=C` and omits the `LC_ALL` removal. The recovery flows match **English stderr substrings** at 7 sites, so a user with `LC_ALL` set gets localized git messages and every recovery toast (identity dialog, "Stash rồi checkout", "Pull / Force push", diverged pull) silently stops working.
  - **(d) Web Worker topology.** Parse and layout move to a worker, but the 1:1 `history()` does exec + parse + layout. `invoke` depends on `window.__TAURI_INTERNALS__`, which does not exist in a worker scope. That needs a third, unplanned worker→main Exec proxy, or an API split.
  - **(e) The capability claim is contradicted by the API.** `git_exec` accepts arbitrary args plus "env thêm" from JS. `-c core.sshCommand=…`, `-c alias.x=!…` or `GIT_SSH_COMMAND` are arbitrary command execution, which contradicts "frontend không spawn được lệnh tuỳ ý".
- **Failure scenario:** Phase 3 reports "tests green" through the Node adapter, which has fs access. In phase 5, the largest phase, the merge/rebase banner (`operationState`), conflict resolver (read/write working file), "add to .gitignore" and image diff all fail inside the webview. An Fs port, Rust commands and scoped capabilities then have to be designed mid-phase. On macOS, "Discard untracked → Undo" cannot restore the files. The "merge conflict lifecycle" integration test hangs in CI on an editor if env is not in TS.
- **Evidence:**
  - phase-03-typescript-core-port.md:20 "Core phụ thuộc một interface `Exec` duy nhất … Cùng một code repository dùng cho cả hai."
  - Sources/NhanhCore/Git/GitRepository.swift:64, 184, 217-225, 246, 299, 333-336, 500, 505, 628, 634 (FileManager / `Data(contentsOf:)` / `write(to:)`)
  - phase-02-rust-backend-bridge.md:48 (Rust files: no fs); :50 (wrappers "gitExec.ts, watcher.ts, askpass.ts, os.ts"); phase-04-ui-shell-graph-sidebar.md:52 "capabilities/*.json (dialog, opener, clipboard, store, window-state, single-instance)"; phase-05-staging-diff-conflicts-drag-drop.md:53 "working file qua Rust"
  - Sources/NhanhCore/Git/GitRepository.swift:299 `trashItem(at: url, resultingItemURL: &resulting)`; Sources/Nhanh/Model/RepoModel+Actions.swift:83, :116 `moveItem(at: url, to: destination)`; phase-02-rust-backend-bridge.md:34 "crate `trash`"; phase-05-staging-diff-conflicts-drag-drop.md:21 "khôi phục từ Thùng rác"
  - phase-02-rust-backend-bridge.md:45 "Env chuẩn (giữ nguyên như Swift): … `LC_MESSAGES=C`, `LANGUAGE=C` …"; Sources/NhanhCore/Git/GitEnvironment.swift:36 `GIT_MERGE_AUTOEDIT`, :37-38 `GIT_PAGER`/`PAGER`, :40 `env.removeValue(forKey: "LC_ALL")`, :43 `LANGUAGE = "en"`
  - phase-03-typescript-core-port.md:49 "git/runner.ts: cùng cờ chung và env như Swift"; :33 (TS owns acceptExitCodes) vs phase-02-rust-backend-bridge.md:29 (Rust request owns acceptExitCodes)
  - Sources/NhanhCore/Git/GitRepository.swift:456-457 `["merge", "--continue"]`, `["rebase", "--continue"]`
  - English-stderr matching: Sources/Nhanh/Model/RepoModel+Actions.swift:177, 323, 404, 594, 600, 712, 765; Sources/NhanhCore/Git/GitRepository.swift:72-73, 121-122
  - phase-03-typescript-core-port.md:56 "chạy parse + layout trong Web Worker"; phase-04-ui-shell-graph-sidebar.md:48 (flow); Sources/NhanhCore/Git/GitRepository.swift:129-137 (`history` = log + layout)
  - phase-02-rust-backend-bridge.md:29 "args, cwd, stdin (bytes), env thêm" vs :84 "frontend không spawn được lệnh tuỳ ý"
- **Suggested fix:**
  - Define two ports in phase 3: `Exec` and `RepoFs` (exists, readFile, writeFile, appendFile, mkdirp, `trash()` returning a restore token, `restore(token)`). Each needs a Node adapter and a Tauri adapter.
  - Add matching Rust commands to phase 2, scoped to opened repo roots.
  - Own env and flags in exactly one place (the TS runner), passed to Rust verbatim, and copy Swift's env list exactly, including the `LC_ALL` removal.
  - For macOS trash-undo, either call `NSFileManager trashItem` from Rust via objc2 (it returns the resulting URL), or snapshot the files to the app-data dir before deleting.
  - Keep `Repository` on the main thread and move only pure parse/layout (raw bytes in) to the worker.
  - In Rust, allowlist the `-c` keys and env names that `git_exec` accepts.

## Finding 4: The askpass sidecar plus localhost TCP server is a net-new subsystem with unplanned build-pipeline cost
- **Severity:** High
- **Location:** Phase 2 "Key Insights", "Architecture", "Related Code Files", step 3, "Success Criteria", "Risk Assessment"; Phase 8 "Architecture"; Phase 1 step 6
- **Flaw:** Swift handles git/ssh prompts with an osascript script of about 40 lines that it writes to Application Support. The plan replaces it with:
  - a second Rust crate shipped as `externalBin`
  - a TCP server on 127.0.0.1 with a 32-byte token and constant-time compare
  - an event round-trip to a UI modal, with a 5-minute timeout
  - a named-pipe fallback

  Tauri's `externalBin` needs a `-<target-triple>`-suffixed binary to exist before **every** `tauri dev` / `tauri build`. Universal macOS builds also need a manually `lipo`'d `thaigit-askpass-universal-apple-darwin` (tauri issue #3355). Neither phase 1 CI nor phase 8 `release.yml` has a pre-build or lipo step. The success criterion "an HTTPS push shows the in-app modal on both OSes" also does not match default setups: on Git for Windows the default credential helper (GCM) answers HTTPS auth with its own UI before git ever consults `GIT_ASKPASS`. Phase 9's own matrix assumes GCM and ssh-agent.
- **Failure scenario:** On the first `v*` tag, the macOS job (`tauri build --target universal-apple-darwin`) fails at bundling because externalBin `thaigit-askpass-universal-apple-darwin` is missing. The fix needs per-arch cargo builds, `lipo`, and signing the sidecar for notarization. By then, 4–6 days of phase 2 have gone into a subsystem whose main path (HTTPS) is normally handled by GCM or osxkeychain.
- **Evidence:**
  - phase-02-rust-backend-bridge.md:24 "Askpass phải là **file thực thi** … dùng sidecar `thaigit-askpass` gọi về app qua localhost kèm token"; :42 (architecture); :49 "crate bin `thaigit-askpass`, khai báo `externalBin` trong `tauri.conf.json`"; :56 (step 3); :73 "Push qua HTTPS cần mật khẩu hiện modal trong app, trên cả 2 OS"; :80 "named pipe trên Windows"
  - phase-08-landing-page-release-pipeline.md:41 "tauri build --target universal-apple-darwin". No sidecar build or lipo appears in :54-60.
  - phase-01-foundation-branding.md:52 CI "`tauri build --debug`" (no sidecar pre-build)
  - phase-09-windows-hardening-qa-launch.md:30 "HTTPS qua Git Credential Manager; SSH có passphrase (askpass) và qua ssh-agent"
  - Sources/NhanhCore/Git/GitEnvironment.swift:128-170 (osascript script); :46-48 (env wiring)
  - Tauri config docs (`externalBin`): "Tauri looks for … 'binary-name{-target-triple}{.system-extension}'"; tauri issue #3355 (sidecar not found for `universal-apple-darwin`)
- **Suggested fix:**
  - For the MVP, port the osascript script verbatim on macOS.
  - On Windows, rely on GCM for HTTPS and ssh-agent for SSH, and show an actionable error when git exits on an auth failure.
  - After M2, if prompts are really needed, re-invoke the **main app executable** in "askpass mode" (env flag checked first thing in `main`). That removes the second crate, externalBin naming and lipo.
  - Drop the named-pipe fallback.

## Finding 5: In-app tabs force a single-window design, which then forces a custom pointer-DnD engine. Both are self-inflicted
- **Severity:** High
- **Location:** Phase 4 "Key Insights" (tabs), "Requirements" (Welcome folder drop, Tabs), "Architecture" (TabBar); Phase 5 "Key Insights" (DnD), step 6, "Risk Assessment"
- **Flaw:**
  - Swift has no tab code. It uses one repo per window and lets macOS merge windows into native tabs.
  - The plan replaces that with an in-app TabBar holding many repos in one webview, with Ctrl+T/W and restore-on-launch.
  - Phase 5 then rules out HTML5 DnD because `dragDropEnabled` must stay on for one convenience (dropping a folder on the welcome screen). Instead it builds a pointer-events DnD engine: start threshold, ghost image, hit-test registry, edge auto-scroll, Esc cancel. Its own risk section admits this engine is error-prone.
  - Every DnD outcome already exists as a context-menu item in Swift: `dropOptions` mirrors the menu builders.
- **Failure scenario:** The two largest phases spend days on per-tab RepoStore lifecycles, watcher multiplexing by `repoId`, tab restore, and pointer-capture edge cases: dragging over the canvas column, auto-scroll while the virtual list recycles rows, losing the pointer outside the window. The user value (merge, rebase, push, push tag) was already reachable from context menus.
- **Evidence:**
  - phase-04-ui-shell-graph-sidebar.md:23 "Tab trong app (một cửa sổ, nhiều repo)…"; :28 "thả thư mục vào cửa sổ để mở"; :29 "Tabs: ⌘/Ctrl+T, ⌘/Ctrl+W, khôi phục tab khi mở lại app"; :45 `TabBar`
  - Sources/Nhanh/App/NhanhApp.swift:11 `WindowGroup("Nhánh", id: "repo", for: String.self)`; :31 `NSWindow.allowsAutomaticWindowTabbing = true`; Sources/Nhanh/Views/RootView.swift:141-142 `tabbingMode = .preferred`, `tabbingIdentifier`
  - phase-05-staging-diff-conflicts-drag-drop.md:20 "…trên Windows HTML5 DnD trong webview **không chạy**. Vì vậy kéo-thả trong app dùng **pointer events** tự viết…"; :55 (step 6); :75 "Pointer DnD tự viết dễ sót case"
  - Swift DnD is native: Sources/Nhanh/Views/SidebarView.swift:165, 170, 444; Sources/Nhanh/Views/Inspector/StagingView.swift:154, 207; Sources/Nhanh/Views/WelcomeView.swift:98
  - Menus already cover DnD: Sources/Nhanh/Model/RepoModel+Actions.swift:1095 "Merge … vào …", :1098 Rebase, :1102 Push, :1105 Fast-forward, :1132 Push tag; `dropOptions` is at :1202-1250
  - Tauri `dragDropEnabled`: "Disabling it is required to use HTML5 drag and drop on the frontend on Windows" (a per-window setting)
- **Suggested fix:**
  - MVP: one repo per window (Tauri multi-window, or replace-in-window plus a Recent list). No TabBar and no tab restore.
  - Ship merge/rebase/push in M2 through ported context menus.
  - If DnD is wanted for 1.0, set `dragDropEnabled: false` and use HTML5 DnD. Drop the folder-drop nicety and keep "Open folder…".
  - Build pointer DnD only if a one-day spike shows HTML5 DnD is broken in WKWebView.

## Finding 6: Two UI-test layers built on recorded git fixtures. The premise is outdated and the sequencing is inverted
- **Severity:** High
- **Location:** Phase 9 "Key Insights", "Requirements" (matrix), "Architecture", steps 2–3, "Success Criteria"; Phase 5 step 8 and todo "Kịch bản UI tests"
- **Flaw:**
  - Phase 9 builds two layers: (1) Playwright in a browser with mocked IPC replaying "fixture repo đã ghi sẵn output git" for 10–15 stateful flows, and (2) WebdriverIO + tauri-driver on Windows only, justified by "tauri-driver doesn't run on macOS".
  - Current Tauri docs recommend `@wdio/tauri-service`, which embeds a WebDriver server in the app and runs on Windows, Linux and macOS. So the reason for two layers no longer holds.
  - Recorded-output mocks for stateful flows (stage lines → status changes → commit → undo) amount to a fake git keyed on exact argv. Any flag change in the 80-operation core breaks the fixtures.
  - Swift already had the cheap equivalent. `AutomationHarness` (302 lines) is an env-var step runner against real git, with steps such as `act:stageall/commit/merge/stash/pop/fetch/push/pull/undo`, `selectlines` and `drag`.
  - Phase 5 requires UI scenarios, but the infrastructure for them is only specified in phase 9.
  - The QA matrix is too large for one person: Win10 + Win11 × two git versions × three autocrlf values × three DPI levels × light/dark, plus macOS 14/15/26 on Intel and Apple Silicon. Windows 10 reached end of support on 2025-10-14, and the success criterion names only Win 11, so the matrix and the criteria disagree.
- **Failure scenario:** Phase 5's "UI tests" todo cannot close without phase 9's Playwright/mock infrastructure, so it is either built early (unplanned days) or slips. Later the two suites drift apart, regenerating fixtures becomes a recurring chore, and a green Playwright run proves nothing about real git on Windows.
- **Evidence:**
  - phase-09-windows-hardening-qa-launch.md:26 "`tauri-driver` … **không** chạy trên macOS. Nên dùng 2 lớp…"; :39 "dùng fixture repo đã ghi sẵn output git"; :51 "10–15 luồng chính"; :52 (tauri-driver on `windows-latest`)
  - phase-05-staging-diff-conflicts-drag-drop.md:57 "Kịch bản kiểm thử UI (Playwright + mock IPC, xem phase 9)"; :67 (todo)
  - Sources/Nhanh/Debug/AutomationHarness.swift:5-8 (`NHANH_OPEN` / `NHANH_SNAPSHOT_DIR` / `NHANH_STEPS`); :98 (step parsing); :189-206 (`act:` steps); reports/scout-report.md:47 "Test harness via env vars … was essential … keep an equivalent (… or in-app script runner)"
  - phase-09-windows-hardening-qa-launch.md:30 (matrix incl. "Win 10 22H2"); :31 (macOS 14/15/26, Intel + Apple Silicon); :68 "100% mục QA checklist đạt trên Win 11 + macOS 15/26"
  - Tauri WebDriver docs: "`@wdio/tauri-service`, which works on Windows, Linux, and macOS … runs an embedded WebDriver server inside your app … this is how macOS is supported"
- **Suggested fix:**
  - Use one layer: port AutomationHarness as an env-var step runner (or use `@wdio/tauri-service`) driving the real app against real temp repos on macOS and Windows CI. Git semantics stay covered by the Vitest integration tests.
  - Drop Playwright, the IPC mock and the recorded fixtures.
  - Land the harness in phase 4 (it is needed for the graph-parity check); phase 5 adds scenarios.
  - Cut the matrix to Win 11 + latest Git for Windows (autocrlf true/false, 100%/150% DPI) + the developer's current macOS. Leave Win 10, Intel Macs and old git to beta reports.

## Finding 7: The phase 7 server is gold-plated (admin app, dual release modes, duplicated sources of truth) and budgeted at 5–7 days
- **Severity:** High
- **Location:** Phase 7 "Overview", "Requirements" (endpoints table, defaults), "Architecture", steps 6–10, "Key Insights", "Risk Assessment"; Phase 8 "Requirements", "Architecture"; plan.md "Câu hỏi còn mở" #5
- **Flaw:** 5–7 days are meant to cover:
  - Hono, zod env, migrations, multi-stage Docker
  - install tokens; quota, IP rate limit, budget and kill switch
  - SSE proxy with fallback model and post-processing
  - download, update and releases endpoints
  - admin login with argon2id, 15-minute lockout, session cookie and CSRF
  - a Hono-JSX dashboard with six chart groups and a settings form
  - a CI release API, retention jobs, nightly backups ×14 (plus optional rclone) and log rotation
  - GHCR + SSH deploy with rollback, docs, and unit/integration tests plus an autocannon load test

  The research recommended basic auth; the plan escalated it. Both release-hosting modes are built (`RELEASES_MODE=github|local`) even though public vs private is still an open question.

  Config has two sources of truth with no precedence rule: env `AI_MODEL` / `AI_MODEL_FALLBACK` and env pricing, versus admin `settings.model` / budget / quotas in SQLite.

  The changelog has three: `CHANGELOG.md` (vi/en), `releases.notes_vi/notes_en` posted through the admin API, and `/v1/releases` rendered by Astro.
- **Failure scenario:** Phase 7 runs 2–3× over. Phases 6 and 8 both depend on it, so the slip cascades into the first beta (Finding 1). In operation, the owner changes the model in the admin form, a redeploy restarts the container with `AI_MODEL` from `.env`, and nobody knows which value is live.
- **Evidence:**
  - phase-07-vps-server-ai-proxy-stats-updater.md:13-18 "gánh 5 việc"; :45 "/admin/* Đăng nhập, dashboard, cài đặt …, API cho CI"; :58 "auth.ts (argon2id + session cookie + CSRF), views/*.tsx (Hono JSX), static/chart.umd.js"; :85 (step 6 chart list); :86-89 (steps 7–10)
  - research/researcher-02-hermes-ai-backend-report.md:256 "Recommended for VPS: Basic auth + rate-limit login attempts"; :328
  - phase-07-vps-server-ai-proxy-stats-updater.md:30, :73 `RELEASES_MODE=github|local`; phase-08-landing-page-release-pipeline.md:32 "GitHub Release (repo public) **hoặc** rsync lên VPS `releases/` (repo private)"; :44; plan.md:61 (open question 5)
  - phase-07-vps-server-ai-proxy-stats-updater.md:48 "Mặc định (chỉnh trong admin)…"; :71 `settings(… ai_enabled, daily_budget_usd, quotas, model)` vs :73 `AI_MODEL`, `AI_MODEL_FALLBACK`; :112 "trần chi phí tính từ bảng giá trong env"
  - phase-08-landing-page-release-pipeline.md:35 "`CHANGELOG.md` (vi/en)"; phase-07-vps-server-ai-proxy-stats-updater.md:70 `notes_vi, notes_en`; :44 `/v1/releases`; phase-08-landing-page-release-pipeline.md:31 "changelog (từ `/v1/releases`)"
- **Suggested fix:**
  - M3 server only: `/v1/install`, `/v1/ai/commit-message` (SSE, quota, $ cap and kill switch, all from env), `/download/:asset` (count + 302) and `/healthz`.
  - The updater reads a static JSON written by CI.
  - Admin is a Caddy `basic_auth` block in front of one read-only stats page (SQL → HTML table), or `sqlite3` over SSH. Charts and the settings form come after 1.0.
  - Resolve open question 5 before phase 7 and implement exactly one release mode.
  - One source of truth each: `CHANGELOG.md` → CI-generated notes; config in env until an admin form exists.

## Finding 8: API contract mismatches between the client (P6), server (P7) and updater/release (P8)
- **Severity:** High
- **Location:** Phase 6 "Requirements", "Architecture"; Phase 7 "Requirements" (endpoints table, defaults), "Key Insights", steps 4–5 and 7, schema; Phase 8 "Requirements", "Architecture", "Success Criteria"; research-01 §6
- **Flaw:**
  - **(a) Updater platform vocabulary.** Tauri sends `{{target}}` ∈ {linux, windows, darwin} and `{{arch}}` ∈ {x86_64, i686, aarch64, armv7}, never "universal". Phase 8 registers assets as `darwin-universal` / `windows-x86_64`, phase 7 downloads use `mac-universal` / `win-x64` / `win-x64-msi`, and phase 7 only says "logic chọn asset theo target/arch". That is three vocabularies with no mapping. research-01 says `{{target}}` is `macos`; a server written from it never matches Macs and returns 204 "up to date" forever.
  - **(b)** `/download/win-x64-msi` has no data source: the CI release payload carries only `darwin-universal|windows-x86_64`.
  - **(c)** The client sends `X-App-Version`, but the server middleware never reads it and `ai_requests` does not store it.
  - **(d)** 429 means both "per-install quota" and "30 req/min/IP", yet the client maps 429 to "hết lượt" (out of quota today). 503 means both "budget cap" and "admin kill switch", yet the client message says "chạm trần chi phí".
  - **(e) Consent.** Phase 6 registers the install on **first launch** (installId, platform, appVersion → `installs` row), before phase 8's onboarding consent, and every AI call carries `X-Install-Id`. The phase 8 success criterion "Không đồng ý thống kê → server không nhận X-Install-Id" is therefore unachievable, and DAU can be computed from `ai_requests(day, id_hash)` whatever the stats consent says.
  - **(f) Streaming vs post-processing.** The server forwards deltas as they arrive and also claims to post-process (strip code fences, first line ≤ 72). It cannot rewrite text it has already sent. The client must split summary and body, but no SSE frame type exists for that.
  - **(g) Schema gaps.** Retention "keeps monthly aggregates", but the schema has no aggregate table. `releases.channel` is never written by CI and never read (the updater path has no channel).
- **Failure scenario:** (a) is the worst case. Mac users on 0.1.0 never receive 0.1.1, and nothing errors because 204 is a valid "no update". The phase 8 "0.1.0 → 0.1.1" test may only be run on Windows. In (e), the privacy page (phase 8) promises something the system does not do, which is the Decree 13 exposure the plan itself cites.
- **Evidence:**
  - research/researcher-01-tauri-desktop-report.md:107 "`{{target}}`: `windows`/`macos`/`linux`" vs Tauri updater docs "one of `linux`, `windows` or `darwin`"
  - phase-08-landing-page-release-pipeline.md:27 (single universal Mac build); :45 `assets{darwin-universal|windows-x86_64: url, signature, size}`; phase-07-vps-server-ai-proxy-stats-updater.md:42 `mac-universal`, `win-x64`, `win-x64-msi`; :84 "logic chọn asset theo `target/arch`"
  - phase-06-ai-commit-features-hermes.md:41 "headers: X-Install-Id, X-Install-Token, X-App-Version"; phase-07-vps-server-ai-proxy-stats-updater.md:81 "middleware xác thực (`X-Install-Id`, `X-Install-Token` …)"; :67-68 (`ai_requests` has no app_version)
  - phase-06-ai-commit-features-hermes.md:31 "hết lượt (429), server tạm dừng vì chạm trần chi phí (503)"; phase-07-vps-server-ai-proxy-stats-updater.md:48 "30 request/phút/IP"; :103 "tắt AI trong admin → 503 ngay"
  - phase-06-ai-commit-features-hermes.md:32 "lần chạy đầu tạo UUID → `POST /v1/install`"; phase-07-vps-server-ai-proxy-stats-updater.md:29, :37, :64; phase-08-landing-page-release-pipeline.md:33 "`X-Install-Id` chỉ gửi khi đã đồng ý thống kê"; :34 (onboarding); :75 (success criterion)
  - phase-07-vps-server-ai-proxy-stats-updater.md:83 "chuyển tiếp SSE … Hậu xử lý: bỏ code fence, dòng đầu ≤ 72 ký tự"; phase-06-ai-commit-features-hermes.md:27 "Chữ stream vào ô tóm tắt + mô tả"; :40 (frames "delta/usage/error/done")
  - phase-07-vps-server-ai-proxy-stats-updater.md:86 "giữ số tổng hợp theo tháng" vs schema :63-72; :70 `channel`
- **Suggested fix:**
  - Add a shared contract module (`packages/contracts` or `packages/core/src/api/*`) that both client and server import.
  - Platform map: `darwin-aarch64` and `darwin-x86_64` → the universal asset; `windows-x86_64` → `win-x64`. Either drop MSI or add it to the release payload.
  - Error bodies carry a code: `{code: quota_exhausted | ip_rate_limited | budget_exhausted | ai_disabled | too_large}`.
  - Register the install lazily on first AI use, after AI consent. Use a separate random ID, or none, for update-check stats.
  - Make the client finalize the text after `done` (strip fences, split summary/body).
  - Either add a `monthly_active` table or remove the retention claim. Drop `channel`.
  - Add server tests for `/v1/update/darwin/aarch64/0.1.0` and `/v1/update/darwin/x86_64/0.1.0`.

## Finding 9: i18n infrastructure from day one for a "stretch" English locale the reference app never had
- **Severity:** Medium
- **Location:** Phase 1 step 7 and todo; Phase 4 "Requirements" (Settings), "Related Code Files", step 1; Phase 7 schema; Phase 8 "Requirements" (landing, onboarding, versioning)
- **Flaw:**
  - Swift has zero localization: no `NSLocalizedString` / `String(localized:)` anywhere, `CFBundleDevelopmentRegion` is `vi`, and strings are hard-coded Vietnamese.
  - The plan installs an i18n library in phase 1 for an `en` locale it calls stretch, before choosing the library (svelte-i18n vs Paraglide). Phase 4 then hard-codes `lib/i18n/{vi,en}.json`, a layout that depends on which library is picked; Paraglide compiles from its own message layout.
  - i18n spreads to five surfaces: the app settings language picker, an onboarding language step, the Astro site, release notes in the DB, and `CHANGELOG.md`.
- **Failure scenario:** Every string in phases 4–6 goes through key lookup and two JSON files. `en` lags behind and missing-key fallbacks show up for users who pick English. Every release needs bilingual notes in three places. The cost is spread across every phase and appears in no estimate.
- **Evidence:**
  - phase-01-foundation-branding.md:53 "Thiết lập i18n khung (svelte-i18n hoặc Paraglide): `vi` mặc định, `en` (stretch nhưng dựng khung ngay…)"; :61
  - phase-04-ui-shell-graph-sidebar.md:34 "ngôn ngữ vi/en"; :51 "`apps/desktop/src/lib/i18n/{vi,en}.json`"; :55
  - phase-08-landing-page-release-pipeline.md:31 "Astro tĩnh, vi/en"; :34 "Onboarding lần đầu: chọn ngôn ngữ"; :35 "`CHANGELOG.md` (vi/en)"; phase-07-vps-server-ai-proxy-stats-updater.md:70 `notes_vi, notes_en`
  - `grep -rlE 'NSLocalizedString|String\(localized' Sources | wc -l` → 0; Resources/Info.plist:5-6 `CFBundleDevelopmentRegion` = `vi`
- **Suggested fix:** Ship Vietnamese only for 1.0. Keep strings in a single typed `strings.vi.ts` module with no runtime library, so a later extraction is mechanical. Keep notes and changelog monolingual. Revisit after 1.0 usage data.

## Finding 10: Renaming the soon-retired Swift app is duplicated work and, as specified, loses user data and collides with the Tauri identifier
- **Severity:** Medium
- **Location:** Phase 1 "Architecture", "Related Code Files", step 5, "Success Criteria"; plan.md "Quyết định đã chốt"
- **Flaw:**
  - The Swift app is slated for bug-fixes-only and retirement, yet phase 1 renames it across Info.plist (including the bundle id), the build script, WelcomeView, GitEnvironment (askpass title and Application Support dir) and the README, then rebuilds and re-runs the tests.
  - Phase 1 contradicts itself: the tree says "giữ nguyên, đổi tên hiển thị" (display name only), while Related Code Files changes the bundle id.
  - Changing `com.phanthai.nhanh` moves the UserDefaults domain, so the existing settings and recent-repo list disappear.
  - If the new id is `com.phanthai.thaigit`, it collides with the Tauri app's identifier: shared LaunchServices identity, TCC grants keyed by bundle id across differently signed binaries, and shared `~/Library/WebKit/<id>` and caches.
  - `build-app.sh` installs to `/Applications/Nhánh.app`, so after the rename two apps sit side by side.
- **Failure scenario:** The owner, who is the main Swift user, rebuilds and loses recent repos and settings. Later, the Tauri app with the same bundle id makes Spotlight or `open -b` launch the wrong binary, and folder-access prompts come back whenever the other binary runs.
- **Evidence:**
  - plan.md:31 "App Swift cũ | Đổi tên Thaigit, chỉ sửa lỗi; ngừng khi bản Tauri đủ tính năng"; phase-09-windows-hardening-qa-launch.md:47 (retire to `legacy/`)
  - phase-01-foundation-branding.md:32 "app Swift (giữ nguyên, đổi tên hiển thị)" vs :43 "`Resources/Info.plist` (CFBundleName/DisplayName → Thaigit, bundle id) …"; :51; :66
  - phase-01-foundation-branding.md:26 (Tauri identifier `com.phanthai.thaigit`)
  - Resources/Info.plist:13-14 `com.phanthai.nhanh`; Sources/Nhanh/App/AppState.swift:22-43, 71, 114, 119 (`UserDefaults.standard`); Sources/Nhanh/Views/SettingsView.swift:19-22 (`@AppStorage`)
  - scripts/build-app.sh:48 `APP="build/Nhánh.app"`; :58-60 (installs to `/Applications/Nhánh.app`)
- **Suggested fix:** Remove the Swift rename (step 5, its todo and its success criterion) from phase 1. If a visible rename is mandatory, change only `CFBundleDisplayName` / `CFBundleName`, and never the bundle id, Application Support dir or executable name.

---

## Contract verification ledger

| Claim | Plan location | Actual (verified) | Verdict |
|---|---|---|---|
| ~80 GitRepository operations | reports/scout-report.md:14; phase-03-typescript-core-port.md:26, :34, :53 | 80 `public func` in Sources/NhanhCore/Git/GitRepository.swift (84 `func` declarations including 4 nested helpers in `operationState`, :218-225) | ✓ count. ✗ "single Exec": 10 operations do filesystem I/O and 2 are pure statics (`layout` :140, `defaultDirectoryName` :645) |
| 40 tests | reports/scout-report.md:3, :32-34; phase-01-foundation-branding.md:51, :66; phase-03-typescript-core-port.md:13, :69 | 40 `@Test`: Parser 10, Diff 6, GraphLayout 8, Repository 14, RepoWatcher 2 | ✓ count. ✗ Phase 3 "all 40 to Vitest": the 2 RepoWatcherTests (Tests/NhanhCoreTests/RepoWatcherTests.swift:7, :38) go to Rust per phase-02-rust-backend-bridge.md:57, :60, so only 38 reach Vitest. phase-03:39 lists 4 test files; phase-03:69 "≥ 45 (40 port + …)" is miscounted |
| Per-file Swift line counts | reports/scout-report.md:9-21 | Exact match (`wc -l`, core total 2,791) | ✓ |
| App layer ~8.6k lines | reports/scout-report.md:36 | `Sources/Nhanh` = 7,783; the 8.6k figure includes 893 test lines | ✗ minor |
| Big repo: 30k commits / ~1,100 refs | phase-03-typescript-core-port.md:55; phase-04-ui-shell-graph-sidebar.md:36; phase-09-windows-hardening-qa-launch.md:32 | Ran `make-big-repo.py \| git fast-import`: 30,000 commits, 1,077 refs (878 branches + 199 tags) | ✓. The script header (research/make-big-repo.py:1) "~40 nhánh … 200 tag" is wrong |
| 12-colour lane palette | phase-04-ui-shell-graph-sidebar.md:51 | Sources/Nhanh/Views/Graph/GraphStyle.swift:14-26 (12 entries) | ✓ |
| Cited symbols | phase-02:54, :57; phase-03:26; phase-04:57-58; phase-05:16, :40 | `classifyGitPath` RepoWatcher.swift:111; `onStderrLine` ProcessRunner.swift:62; `fitColumns` CommitGraphView.swift:303; `dropOptions` RepoModel+Actions.swift:1202; `toNode`/`fromNode` GraphLayout.swift:9, :11 (GraphCells.swift:55 only draws them); `isValidRefName` GitRepository.swift:208; `LimitedRows` SidebarView.swift:106 | ✓ |
| Sidebar page 200, folders >30 collapsed | phase-04-ui-shell-graph-sidebar.md:21 | SidebarView.swift:351, :398 | ✓ |
| Env "giữ nguyên như Swift" | phase-02-rust-backend-bridge.md:45 | GitEnvironment.swift:33-49 differs (LC_ALL removal, GIT_MERGE_AUTOEDIT, PAGER, LANGUAGE=en) | ✗ (Finding 3) |
| Env/flags owner | phase-02:45 (Rust) vs phase-03:49 (TS) | Both claim ownership; acceptExitCodes in both (phase-02:29, phase-03:33) | ✗ (Finding 3) |
| fs access for core | phase-03:20 | No fs command in phase-02:48/:50, no fs capability in phase-04:52; phase-05:53 assumes one | ✗ (Finding 3) |
| Updater URL template | phase-07:43 = phase-08:33 | Identical | ✓ path. ✗ asset vocabulary (Finding 8a) |
| `{{target}}` values | research-01:107 `macos` | Tauri: `linux`/`windows`/`darwin` | ✗ |
| AI request headers | phase-06:41 vs phase-07:81 | `X-App-Version` not consumed or stored | ✗ |
| `/admin/api/releases` | phase-07:85 vs phase-08:32, :45 | Path ✓. Payload lacks `channel` and MSI; Bearer endpoint sits under CSRF-protected `/admin/*` with no stated exemption | ✗ minor |
| `packages/core/src/ai/*` | phase-06:47 vs phase-03:31-38 tree | Not in the tree, but anticipated at phase-03:81 | ✓ |
| `lib/i18n/{vi,en}.json` | phase-04:51 vs phase-01:53 | Layout depends on an undecided library | ✗ |
| `tests/ui` infrastructure timing | phase-09:38-41, :51 | Required earlier by phase-05:57 | ✗ sequencing |
| Swift rename scope | phase-01:32 vs :43 | "display name only" vs "bundle id" | ✗ |

## Unresolved questions
1. Is the GitHub repo public or private (plan.md:61)? This decides Finding 7's single release mode and whether the updater can use tauri-action's static `latest.json`.
2. Does the owner actually need HTTPS password prompts on Windows, or is GCM plus ssh-agent acceptable for beta (Finding 4)?
3. Is in-app DnD a 1.0 requirement or a 1.x nicety, given that context menus already cover every drop action (Finding 5)?

## Sources
- [Tauri updater plugin (v2)](https://v2.tauri.app/plugin/updater/): `{{target}}` ∈ linux/windows/darwin; dynamic-server 200/204 format
- [Tauri configuration reference](https://v2.tauri.app/reference/config/): `externalBin` target-triple naming
- [tauri-utils WindowConfig `drag_drop_enabled`](https://docs.rs/tauri-utils/latest/tauri_utils/config/struct.WindowConfig.html): disabling is required for HTML5 DnD on Windows
- [tauri issue #3355: sidecar not found for universal-apple-darwin](https://github.com/tauri-apps/tauri/issues/3355)
- [Tauri WebDriver testing](https://v2.tauri.app/develop/tests/webdriver/): `@wdio/tauri-service` works on Windows, Linux and macOS
- [trash::delete](https://docs.rs/trash/latest/trash/fn.delete.html) returns `Result<(), Error>`; [trash::os_limited](https://docs.rs/trash/latest/trash/os_limited/index.html) is Windows/Linux only
