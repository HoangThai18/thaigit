# Red-team review: Failure Mode Analyst (Thaigit plan)

- **Reviewer:** code-reviewer, acting as failure-mode analyst and flow tracer. **Date:** 2026-10-02.
- **Scope:** plan.md, phase-01..09, research/*.md, reports/scout-report.md, checked against the Swift reference in `Sources/`, `Tests/`.
- **Method:** grep and trace of the Swift code the plan says it ports, plus small runnable probes in the session scratchpad (Swift and Node). No plan or source file was changed.
- **Locked decisions not challenged:** Tauri 2, the Hermes proxy, the VPS, and the expanded scope.

---

## Finding 1: A bad client release reaches every user and cannot be rolled back
- **Severity:** Critical
- **Location:**
  - Phase 8, sections "Requirements" (Release CI, in-app updater) and "Risk Assessment".
  - Phase 7, sections "Requirements" (`/v1/update`) and "Implementation Steps" step 9.
- **Flaw:** The flow is: push a tag, CI builds, `POST /admin/api/releases`, and every client gets the release on its next check (at launch and every 6 h). The plan is missing all of the following:
  - staged rollout or rollout percentage
  - a yank or pause action, or a way to re-point "latest"
  - a minimum-version or blocklist rule
  - a way to downgrade. Tauri's updater only installs a version greater than the current one unless the Rust `version_comparator` is used.

  Other gaps in the same flow:
  - The only rollback in the plan is for the **server** Docker image.
  - `releases.channel` exists in the schema but no endpoint reads it.
  - The CI smoke test checks the **server** endpoints, not the installed app.
  - The update check lives in the Svelte UI (`UpdateToast.svelte`). A build that white-screens or crashes during frontend startup can never fetch its own fix.
- **Failure scenario:**
  1. v0.4.0 ships an `exec.rs` or WebView2-only crash.
  2. Within 6 h every running Windows client has it.
  3. v0.4.1 only reaches clients whose frontend still boots. Everyone else must reinstall by hand.
  4. `/download/win-x64` defaults to the latest release, so it hands them the same broken build until a fix is built, signed and registered. The plan's own target for that is "≈30 phút" (phase-08:72), longer if notarization stalls.
- **Evidence:**
  - phase-07:43: "`/v1/update/:target/:arch/:currentVersion` | 204 nếu đã mới nhất, ngược lại 200 …"
  - phase-07:70: `releases(version TEXT PRIMARY KEY, pub_date, notes_vi, notes_en, channel, assets_json)`. No reader of `channel` anywhere.
  - phase-08:32: CI "gọi `POST /admin/api/releases` … smoke test `/download/*` và `/v1/update/*`".
  - phase-08:33: "kiểm khi mở app và mỗi 6 giờ".
  - phase-08:52: `UpdateToast.svelte`.
  - phase-08:73: the success criterion only goes forward ("0.1.0 … tự cập nhật lên 0.1.1").
  - phase-08:78-80: none of the risks is a bad release.
  - phase-07:88: "rollback bằng tag trước" applies to the server only.
  - Tauri updater docs: "By default Tauri checks if the update version is greater than the current app version"; downgrades need `version_comparator`.
  - grep for `yank|rollout|canary|downgrade|version_comparator` across the plan: 0 hits.
- **Suggested fix:**
  - Add `releases.status` (draft, staged, live, yanked) and `rollout_pct`, bucketed by hash(installId), or by a random per-check value when there is no consent.
  - Add an admin "yank" action that re-points latest to N-1 for both `/v1/update` and `/download/*`.
  - Implement `version_comparator` so the server can force a downgrade.
  - Run the update check from Rust at startup, before the webview loads, with a crash-loop "safe mode" counter.
  - Add a post-build smoke test of the real installed app (tauri-driver on Windows) before a release is marked live.

## Finding 2: Writing files back corrupts or wipes user content, and the result is auto-staged
- **Severity:** Critical
- **Location:**
  - Phase 5, section "Requirements": conflict save ("Lưu & đánh dấu đã giải quyết") and staging ("thêm vào .gitignore"); "Implementation Steps" step 5.
  - Phase 2, section "Key Insights" (`TextDecoder`).
  - Phase 3, section "Overview" (1:1 port).
- **Flaw:**
  - The conflict resolver reads the **whole** file with a lossy UTF-8 decode and writes the re-joined text back.
  - The `.gitignore` append turns a file that is not valid UTF-8 into `""`, then overwrites the file.
  - The plan ports both 1:1 and adds `TextDecoder`. Its default mode replaces invalid bytes **and strips the UTF-8 BOM**.
  - No phase mentions encoding, BOM, or byte-for-byte round trips (grep: 0 hits).
- **Failure scenario** (verified with probes):
  - (a) Conflict save on Windows:
    1. A `.sln` file (always UTF-8 with BOM) or a Windows-1252/1258 legacy file conflicts during a merge.
    2. The user picks blocks and clicks Save.
    3. The BOM is dropped, and every non-UTF-8 byte in the **entire file** becomes `EF BF BD`.
    4. `markResolved` immediately runs `git add -A` on it, so the corruption goes into the merge commit. The toast says success and there is no undo.
  - (b) A `.gitignore` containing one ANSI byte, followed by "Thêm vào .gitignore", ends up as only the new pattern.
  - Probe results:

    | Probe | Input | Output |
    |---|---|---|
    | `.gitignore` append | `node_modules/\n# caf\xE9 build output\ndist/\n` | `*.log\n` |
    | Swift decode/encode | byte `E9` | `ef bf bd` |
    | Node TextDecoder/TextEncoder | `efbbbf610d0ae90a` | `610d0aefbfbd0a` |

- **Evidence:**
  - Read and write: GitRepository.swift:499-506 (`String(decoding: data, as: UTF8.self)` … `Data(contents.utf8).write(…, options: .atomic)`).
  - `.gitignore` append: GitRepository.swift:333 (`var text = (try? String(contentsOf: url, encoding: .utf8)) ?? ""`) and :336 (atomic overwrite).
  - Auto-staging: GitRepository.swift:493-497 (`markResolved` = `add -A`); RepoModel+Diff.swift:131-133 (read) and :343-345 (write, then mark resolved).
  - No undo: RepoModel+Actions.swift:125-131 (`ignore(pattern:)` has no undo action).
  - Plan text: phase-02:20 "TS decode bằng `TextDecoder`"; phase-05:25; phase-05:28; phase-05:54.
- **Suggested fix:**
  - Treat working-file round trips as **bytes**: Rust does the read and write.
  - Detect the BOM and encoding. If the file is not valid UTF-8, decode with `fatal: true` and refuse the in-app resolver (offer "mở bằng editor").
  - Apply resolutions as byte splices inside the marker regions only, and keep the BOM, line endings and file mode.
  - Append to `.gitignore` at the byte level; never read-modify-write it through a decoder.
  - Store the pre-save file content (`git hash-object -w`) so the save can be undone.
  - Add golden-byte tests: BOM, Latin-1, mixed line endings, and an executable script.

## Finding 3: Cancellation and timeouts hard-kill mutating git operations, and the result is reported as "cancelled"
- **Severity:** High
- **Location:**
  - Phase 2, sections "Key Insights", "Requirements" (`git_cancel`), "Implementation Steps" step 1 and "Risk Assessment".
  - Phase 3, "Implementation Steps" step 2.
  - Phase 8, section "Requirements" (in-app updater).
- **Flaw:**
  - **What Swift does today.** The cancellable operations include Pull (fetch plus merge or rebase), Push and remote delete. Cancel sends SIGTERM to the git process only, and git's signal handlers remove `*.lock` files.
  - **What the plan changes.**
    - It kills the whole process tree. On Windows that is a Job Object (`KILL_ON_JOB_CLOSE`), which is a hard kill with no cleanup handlers. On Unix the signal is not specified, and the "<1 s, no orphans" criterion pushes toward SIGKILL.
    - It also proposes **timeouts for "lệnh không cần mạng"**. That covers commit, merge and rebase with hooks (husky, lint-staged), LFS filters, and big checkouts.
  - **How the result is reported.** The runner maps any cancelled run to `CancelledError` regardless of exit status. A half-applied rebase, a stale `index.lock`, or a push the server already accepted all show up as "Đã huỷ".
  - **Missing pieces.**
    - No phase detects or recovers stale lock files.
    - On Windows the auto-update install exits the app, and closing the job kills every running git child.
    - A Swift defect gets ported as-is: the cancel button cancels the **last queued** task, not the one that is running.
- **Failure scenario:**
  - Pull on Windows:
    1. The user clicks Pull (rebase), then Huỷ.
    2. The job kills `git rebase` mid-checkout. The toast says "Đã huỷ: Pull".
    3. `.git/rebase-merge/` and `.git/index.lock` remain and the working tree is half-updated.
    4. Every later operation fails with "Unable to create '…/index.lock': File exists". There is no recovery UI.
  - Update during a commit: the user clicks "Cập nhật & khởi động lại" while a pre-commit hook is running. lint-staged is killed while it has the user's work stashed, so the unstaged work is left in a stash the user does not know about.
  - Wrong-op cancel: a Fetch is running and a Commit is queued. Pressing the BusyBar's cancel cancels the Commit, and the Fetch keeps going.
- **Evidence:**
  - Cancellable ops: RepoModel+Actions.swift:695 (`perform("Pull", showsProgress: true, cancellable: true)`), and also :423, :758, :950.
  - SIGTERM to the direct child only: ProcessRunner.swift:146-147 (`onCancel: { if handles.process.isRunning { handles.process.terminate() } }`).
  - Outcome masked: GitRunner.swift:107-108 (`try Task.checkCancellation()` after exit, whatever the exit code); RepoModel.swift:667-671 (any error after cancel becomes "Đã huỷ").
  - Wrong-op cancel: RepoModel.swift:682-688 (`currentOperationTask = task` is set when the op is queued; `cancelCurrentOperation()` cancels that task).
  - Plan text:
    - phase-02:21, :30, :54
    - phase-02:72 (criterion only tests fetch/clone)
    - phase-02:78 ("đặt timeout cho lệnh không cần mạng")
  - Tauri docs: "On Windows the application is automatically exited when the install step is executed".
  - grep `index.lock`: 0 hits in the plan. In Swift it appears only in a comment (RepoModel.swift:645).
- **Suggested fix:**
  - Cancel in stages: CTRL_BREAK or SIGTERM to the process group, wait 3–5 s, then hard kill.
  - Make only fetch, clone and push cancellable. Split pull into a cancellable fetch, then a non-cancellable merge or rebase.
  - Never put timeouts on local commands that change the repo.
  - After any kill or crash, run a repo health check:
    - a stale `*.lock` with no live git child gets a "Gỡ khoá" action
    - leftover in-progress state shows the operation banner
  - Return `{cancelled, exitCode}` and refresh, instead of hiding the outcome.
  - Hold the updater install until the operation queue is idle (`on_before_exit`).
  - Bind the cancel button to the op_id it is showing.

## Finding 4: The "everything can be undone" promise is a 9-second in-memory token, and a stale undo damages newer work
- **Severity:** High
- **Location:**
  - Phase 5, section "Key Insights" (undo bullet) and "Requirements" (staging, commit composer).
  - Phase 2, section "Requirements" (OS integration, `trash` crate).
- **Flaw:**
  - **Undo tokens are temporary.** The token is a dangling `stash create` SHA, the previous HEAD, or the path of a trashed file. It lives only inside a toast. The toast lasts 9 s, is evicted when a 5th toast arrives, and is lost on webview reload, crash or update restart.
  - **Undo does not check HEAD.** Undo runs `reset --merge`, `reset --hard` or `reset --soft` against **whatever branch is current when the user clicks**. Nothing checks that HEAD or the branch is still where the operation left it.
  - **Undo of a hard reset is itself `reset --hard`,** with no snapshot taken first.
  - **Untracked-file undo cannot be ported to macOS.** Swift relies on macOS's `trashItem(resultingItemURL:)`. The planned `trash` crate returns `Result<(), Error>` (no location), and its list/restore API (`os_limited`) exists only on Windows and Freedesktop, **not macOS**.
- **Failure scenario:**
  - (a) Undo on the wrong branch:
    1. The user merges `feature` into `main`; the toast offers "Hoàn tác".
    2. Within 9 s they press ⌘B and switch to `release`, then click Hoàn tác.
    3. `reset --merge <main before the merge>` runs on `release`. Release's commits disappear from the branch and the working tree is rewritten. Only the reflog can recover them, and the app does not show it.
  - (b) The user cherry-picks, commits with ⌘Enter, then clicks the cherry-pick toast's undo. Both commits are removed.
  - (c) The user hard-resets, an editor autosaves new edits, and the user clicks undo. `reset --hard` destroys those edits.
  - (d) On macOS, discarding untracked files can be undone in Swift but not with the planned crate: it silently does nothing or the files are lost for good. On Windows, drives with no Recycle Bin (USB, network share) get a nuke prompt or a permanent delete; trash-rs uses `FOF_NO_UI|FOF_ALLOWUNDO|FOF_WANTNUKEWARNING`.
- **Evidence:**
  - Toast lifetime: UIModels.swift:80-82 (`lifetime … actions.isEmpty ? 4 : 9`); RepoModel.swift:620 (only 4 toasts kept).
  - Token kept only in memory: GitRepository.swift:305-310 (`stash create`, no ref); RepoModel+Actions.swift:56-70 (snapshot held inside the closure).
  - No HEAD check:
    - RepoModel+Actions.swift:471-474 (merge undo is `resetKeepingLocalChanges(to: head)` on the current branch)
    - :539-541 (cherry-pick undo)
    - :571-574 (`reset(to: head, mode: .hard)`)
  - macOS-only trash API: GitRepository.swift:294-301 (`trashItem(at:resultingItemURL:)`).
  - Plan text: phase-02:34, :51 (`trash` crate); phase-05:21 ("Mọi thao tác phá dữ liệu đều có hoàn tác … khôi phục từ Thùng rác").
  - docs.rs/trash: `pub fn delete<T: AsRef<Path>>(path: T) -> Result<(), Error>`; `os_limited` is "only supported on Windows and Linux or other Freedesktop…".
- **Suggested fix:**
  - Persist undo records to disk: a per-repo journal plus a `refs/thaigit/undo/<ts>` ref so gc cannot prune them.
  - Make every undo compare-and-swap: record `(branch, expected HEAD after the op)` and refuse if HEAD has moved (`git update-ref <ref> <new> <expected-old>`).
  - Take a snapshot before undoing a hard reset.
  - Move discarded untracked files into an app-owned folder (`<gitdir>/thaigit-trash/<ts>/`) instead of the OS trash, or call NSFileManager via objc2 on macOS.
  - Add an "Undo history" panel.

## Finding 5: "Defer refresh while ops run" only covers watcher refreshes; auto-fetch bypasses the serialized queue
- **Severity:** High
- **Location:** Phase 4, section "Requirements" (RepoStore, the "tự fetch" setting, tabs) and "Implementation Steps" step 2.
- **Flaw:**
  - The plan presents "hoãn khi đang chạy thao tác, hàng đợi thao tác tuần tự" as a property of RepoStore. In the Swift code being ported, **only refreshes triggered by file-watcher events are deferred**.
  - Auto-fetch runs `git fetch --all --prune` **outside `perform()`**. It never increments `runningOperations` and checks for idleness only once, at the start (a time-of-check/time-of-use gap).
  - The queue is per tab, not per repository. SwiftUI's `WindowGroup(for: String)` silently de-duplicated windows for the same path; in-app tabs lose that. Linked worktrees that share one `.git` common dir cannot be de-duplicated by path at all.
- **Failure scenario:**
  1. The auto-fetch timer starts a slow `fetch --all --prune`.
  2. The user clicks Pull, and `git pull` runs its own fetch at the same time. Possible results:
     - "cannot lock ref 'refs/remotes/origin/main'"
     - the background fetch truncates and rewrites FETCH_HEAD between pull's fetch and its `get_merge_heads()`, giving "There are no candidates for merging…" or a merge of a different tip
     - prune deletes `origin/x` while the user's queued `switch -c x --track origin/x` is running

  Separately, two tabs (or two worktrees) on one repo run two independent queues, so `index.lock` and ref-lock collisions happen during normal use.
- **Evidence:**
  - Deferral: RepoModel.swift:434-448 (only inside `handleFileSystemChange`); RepoModel.swift:193-204 (`requestRefresh` has no gate on running ops).
  - Auto-fetch:
    - RepoModel.swift:461-462 (`guard … runningOperations == 0 else { continue }; await silentFetch()`)
    - RepoModel.swift:467-478 (`silentFetch` is not routed through `perform`)
    - GitRepository.swift:512-514 (`fetch --progress [--prune] --all`)
  - Window de-dup: NhanhApp.swift:11 (`WindowGroup("Nhánh", id: "repo", for: String.self)`).
  - git source: in `builtin/pull.c`, `run_fetch()` is followed by `get_merge_heads()`, which reads `git_path_fetch_head`.
  - Plan text: phase-04:23, :29, :34, :35, :56.
- **Suggested fix:**
  - Run auto-fetch through the same queue, as a low-priority op that can be pre-empted.
  - Key queues on `realpath(commonDir)`, not the tab, and de-duplicate tabs by canonical repo root.
  - Skip auto-fetch whenever a pull, push or fetch is queued.
  - Add a race regression test: a slow local remote, a background fetch, and a concurrent pull.

## Finding 6: Server limits will key on the reverse proxy's IP, and the global $2/day cap lets one abuser take AI down for everyone
- **Severity:** High
- **Location:** Phase 7, sections "Requirements" (endpoint table and defaults), "Implementation Steps" steps 3, 4 and 8, and "Risk Assessment".
- **Flaw:**
  - **Every abuse control is per-IP** and kept in memory: install registration is 10 per hour per IP, and AI requests are 30 per minute per IP.
  - **The server only ever sees the proxy's IP.** The deployment is `docker compose (api + caddy)` or an existing nginx, so the Node socket peer is the proxy for **every** request. The plan never says how to get the real client IP behind the proxy (no trusted-proxy or X-Forwarded-For rule; grep: 0 hits), so the per-IP limits become global limits.
  - **The main abuse defense is a shared failure point.** It is the system-wide $/day cap, which one abuser can exhaust for everyone.
  - **The budget check runs before the cost is known.** Cost is only known when the stream ends, so concurrent requests all pass the check.
  - **Outages double upstream calls.** On an upstream error the server retries once on a fallback model.
- **Failure scenario:**
  - (a) Launch day: a Facebook post brings 300 installs in an hour. Only 10 of them can register that hour, because all requests look like they come from the same proxy address (e.g. a Docker-network IP such as 172.18.0.x). Everyone else gets 429 and sees "hết lượt".
  - (b) If X-Forwarded-For is trusted blindly instead, one script can rotate it. Even one honest IP drains the cap:
    - Each install gets 30 + 20 + 10 = 60 requests per day.
    - A maximum-size request is 16k input tokens × $0.05/1M = $0.0008, so $2 buys about 2,500 requests, or about 42 installs.
    - At 10 installs per hour from one IP, that takes about 4 h.

    After that, AI returns 503 for **all** users for the rest of the day, every day.
  - (c) nginx is allowed by step 8. Its default `proxy_buffering on` holds SSE until the stream ends, which breaks the "< 2 s to first token" target. Its default `proxy_read_timeout 60s` cuts streams during the 60 s upstream timeout plus the fallback retry.
- **Evidence:**
  - Limits and cap: phase-07:37 (10 lần/giờ/IP); phase-07:48 ("30 request/phút/IP; trần $2/ngày toàn hệ thống … 503").
  - Implementation: phase-07:82 ("rate theo IP (bộ nhớ…) … budget (tổng cost_usd_micros hôm nay so với trần)"); phase-07:83 ("lấy usage cuối stream … thử model dự phòng 1 lần").
  - Deployment: phase-07:87 (compose api + caddy, or nginx).
  - Abuse defense: phase-07:109 ("chặn bằng trần $/ngày (giới hạn cứng)").
  - Pricing: phase-07:27 ($0.05/1M input).
- **Suggested fix:**
  - Read the client IP only from the proxy hop you control (Caddy `trusted_proxies`; accept X-Forwarded-For only from the compose network). Group IPv6 addresses by /64.
  - Reserve budget before calling upstream, using a pessimistic cost based on `max_tokens`, and settle the real cost at the end.
  - Split the cap: a per-install ceiling, plus a protected share for installs seen on at least N days.
  - Add proof-of-work or a delay to `/v1/install`.
  - Document nginx settings: `proxy_buffering off`, `X-Accel-Buffering: no`, and `proxy_read_timeout` ≥ 180 s.

## Finding 7: Server rollback assumes code-only changes; SQLite migrations only go forward and backups are nightly
- **Severity:** Medium (becomes High once the server holds live releases and quotas)
- **Location:** Phase 7, sections "Architecture" (`db.ts` migrations), "Implementation Steps" steps 1, 8 and 9, and "Success Criteria".
- **Flaw:**
  - Deploy is `docker compose pull && up -d`, then a `/healthz` check, then "rollback bằng tag trước".
  - Migrations run at startup against the shared `data/` volume. There are no down-migrations, no "additive changes first" rule, and no backup taken before a deploy; the only backup is the nightly `.backup`.
  - The same database is the **updater's source of truth** (`releases`) and holds quota and budget state.
  - The single container restarts, which drops every in-flight SSE stream.
- **Failure scenario:**
  1. Deploy N changes the primary key of `ai_quota`.
  2. `/healthz` fails for an unrelated reason, so CI rolls back to image N-1.
  3. N-1 code now runs on the N schema, and inserts into `ai_quota` throw. Then either:
     - the quota/budget code catches the error and lets requests through, so the limits **fail open**, or
     - it does not catch it, and every AI call returns 500.
  4. Restoring the nightly backup instead has its own damage:
     - it silently drops releases registered that day, so the updater stops offering the hotfix
     - it brings back anything yanked that day

  Every deploy also cuts active AI streams after quota has already been charged.
- **Evidence:**
  - Migrations: phase-07:54 (`db.ts (better-sqlite3, WAL, migrations)`); phase-07:80.
  - Backup and rollback: phase-07:87 ("backup hằng đêm … giữ 14 bản"); phase-07:88 ("`docker compose pull && up -d` → kiểm `/healthz`; rollback bằng tag trước").
  - Release state: phase-07:70 (`releases` table); phase-08:32 (CI registers releases through the API).
- **Suggested fix:**
  - Run `sqlite3 .backup` right before every deploy.
  - Allow only additive migrations for one release before removing anything, and store a `schema_version` so older code refuses to start on a newer schema.
  - Make quota and budget checks block requests when they error (fail closed).
  - Keep a signed release-manifest mirror in Git or object storage that the database can be rebuilt from.
  - Drain SSE on SIGTERM and set a `stop_grace_period`.

## Finding 8: The CRLF test checks the one configuration where CRLF never reaches the patch, and the Swift reference is broken for CRLF
- **Severity:** Medium
- **Location:**
  - Phase 3, "Implementation Steps" step 4 and "Success Criteria".
  - Phase 5, section "Success Criteria" (parity with the Swift regression scenarios).
- **Flaw:**
  - **The test can't fail.** The planned test is "file `\r\n` … `git apply --cached --recount` … với `core.autocrlf=true`". With `autocrlf=true`, git stores LF in the index and normalizes the working file before diffing, so `git diff` never contains `\r`. The test passes without touching any byte-fidelity code.
  - **The risky case is untested.** That case is CRLF stored *in the index*:
    - repos with `autocrlf=false` that committed CRLF
    - files marked `* -text`
    - files committed before autocrlf was turned on
    - files with mixed line endings
  - **Swift is not a valid reference here.**
    - Its `DiffParser` splits a `String` on the Character `"\n"`. In Swift, `"\r\n"` is a single grapheme, so CRLF lines **never split**.
    - The probe turned `"-a\r\n+b\r\n c\r\n@@ -9,1 +9,1 @@"` into **one line** and swallowed the next hunk header.
    - Swift has no CRLF diff or patch tests (its only CRLF test covers ConflictFile).
    - So "parity with the Swift regression scenarios" proves nothing for Windows CRLF repos.
- **Failure scenario:** On a Windows repo with committed CRLF, "stage 2 lines" or "discard lines" (a reverse apply to the working tree) fails. If the port also strips `\r` the way Swift's display layer does, the patch context never matches. Meanwhile QA on machines with `autocrlf=true` stays green.
- **Evidence:**
  - Diff.swift:127: `text.split(separator: "\n", omittingEmptySubsequences: false)` (probe output above).
  - DiffTests.swift:130: the only CRLF test, for ConflictFile.
  - DiffPresentation.swift:68: the display layer strips `\r`.
  - Plan text: phase-03:51, phase-03:76, phase-05:70, phase-09:30.
- **Suggested fix:**
  - Build a test matrix: {autocrlf true/input/false} × {LF in index, CRLF in index via `-text`, mixed} × {stage, unstage, discard lines, no newline at EOF}.
  - Assert byte-exact results, both the index blob (`git cat-file -p :path`) and the working file.
  - Split diff text on the `\n` byte only, keep `\r` inside the line text, and strip it only when rendering.

## Finding 9: The file watcher will churn on Windows, and the refresh target is impossible by design
- **Severity:** Medium
- **Location:**
  - Phase 2, section "Requirements" (`watch_repo`) and "Implementation Steps" step 4.
  - Phase 4, section "Requirements" (RepoStore 300 ms debounce).
  - Phase 9, section "Requirements" (performance).
- **Flaw:**
  - **No ignore filtering.** The ported classifier treats any path under the repo root (outside `.git`) as a working-tree change, with no `.gitignore` filtering.
  - **Windows makes that expensive.** On macOS, FSEvents batches events in the kernel (0.25 s), so this was cheap. On Windows, a recursive ReadDirectoryChangesW over `node_modules/`, `target/` or `bin/obj` turns every build into a continuous stream of events.
  - **Each burst costs a full status.** Each burst triggers `git status --porcelain=v2 --untracked-files=all`, which costs 50–100 ms just to start under Defender (the plan's own number) and seconds on large repos.
  - **Two debounces stack.** There is a 300 ms debounce in Rust and another 300 ms in RepoStore.
  - **The Phase 9 target can't be met.** Phase 9 demands a refresh within 300 ms of saving, which the Rust debounce alone already exceeds. That pushes the implementer to shorten the debounce, which makes the churn worse.
  - **The ignore list must be ported exactly.** Entries such as `fsmonitor` and `*.lock` must be ported byte-for-byte, or `core.fsmonitor` cookie files and the app's own lock files will trigger more refreshes.
- **Failure scenario:**
  - A user runs `cargo build` or `npm install` in a repo open in Thaigit. For minutes, status refreshes run back to back and compete with the build for disk and CPU.
  - Alternatively, someone lowers the debounce to 50 ms to pass Phase 9, and refresh frequency goes up about 6×.
- **Evidence:**
  - Classifier:
    - RepoWatcher.swift:85-89 (anything under the root is `.workingTree`)
    - RepoWatcher.swift:113 (ignored `.git` prefixes, including `fsmonitor`)
    - RepoWatcher.swift:65 (FSEvents latency 0.25 s)
  - Second debounce: RepoModel.swift:440-441.
  - Status command: GitRepository.swift:95 (`--untracked-files=all`).
  - Plan text:
    - phase-02:33, :57, :79
    - phase-04:35
    - phase-09:32 ("làm mới sau khi lưu file dưới 300 ms")
- **Suggested fix:**
  - Filter working-tree events through the `ignore` crate (gitignore rules) in Rust before emitting them.
  - Debounce once, in Rust, and adaptively: don't start the next refresh sooner than the last status call took.
  - Mute working-tree events while the app's own git operations are running.
  - Restate the target as "event → refresh starts < 400 ms", and measure status time separately.

## Finding 10: The Windows credential and environment setup differs from the Swift behaviour the plan says it keeps
- **Severity:** Medium
- **Location:**
  - Phase 2, sections "Architecture" (standard env "giữ nguyên như Swift"), "Requirements" (askpass) and "Success Criteria".
  - Phase 4 (the auto-fetch setting).
- **Flaw:**
  - (a) **Git Credential Manager (GCM) answers first on Windows.** GCM is the default credential helper for Git for Windows. Git asks it before GIT_ASKPASS, and it shows its **own** window.
    - `GIT_TERMINAL_PROMPT=0` does not stop it; only `GCM_INTERACTIVE=never` does.
    - So "HTTPS password shows a modal inside the app on both OSes" can't be met on a stock Windows install.
    - The research also claims GCM "handles SSH_ASKPASS"; it does not.
  - (b) **Background fetch can't be silenced the Swift way.** Swift silences it with `GIT_ASKPASS=/usr/bin/false`. That path does not exist on Windows, and GCM ignores it anyway.
  - (c) **A pending askpass prompt stalls the repo.** It waits up to 5 minutes. Meanwhile the repo's operation queue is blocked and watcher refreshes are deferred, so clicks pile up against a stale UI and then run in a burst.
  - (d) **The env list is incomplete.** The "giữ nguyên như Swift" list leaves out removing `LC_ALL`, `GIT_MERGE_AUTOEDIT=no`, and the pager variables.
    - If `LC_ALL` is set, git prints localized messages.
    - That breaks every recovery path that matches English error text: "would be overwritten", "[rejected]", "CONFLICT".
- **Failure scenario:**
  - A Windows user whose GitHub token has expired gets a GCM sign-in browser window opening in the background every auto-fetch interval.
  - Or the user ignores an SSH-passphrase prompt: for up to 5 minutes their stage and commit clicks queue with no feedback, then run against stale selections.
- **Evidence:**
  - Background-fetch env: RepoModel.swift:470-472 (`["GIT_ASKPASS": "/usr/bin/false", "SSH_ASKPASS": "/usr/bin/false"]`).
  - Swift env setup: GitEnvironment.swift:33-50 (`LC_ALL` removed at :40, `GIT_MERGE_AUTOEDIT` at :36).
  - Queue blocking: RepoModel.swift:439-443, :659.
  - English-text matching: RepoModel+Actions.swift:323, :594, :712, :765.
  - Plan text: phase-02:45; phase-02:56 ("Timeout 5 phút"); phase-02:73; researcher-01:80. GCM appears only in the QA matrix (phase-09:30).
  - GCM docs: `GCM_INTERACTIVE` "never/false (never prompt—fail if interaction is required)".
- **Suggested fix:**
  - Define two env profiles per operation:
    - **interactive:** sidecar askpass, GCM allowed
    - **background:** `GCM_INTERACTIVE=never`, sidecar in deny mode, ssh `BatchMode=yes`
  - Reword the success criterion to account for GCM.
  - Show askpass waits in the BusyBar with a cancel button.
  - Port Swift's whole env block as-is, and add a test that checks git still prints English when `LC_ALL=de_DE.UTF-8`.

---

## Flow trace results

| Plan claim | Swift path traced | Result |
|---|---|---|
| "Refresh deferred while ops run" (phase-04:35, :56) | RepoModel.swift:434-448 (watcher only); :193-204 (no gate); :450-478 (auto-fetch outside `perform`) | **Partly true:** only watcher-triggered refreshes are deferred |
| "Serialized op chain avoids index.lock" (scout report; phase-04:35) | RepoModel.swift:645-684 chain; but auto-fetch bypasses it and the queue is per window (NhanhApp.swift:11) | **Partly true** |
| "Undo via stash create + restore" (phase-05:21) | GitRepository.swift:305-317; RepoModel+Actions.swift:55-86, :102-118 | **True mechanically,** but it lasts only as long as the toast (UIModels.swift:82), and the untracked-file part uses a macOS-only API (GitRepository.swift:294-301) |
| "Cancellation surfaces as cancelled, not a git error" (phase-02:30; phase-03:49) | GitRunner.swift:107-108; RepoModel.swift:667-671; ProcessRunner.swift:146-147 | **True but over-broad:** it hides partial outcomes, and Swift's SIGTERM to the direct child is not the planned tree hard-kill |
| "Update check doubles as active-user ping" (phase-07:29) | No Swift counterpart (new feature). Within the plan: phase-06:32 registers every install on first run; phase-06:41 sends `X-Install-Id` with every AI call; phase-07:64-69 stores `id_hash` + `day` | **Fails as a consent boundary:** a daily-active signal is collected without telemetry consent, so phase-08:75 and phase-09:33 cannot pass. `X-Install-Id` on `/v1/update` is unauthenticated, so anyone can inflate the active-user count |
| "Paths go through stdin, never argv" (scout-report:27; phase-02:85) | GitRepository.swift:289-290, :495 use stdin; but :486-489 and :169 pass `-- path` in argv | **Partly true** (harmless with `GIT_LITERAL_PATHSPECS`, but the invariant as written is false) |

## Unresolved questions
1. **How does a `git_exec` call finish?** phase-02:29 returns `{code, stdout bytes}`, while phase-02:54 streams stdout in 64 KB Channel chunks. Tauri does not document whether Channel messages arrive before the `invoke` promise resolves. Resolving on an in-band "exit" message over the channel would avoid parsing truncated `log`/`status` output.
2. Which operations will be cancellable in Thaigit? (In Swift: fetch, pull, push, push tag, delete remote branch.)
3. Does the update check run in Rust (survives a broken frontend) or in JS (`UpdateToast.svelte`)?
