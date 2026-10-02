# Red-team plan review: Assumption Destroyer + Scope Auditor

- **Plan:** `plans/261002-1543-tauri-cross-platform-hermes-ai-stats/` (plan.md, phase-01..09, research/*, reports/scout-report.md)
- **Reviewer:** code-reviewer, adversarial ("Assumption Destroyer" lens, "Scope Auditor" verification role)
- **Date:** 2026-10-02
- **Method:** I checked plan claims with `grep -n` against the plan files and the Swift reference (`Sources/`, `Tests/`). External claims were checked against live endpoints and primary sources: the Nous inference API, the OpenRouter catalog, Tauri source and docs, trash-rs source, and Microsoft docs.
- **Not re-litigated (user decisions):** Tauri 2 single codebase; AI through the owner's proxy holding the Hermes/Nous key; backend on the existing VPS; expanded scope.

**Counts:** 10 findings (1 Critical, 7 High, 2 Medium). **Scope audit: FAILED** (7 of 10 state items fail; see the table at the end).

---

## Finding 1: The AI premise is broken: Hermes 4 70B/405B are retired on Nous Portal, and the remaining Hermes route costs 20–85x the plan's math
- **Severity:** Critical
- **Location:** Phase 7, sections "Key Insights" (pricing), "Requirements" (defaults), and the env vars under "Architecture". Phase 6, "Key Insights". plan.md, "Kiến trúc tổng quát" and "Câu hỏi còn mở" #2. research-02 §1.
- **Flaw:** Every model, cost and budget decision assumes `Hermes-4-70B` on Nous Portal at $0.05 in / $0.20 out per 1M tokens, called through the hostname given in research. On 2026-10-02:
  - The live Nous inference API rejects every Hermes 4 id as **retired**.
  - The public model catalog has 424 models and none of them is a Hermes model.
  - The research hostname is NXDOMAIN.
  - On OpenRouter, the only Hermes 4 still listed is `nousresearch/hermes-4-405b`, at **$1.00 in / $3.00 out**.
- **Failure scenario:**
  - The Phase 7 success criterion ("curl … stream được message thật từ Hermes") fails on day one with HTTP 404. `AI_MODEL_FALLBACK` is also a Hermes id, so it fails too.
  - If the owner switches to the only Hermes 4 still sold (405B on OpenRouter), costs jump:
    - A typical request (4k in + 150 out) costs **$0.00445**, which is 22x the plan's $0.0002.
    - A worst-case request at the plan's own 16k-token input cap costs **~$0.0169**, about 85x.
  - The **$2/day global cap** then covers only ~449 typical or ~118 worst-case requests per day for the *whole user base*. Two to eight installs using their 60/day quotas (30 commit + 20 explain + 10 PR) use it up.
  - The plan's "1.000 lượt/ngày ≈ $0,2/ngày" becomes $4.45–$16.90/day (~$135–$510/month).
- **Evidence:**
  - plan.md:41 — "proxy SSE ──►│── Nous Portal (Hermes 4)". plan.md:58 — "Model mặc định (Hermes-4-70B)?". plan.md:67 — "Hermes 4 70B có context 128k … giá theo token rất thấp nên không cần gói thuê bao lớn".
  - phase-07-vps-server-ai-proxy-stats-updater.md:27 — "Hermes-4-70B khoảng $0,05/1M token vào và $0,20/1M token ra … khoảng **$0,0002**. 1.000 lượt/ngày chỉ tốn khoảng $0,2/ngày".
  - phase-07…:48 — "trần **$2/ngày** … tối đa 16k token đầu vào". phase-07…:73 — "`AI_MODEL` (vd. Hermes-4-70B), `AI_MODEL_FALLBACK`".
  - phase-06-ai-commit-features-hermes.md:20 — "Hermes 4 (70B/405B) có context 128k … Ngân sách mặc định khoảng 12k token cho diff".
  - research/researcher-02-hermes-ai-backend-report.md:12 — "`https://api.nous.nousresearch.com/v1/chat/completions`". `host` on 2026-10-02 09:19 UTC returned **NXDOMAIN**. The real base URL is `https://inference-api.nousresearch.com/v1`.
  - Live probe on 2026-10-02 (no auth): `POST https://inference-api.nousresearch.com/v1/chat/completions` with `Hermes-4-70B`, `Hermes-4-405B`, `nousresearch/hermes-4-70b` and `nousresearch/hermes-4-405b` all returned `{"status":404,"message":"This model has been retired. Please select a different model to continue!"}`. Unknown ids get a *different* message ("…not found…"), so this is specific to Hermes 4. `GET /v1/models` returned 424 models, 0 containing "hermes".
  - OpenRouter `GET /api/v1/models` (2026-10-02) lists only `nousresearch/hermes-4-405b` ($1.00/M prompt, $3.00/M completion), `hermes-3-llama-3.1-70b` ($0.70/$0.70) and `hermes-3-llama-3.1-405b` ($1/$1). There is no Hermes 4 70B.
  - Caveat: a third-party guide (openclawlaunch.com/guides/nous-portal) still says Hermes-4-70B/405B run on Nous's backend. That contradicts the live API, which is why a test with the owner's key is required.
- **Suggested fix:**
  - Before any Phase 6 or 7 work, run a ~30-minute test with the owner's key: call authenticated `GET /v1/models`, confirm which Hermes id is actually served today and at what price, and re-derive quotas and the cap from the **16k worst case**, not 4k.
  - Store the price per model in the `settings` table, not in prose.
  - Add a server boot self-check that calls the configured model and refuses to start on 404 or "retired".
  - Answer open question #2 from this data, not from the research.

## Finding 2: Consent and privacy copy promise "not stored", but Nous Portal's default policy keeps, shares and may train on prompts
- **Severity:** High
- **Location:** Phase 6, "Requirements" (consent) and "Risk Assessment". Phase 8, "Requirements" (privacy page). Phase 9, "Requirements" (privacy audit).
- **Flaw:** The consent dialog tells users their content is not stored, and the privacy audit only inspects the Thaigit server. Nous Portal's privacy policy (last updated 2026-09-28) says Nous:
  - collects prompts, inputs, outputs and API calls;
  - may disclose them to model providers and partners;
  - may use them for training and fine-tuning.

  This is the default unless the account owner turns on **Privacy Mode**, which no phase mentions. Nous's own error text also shows models are resolved through an "OpenRouter catalog", so there may be a further processor hop that the consent copy leaves out.
- **Failure scenario:**
  - A corporate user reads "không lưu nội dung" and clicks agree.
  - Their staged diff (proprietary code, filtered only by path patterns) is kept by Nous and can be used for training.
  - The consent text and the privacy page are factually false. That is the purpose-specific consent defect the plan's own PDPL reference warns about.
  - The Phase 9 privacy check still passes, because it only looks at Thaigit's server logs.
- **Evidence:**
  - phase-06:30 — "gửi tới đâu (server Thaigit → Nous Research), không lưu nội dung".
  - phase-06:78 — "server không log nội dung, công bố chính sách rõ ràng".
  - phase-09:33 — "server không lưu nội dung, trang privacy khớp thực tế". phase-07:119 cites PDPL / Nghị định 13.
  - research-02:300 — "*retention* (logs redacted, not stored), *privacy* (your code is never logged)".
  - `grep -n "Privacy Mode\|training\|huấn luyện"` across the plan returns 0 hits.
  - https://portal.nousresearch.com/privacy: "When Privacy Mode is enabled, we will not store your inference payloads and will not use such inference payloads for training…". It also says data may be disclosed to "model providers" and to "providers that support … training, fine-tuning". Privacy Mode is turned on manually under Account Settings → Privacy Settings.
  - Live 404 text: "…does not exist in our configuration or OpenRouter catalog."
- **Suggested fix:**
  - Add a Phase 7 step: enable Privacy Mode on the Nous account, record proof (date and screenshot), and re-check it every release. If the API exposes the setting, assert it at server boot.
  - Rewrite the consent and privacy text to name each processor in the chain (Thaigit → Nous → upstream provider) and its retention terms.
  - Extend the Phase 9 privacy audit to cover upstream terms, not only Thaigit's server.

## Finding 3: One install ID is registered at first launch, before any consent, and serves two consent purposes (scope audit FAILED)
- **Severity:** High
- **Location:** Phase 6, "Requirements" (Danh tính cài đặt) and "Architecture". Phase 7, "Key Insights", the endpoints table and the schema. Phase 8, "Requirements" and "Success Criteria".
- **Flaw:**
  - The UUID is created and sent to `POST /v1/install` with `{installId, platform, appVersion}` on **first run** ("lần chạy đầu"). That happens before AI consent (which is "lần đầu dùng") and regardless of the telemetry opt-in.
  - The `installs` table (`created_at, last_seen_at, platform, app_version`) is per-install telemetry in all but name.
  - The same raw ID goes out as `X-Install-Id` on **every AI request**, and is also the DAU key for update checks.
  - So two consent purposes share one identifier and one lifetime.
- **Failure scenario:**
  - A user declines telemetry in onboarding but uses AI.
  - The server still receives their `X-Install-Id` on every AI call, and already stored their platform and version at first launch.
  - Phase 8's check "Không đồng ý thống kê → server không nhận `X-Install-Id` (kiểm log)" fails by design.
  - `ai_requests`/`ai_quota.id_hash` and `daily_active.id_hash` use the same HMAC of the same ID, so data from users who declined telemetry can be joined with consented DAU rows.
- **Evidence:**
  - phase-06:32 — "lần chạy đầu tạo UUID → `POST /v1/install` nhận token ký HMAC → lưu bằng tauri-plugin-store".
  - phase-06:41 — "headers: X-Install-Id, X-Install-Token, X-App-Version".
  - phase-07:28 — one `ID_HASH_SECRET` for all tables.
  - phase-07:29 — "gửi `X-Install-Id` chỉ khi người dùng đã đồng ý".
  - phase-07:37 — "`{installId, platform, appVersion}` → `{token}`".
  - phase-07:64 — `installs(id_hash TEXT PRIMARY KEY, created_at, last_seen_at, platform, app_version)`.
  - phase-08:33–34, :75. research-02:287 — "Consent is purpose-specific; cannot be catch-all".
- **Suggested fix:**
  - Split identity by purpose and lifetime:
    - `ai_install_id`: created lazily on AI consent; deleted or rotated when AI is turned off.
    - `telemetry_id`: created on telemetry opt-in; deleted on opt-out.
  - Hash the two IDs with different secrets so the tables can't be joined.
  - `/v1/install` should store only the quota key.
  - Reword the Phase 8 success criterion to "no telemetry ID on updater requests without consent".

## Finding 4: Abuse controls turn into a global outage: the $/day cap is the only real limit, and per-IP limits are keyed to the reverse proxy
- **Severity:** High
- **Location:** Phase 7, "Requirements" (defaults), "Implementation Steps" 3 and 8, "Risk Assessment".
- **Flaw:**
  1. `/v1/install` signs any UUID, so HMAC tokens are free and per-install quotas stop nobody. The plan itself leaves spoofed UUIDs to the $/day cap and IP limits.
  2. When the cap is reached, *everyone* gets 503. The protection is a kill switch any single client can trigger.
  3. The IP limiter is in memory, and Hono sits behind Caddy in docker-compose (or behind the existing nginx). Nothing says how the client IP is derived — no `X-Forwarded-For`, no trusted-proxy list. With `@hono/node-server` the socket address is the proxy container's IP.
  4. nginx's default `proxy_buffering on` buffers SSE.
- **Failure scenario:**
  - One script at the plan's own 30 req/min/IP limit, sending worst-case bodies, uses the whole $2 cap in **~4 min** at Hermes-4-405B prices (~15 min with typical bodies). Even at the plan's assumed price it takes ~77 min.
  - AI is then down for every user until the day bucket rolls over, every day.
  - If the IP is read from the socket:
    - "30 req/min/IP" becomes a **global** 30 req/min.
    - "10 installs/hour/IP" becomes 10 new installs per hour **worldwide**. On launch day most users can't register, and the "token hỏng → đăng ký lại" retry loop hammers the endpoint.
  - If XFF is trusted blindly, an attacker rotates fake values and bypasses all limits.
  - CGNAT, which is common on Vietnamese mobile and ISP networks, groups unrelated users under one IP.
  - If the VPS already runs nginx (open question #1), SSE is buffered until the stream ends, and the "<2 s first token" target fails.
- **Evidence:**
  - phase-07:37 — "Idempotent. Giới hạn 10 lần/giờ/IP".
  - phase-07:48 — "30 request/phút/IP; trần **$2/ngày** toàn hệ thống (chạm trần → 503 có thông điệp)".
  - phase-07:82 — "rate theo IP (bộ nhớ, cửa sổ trượt), budget (tổng `cost_usd_micros` hôm nay so với trần)".
  - phase-07:87 — "docker compose (api + caddy, hoặc chỉ api nếu VPS đã có nginx)".
  - phase-07:109 — "Lạm dụng (giả UUID, script spam): chặn bằng trần $/ngày (giới hạn cứng)".
  - phase-06:72 — first token under 2 s. phase-06:82 — "Token cài đặt không phải bí mật tuyệt đối". research-02:173 — "Trivially broken". plan.md:57 — the open nginx/Caddy question.
  - `grep -n "X-Forwarded\|trusted\|proxy_buffering\|X-Accel\|IPv6\|CGNAT"` across the plan returns 0 hits.
- **Suggested fix:**
  - Derive the client IP explicitly: trust XFF only from the proxy on the compose network, take the right-most untrusted hop, and bucket IPv6 addresses by /64.
  - Add a per-install burst limit and a **global** requests-per-minute ceiling set below "cap ÷ 1440 min", so the budget lasts the whole day.
  - Reserve part of the budget for established installs (e.g., older than 24 h with earlier successful calls).
  - Ship `proxy_buffering off` / `X-Accel-Buffering: no` in `nginx.conf.example`.
  - Add an SSE time-to-first-token test *through the real proxy* to Phase 7 step 10.

## Finding 5: The `git_exec` IPC contract, as written, sends bytes as JSON or silently truncates output, and can't run in the planned worker
- **Severity:** High
- **Location:** Phase 2, "Key Insights", "Requirements" (git_exec) and "Architecture". Phase 3, "Key Insights" and step 9. Phase 4, "Architecture".
- **Flaw:**
  1. "Channel gửi `Vec<u8>`" is the JSON trap. Tauri's own source says a `Channel<Vec<u8>>` is sent as a JSON array of numbers.
  2. `git_exec` both streams chunks over the Channel *and* "returns {code, stdout bytes, stderr text}". A command's return value is serialized to JSON unless it is a `tauri::ipc::Response`, so bytes in a returned struct become JSON as well.
  3. Raw channel messages over 1 KiB are not pushed directly. Rust `eval`s a script that starts a second `invoke(plugin:__TAURI_CHANNEL__|fetch)`, and the chunk lands only when that fetch resolves. The command's own promise can resolve **before** the last 64 KB chunks arrive. The JS `Channel` has no public end/close hook (`cleanupCallback` is private), so a TS runner that resolves on `await invoke()` will sometimes parse a truncated `log -z`, `status -z` or `diff`.
  4. `invoke` uses `window.__TAURI_INTERNALS__`, which doesn't exist in a Web Worker. As in Swift, `repository.history()` runs the git command, parses the output and lays out the graph in one call, so it can't run in `history.worker.ts`. Nothing in the plan splits exec (main thread) from parse/layout (worker), or proxies Exec to the main thread.
  5. Core tests use the Node `child_process` adapter, so none of points 1–4 is exercised by the planned 45 Vitest tests.
- **Failure scenario:**
  - Intermittent: the graph is missing commits or has a malformed last row, the staging list drops its last files, a diff loses its tail. None of it reproduces in tests.
  - If the Channel is implemented literally as `Channel<Vec<u8>>`, the 6 MB / 30k-commit log becomes ~20 MB of JSON digits and misses the Phase 2 "<1 s" criterion.
- **Evidence:**
  - phase-02:20 — "(`tauri::ipc::Response` / Channel gửi `Vec<u8>`) … Không bọc vào JSON".
  - phase-02:29 — "`git_exec(req, on_event: Channel)` … Trả {code, stdout bytes, stderr text}. Stream … stdout lớn theo khối".
  - phase-02:40 — "bytes(stdout chunks) / progress lines / exit". phase-02:54 — "stdout gom khối 64 KB gửi qua Channel".
  - phase-03:20 — "Core phụ thuộc một interface `Exec` duy nhất: test chạy bằng Node `child_process`". phase-03:56 — parse and layout in a Web Worker.
  - phase-04:48 — "`repository.history()` qua Exec Tauri → bytes → worker parse + layout". Swift `GitRepository.swift:128-137` does exec, parse and layout in one call.
  - Tauri `crates/tauri/src/ipc/channel.rs`:
    - :110 — "A command can only resolve once, so a channel is how you push … messages … after the command returned".
    - :148–149 — "Note that a `Channel<Vec<u8>>` does *not* do this - `Vec<u8>` is `Serialize`, so it is sent as a JSON array of numbers."
    - :38 — `MAX_RAW_DIRECT_EXECUTE_THRESHOLD: usize = 1024`.
    - :306 — "use the fetch API to speed up larger response payloads".
  - `packages/api/src/core.ts`:181 — `private cleanupCallback()`. :435 — `window.__TAURI_INTERNALS__.invoke(...)`.
- **Suggested fix:**
  - Specify the wire protocol: `Channel<InvokeResponseBody>` carrying **Raw** frames with a 1-byte tag (stdout chunk / stderr line / `exit{code}`).
  - The command returns `()`. The TS promise resolves only when the in-band `exit` frame arrives; ordering guarantees it comes after the last stdout frame.
  - Split the core API into `exec*()` (bytes, main thread) and pure `parse*/layout(bytes)` functions (worker).
  - Add a test that runs through the real Tauri IPC (WebdriverIO, see Finding 10), streams more than 50 MB, and compares a hash.

## Finding 6: `git_exec` with caller-supplied args and env can run any command, so "the frontend can't spawn arbitrary commands" is false
- **Severity:** High
- **Location:** Phase 2, "Requirements" (git_exec), "Implementation Steps" 6, "Security Considerations". Phase 6, "Security Considerations".
- **Flaw:**
  - The webview passes free-form `args` and extra `env` to the located git binary, and git can launch arbitrary programs:
    - via config flags: `-c core.fsmonitor=<cmd> status`, `-c core.sshCommand=<cmd> fetch`, `-c protocol.ext.allow=always clone ext::<cmd>`, `-c alias.x='!<cmd>' x`;
    - via options: `--upload-pack=<cmd>`;
    - via env: `GIT_SSH_COMMAND`, `GIT_EXTERNAL_DIFF`, `GIT_PAGER`, `GIT_ASKPASS`.
  - The webview also renders attacker-controlled content: commit messages, file names and diffs from cloned repos, plus LLM output generated from those diffs (open to prompt injection) and shown as markdown.
  - So any XSS or sanitizer slip becomes remote code execution through a single allowed IPC call.
  - The Swift app never had this boundary: its global args were built in-process.
- **Failure scenario:**
  - A malicious repo's diff carries a prompt injection.
  - The Explain panel renders model output that slips past the sanitizer, or a later change adds `{@html}`.
  - The script calls `invoke('git_exec', {args:['-c','core.fsmonitor=powershell -enc …','status']})` and runs code as the user.
  - Tight capabilities don't help, because `git_exec` itself is allowed.
- **Evidence:**
  - phase-02:29 — "args, cwd, stdin (bytes), env thêm, acceptExitCodes".
  - phase-02:59 — "tắt `shell:allow-execute` … không cho JS tự spawn bất kỳ thứ gì".
  - phase-02:84 — "frontend không spawn được lệnh tuỳ ý. Chỉ `git_exec` (binary git đã định vị)".
  - phase-06:28 — "panel markdown". phase-06:84 — "markdown đã sanitize (không chạy HTML)". phase-04:87 — escape-only rule for commit messages.
  - Swift `GitRunner.swift:66-75` — fixed `globalArguments` built in-process.
- **Suggested fix:**
  - Make Rust the trust boundary:
    - Rust alone adds the fixed global `-c` set; reject any caller-supplied `-c` or `--config-env`.
    - Allow only a short list of extra env keys (`GIT_LITERAL_PATHSPECS`, `GIT_OPTIONAL_LOCKS`).
    - Reject `--upload-pack`, `--receive-pack`, `--exec` and `-u`, plus `ext::` and `fd::` URLs.
  - Better: expose typed commands (`git_log`, `git_status`, `git_apply_cached`, …) instead of a raw exec.
  - Add a Phase 9 security test: an XSS payload in a commit message or in AI output must not be able to reach `git_exec` with a hostile argv.

## Finding 7: The macOS beta and release path fails on Apple Silicon, and the sidecar and updater targets aren't planned
- **Severity:** High
- **Location:** Phase 8, "Key Insights", "Architecture", "Related Code Files", "Implementation Steps" 2. Phase 2, "Related Code Files" (askpass `externalBin`). research-01 §6.
- **Flaw:**
  1. **Unsigned macOS beta.** Beta builds ship unsigned, and the plan assumes users can click "Vẫn mở" (Open Anyway). A Tauri bundle built with no signing identity has only the linker's ad-hoc signature with unsealed resources, and Apple Silicon reports it as **"damaged"** with no Open Anyway option. Tauri's docs say ad-hoc signing (`signingIdentity: "-"`) is needed "on ARM … where code-signing is required for all apps from the Internet". The planned `tauri.conf.json` edits don't include it.
  2. **Unbuilt sidecar.** The askpass sidecar is an `externalBin`, and Tauri doesn't build it. It needs prebuilt `thaigit-askpass-<triple>` files, including a lipo'd `-universal-apple-darwin` file for `--target universal-apple-darwin`. Neither CI (from Phase 2 on) nor `release.yml` builds or renames it.
  3. **Wrong updater target.** research-01 says `{{target}}` is `windows/macos/linux`. Tauri actually sends `darwin`, and `{{arch}}` is the runtime arch (`aarch64` or `x86_64`), never "universal". The server's asset selection must map both darwin arches to the universal tarball.
- **Failure scenario:**
  - Every macOS beta tester on an M-series Mac sees "Thaigit is damaged and can't be opened", and the FAQ screenshots don't match what they see.
  - Release (and Phase 1 CI's `tauri build --debug`, once Phase 2 lands) fails at bundling because `…/thaigit-askpass-universal-apple-darwin` doesn't exist.
  - If the update route is built from the research, macOS update checks never find an asset, so 0.1.0 never updates.
- **Evidence:**
  - phase-08:24 — "không notarize thì … vào … **"Vẫn mở"** mới chạy được".
  - phase-08:41 — "`tauri build --target universal-apple-darwin`".
  - phase-08:52 — the `tauri.conf.json` edit list (pubkey, endpoints, createUpdaterArtifacts, minimumSystemVersion, nsis, webviewInstallMode) has no `signingIdentity`. `grep "signingIdentity\|ad-hoc"` returns 0 hits.
  - phase-08:56 — "`release.yml` không ký trước (bản beta)".
  - phase-02:49 — "crate bin `thaigit-askpass`, khai báo `externalBin`". phase-01:52 — CI runs `tauri build --debug`.
  - phase-07:84 — "logic chọn asset theo `target/arch`". phase-08:45 — `assets{darwin-universal|windows-x86_64…}`.
  - research-01:107 — "`{{target}}`: `windows`/`macos`/`linux`".
  - v2.tauri.app/distribute/sign/macos — "This is useful on ARM (Apple Silicon) devices, where code-signing is required for all apps from the Internet … provide the pseudo-identity `-`".
  - v2.tauri.app/develop/sidecar — "a binary with the same name and a `-$TARGET_TRIPLE` suffix must exist".
  - v2.tauri.app/plugin/updater — "`{{target}}`: one of `linux`, `windows` or `darwin`".
- **Suggested fix:**
  - Use `signingIdentity: "-"` (or `APPLE_SIGNING_IDENTITY=-`) whenever no Developer ID secret is present, and rewrite the FAQ to match.
  - Add `scripts/build-sidecar.*` to CI and release, before `tauri build`: per-target `cargo build`, `lipo` into a universal binary, rename with the triple. Alternatively, let the main binary act as askpass (`thaigit --askpass`) and drop `externalBin`.
  - Pin the update route to `darwin|windows` × `x86_64|aarch64`, with a unit test that maps both darwin arches to the universal asset.

## Finding 8: "Core depends only on Exec" is false; the repository code does direct filesystem I/O, and macOS trash-undo can't be ported with the `trash` crate
- **Severity:** Medium
- **Location:** Phase 3, "Key Insights". Phase 2, "Requirements" and "Related Code Files". Phase 4, "Related Code Files" (capabilities). Phase 5, "Key Insights" (undo).
- **Flaw:**
  - NhanhCore doesn't only run git. It also touches the filesystem directly:
    - reads `rebase-merge/*`, `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD` and `BISECT_LOG` to detect an in-progress operation;
    - reads `MERGE_MSG` / `SQUASH_MSG`;
    - reads and writes working files for the conflict resolver and image diff;
    - appends to `.gitignore`;
    - creates directories for clone and init;
    - moves files to the Trash, and back again on undo.
  - None of this is covered by the planned Rust commands (exec, cancel, locate, askpass, watch, OS integration) or the planned capabilities (no `fs` plugin). An fs command callable from the webview also needs path scoping (see Finding 6).
  - On macOS the `trash` crate can't support undo:
    - `trash::delete` returns `()`, so the trashed location is lost.
    - The crate's list/restore API (`os_limited`) is compiled only for Windows and Linux.
    - The default macOS method drives Finder through `osascript`. That triggers an Automation permission prompt, and under the hardened runtime it fails without the apple-events entitlement.
  - Swift's undo depended on `trashItem(at:resultingItemURL:)` returning the new location.
- **Failure scenario:**
  - A Phase 3 core with only Exec can't implement `operationState()`, so merge/rebase/cherry-pick banners never show.
  - "Lưu & đánh dấu đã giải quyết" has no way to write the file.
  - In Phase 5, "Huỷ thay đổi → Hoàn tác" on macOS can't find the trashed untracked files. On a notarized build the first discard may show "Thaigit wants to control Finder", or simply fail.
- **Evidence:**
  - phase-03:20 — "Core phụ thuộc một interface `Exec` duy nhất".
  - phase-02:48 — the Rust module list has no fs module. phase-02:34 — "đưa file vào Thùng rác (crate `trash`)".
  - phase-04:52 — capabilities "(dialog, opener, clipboard, store, window-state, single-instance)".
  - phase-05:21 — "port nguyên cơ chế: … khôi phục từ Thùng rác".
  - `GitRepository.swift`:
    - :216-241 — `operationState()` reads files in the git dir.
    - :244-252 — reads `MERGE_MSG` / `SQUASH_MSG`.
    - :294-303 — `trashItem(at:resultingItemURL:)`.
    - :331-337 — `.gitignore` append.
    - :499-506 — read/write working file.
    - :628 and :634 — `createDirectory`.
  - `RepoModel+Actions.swift`:64 and :75-83 — undo moves the trashed URL back.
  - trash-rs 5.2.9:
    - `pub fn delete<T: AsRef<Path>>(path: T) -> Result<(), Error>`.
    - `os_limited` is gated on `#[cfg(any(target_os = "windows", all(unix, not(target_os = "macos"), …)))]`.
    - `src/macos/mod.rs`:22-30 — "Use an `osascript`, asking the Finder application … Might ask the user to give additional permissions … This is the default."
    - :100 — `trashItemAtURL_resultingItemURL_error(&url, None)`.
- **Suggested fix:**
  - Add a `RepoFs` port to the core: a Node adapter for tests and Rust commands for the app. Give it typed operations scoped to the repo root or git dir: `read_git_file`, `read_worktree_file`, `write_worktree_file_atomic`, `append_gitignore`, `mkdirp`.
  - Trash on macOS: call `NSFileManager trashItemAtURL:resultingItemURL:` (via objc2) and keep the URL.
  - Trash on Windows: use `trash::os_limited::list` + `restore_all`, matching on original path and deletion time.
  - Add 2–3 days to Phase 2.

## Finding 9: The port copies Swift's lossy UTF-8 decoding; line staging fails and conflict resolution silently corrupts non-UTF-8 files
- **Severity:** High
- **Location:** Phase 2, "Key Insights" (TextDecoder). Phase 3, "Key Insights" and steps 4 and 7. Phase 5, "Requirements" (conflict). The Phase 3 and Phase 5 success criteria.
- **Flaw:**
  - Swift decodes all git stdout with `String(decoding:as: UTF8.self)`, which turns invalid bytes into U+FFFD.
  - It parses diffs as `String`, rebuilds patches from `String` lines, and writes the resolved conflict file back with `Data(contents.utf8)`.
  - The plan ports this as is ("TS decode bằng `TextDecoder`"), and its tests only cover UTF-8 Vietnamese text, CRLF and missing final newline.
  - Non-UTF-8 files are common on Windows and in Vietnamese legacy code: Windows-1258, TCVN3/VNI, and CP1252 in `.bat` files or .NET resources.
- **Failure scenario:**
  1. Staging one line of a CP1258 file produces a patch with U+FFFD in place of the original bytes, and `git apply --cached --recount` fails with "patch does not apply".
  2. Resolving a conflict in such a file with "Lưu & đánh dấu đã giải quyết" replaces every non-ASCII byte in the **whole file** with `EF BF BD`, and the result is `git add`ed. That is silent, committed data corruption, and the CRLF/UTF-8 tests stay green.
- **Evidence:**
  - `ProcessRunner.swift`:15-16 — `String(decoding: stdout, as: UTF8.self)`.
  - `Diff.swift`:100 and :127 — the diff is parsed from a `String` split on `"\n"`.
  - `PatchBuilder.swift`:62-72 — the patch is assembled from `String` lines.
  - `GitRepository.swift`:319-324 — `input: Data(patch.utf8)`.
  - `GitRepository.swift`:499-506 — `String(decoding: data, as: UTF8.self)` and `Data(contents.utf8).write`.
  - phase-02:20 — "TS decode bằng `TextDecoder`". phase-02:60 — "giữ đúng byte UTF-8 tiếng Việt và CRLF".
  - phase-03:51 and :70 — only LF/CRLF/no-EOL tests. phase-05:28 — "Lưu & đánh dấu đã giải quyết".
- **Suggested fix:**
  - Keep content byte-exact end to end: parse diffs over `Uint8Array` (or decode with `latin1` for patch reconstruction) and decode as UTF-8 only for display.
  - Build patches as bytes.
  - In the conflict resolver, work on raw byte lines, or refuse in-app resolution and offer "Mở bằng editor" when `new TextDecoder('utf-8', {fatal:true})` throws.
  - Add Phase 3 tests: stage one line of a CP1258 file, and resolve a conflict in a CP1252 file, each with a byte-equality assertion.

## Finding 10: The 10–13 week estimate is a serial sum with no buffer, hides calendar blockers, and relies on an outdated E2E assumption
- **Severity:** Medium
- **Location:** plan.md, "Thứ tự & song song". Phase 8, effort and "Key Insights". Phase 9, effort, "Key Insights" and "Success Criteria".
- **Flaw:**
  - The phase efforts add up to **47–65 working days = 9.4–13 weeks**. So "10–13 weeks" has no contingency, and "Phase 7 song song" means nothing for a single developer.
  - Calendar-bound work sits inside fixed day counts:
    - Phase 9 (5–7 days) must include a 5–20-user beta that "dùng ổn ≥ 1 tuần", while Phase 8 already has its own beta-and-fix loop.
    - The Apple Developer enrollment wait is acknowledged but not counted.
    - Azure Artifact Signing is not available to individuals outside the US/Canada (2026). Windows signing therefore means an OV certificate whose key must live on an HSM or cloud signer: procurement time plus a CI integration nobody has scoped.
  - Phase 9's E2E plan rests on an outdated premise. The WebdriverIO Tauri service now drives real apps on **macOS** through `tauri-plugin-wdio-webdriver`, yet the plan leaves macOS without real-app E2E for the Rust exec, askpass and watcher.
- **Failure scenario:**
  - Phase 9 can't meet its own success criteria within its budget; the soak week alone uses it up.
  - Windows signing slips past 1.0, so 1.0 ships with SmartScreen warnings.
  - macOS-only regressions in the Rust layer reach users, because only Windows has real-app E2E.
- **Evidence:**
  - plan.md:52 — "Phase 7 (server) làm song song từ sau phase 1". plan.md:53 — "khoảng 10–13 tuần cho 1 người".
  - Effort fields (line 6 of each phase file): phase-01 "2-3", phase-02 "4-6", phase-03 "6-8", phase-04 "8-10", phase-05 "10-14", phase-06 "3-4", phase-07 "5-7", phase-08 "4-6 ngày (+ thời gian chờ duyệt Apple Developer…)", phase-09 "5-7".
  - phase-09:55 — "Beta mở rộng (5–20 người dùng)". phase-09:71 — "beta dùng ổn ≥ 1 tuần".
  - phase-08:25 — "Azure Artifact Signing ≈ $10/tháng nếu tài khoản cá nhân ở VN đủ điều kiện".
  - phase-09:26 — "`tauri-driver` … **không** chạy trên macOS".
  - Microsoft Learn (Artifact Signing): individuals are eligible only in the USA and Canada.
  - v2.tauri.app/develop/tests/webdriver: the embedded provider (`tauri-plugin-wdio-webdriver`) "works on Windows, Linux, and macOS".
- **Suggested fix:**
  - Re-baseline as 47–65 effort days, plus a 20–25% buffer, plus explicit calendar milestones: Apple enrollment, the Windows certificate and HSM, and a beta soak of at least 7 days.
  - Start procurement in Phase 1.
  - Move the soak out of Phase 9's effort into its own "Beta window" milestone.
  - Replace the Windows-only tauri-driver layer with the WebdriverIO service (embedded provider) on both OSes.

---

## Scope Audit: state additions and lifetimes

| # | State (owner) | Classification | Verdict | Evidence / defect |
|---|---|---|---|---|
| 1 | Install UUID + HMAC token, `id_hash` secret (client store; server) | Per-installation persistent | **FAILED** | Created on first run, before consent. One ID covers two consent purposes, and one `ID_HASH_SECRET` makes AI and DAU tables joinable. phase-06:32, phase-07:28-29/37/64, phase-08:75. See Finding 3. |
| 2 | AI consent / telemetry consent flags (client settings) | Per-installation persistent | PASS | phase-06:30, phase-08:34. The flags themselves are fine, but they don't control the ID lifecycle (row 1). |
| 3 | Git path setting (JS `app.svelte.ts` + plugin-store) vs located git + env (Rust `locate.rs`) | Setting: per installation. Resolved env: per app session | **FAILED** | Two sources of truth with no sync or invalidation rule, and nothing refreshes open repos when the macOS login-shell PATH loads late. Swift rebuilt a single `GitEnvironmentStore` from UserDefaults whenever either input changed. phase-04:34/41, phase-02:55/84; AppState.swift:64-69, :90-107; GitEnvironment.swift:105-126. |
| 4 | Askpass listener + token (Rust) | Per app session | PASS with defects | Session lifetime is correct (phase-02:56). Defects: requests carry no op/tab ID, so the modal can't say which repo is asking. If the webview reloads, a pending request leaves git blocked until the 5-min timeout. On Windows, GCM is Git for Windows' default `credential.helper` and handles HTTPS itself, so "Push qua HTTPS … modal trong app, trên cả 2 OS" (phase-02:73) can't be met on a default install. |
| 5 | Watcher registry, repoId → notify debouncer (Rust) | Should match the tab; planned as app lifetime with explicit JS `unwatch` | **FAILED** | Swift tied the watcher to the view and stopped it in `deinit` (RepoWatcher.swift:32-34; RepoWindowView.swift:50-54). Here, a webview reload, crash or HMR leaves owner-less watchers with no reconciliation. Restoring tabs (phase-04:29) means N recursive watchers at startup, with no policy for background tabs. phase-02:33/57. |
| 6 | `op_id → child` table (Rust) | Should match the operation | **FAILED** | On webview reload, children (fetch, rebase) keep running and may hold `index.lock`, and the new UI can't cancel them. Needs a `reset_session` command on page load that kills everything owned by the previous webview. phase-02:54. |
| 7 | RepoStore per tab (JS) | Per tab | **FAILED** | Swift's value-based `WindowGroup(for: String.self)` brings the existing window forward when the same repo is opened again (NhanhApp.swift:11), and operations are serialized per model "tránh tranh chấp index.lock" (RepoModel.swift:645). The plan has no "repo already open → focus tab" rule, so one repo (or linked worktrees sharing `common_dir`) can get two stores, two operation chains and two watchers, leading to `index.lock` failures. phase-04:29/35. |
| 8 | Git env per spawn (Rust "Env chuẩn") | Per spawn, constant for the session | **FAILED** (fidelity) | Claimed "giữ nguyên như Swift" (phase-02:45), but it drops the `LC_ALL` removal, `GIT_PAGER`/`PAGER=cat`, `GIT_MERGE_AUTOEDIT=no`, the `LANG` default and `DISPLAY`, and changes `LANGUAGE=en` to `C` (GitEnvironment.swift:33-49). An inherited `LC_ALL` overrides `LC_MESSAGES` and git ships a Vietnamese translation, so 7 recovery sites (15 substring checks) in RepoModel+Actions.swift (:177/:323/:404/:594/:600/:712/:765) and 5 checks in GitRepository.swift:72-73/:121-122 stop matching. `THAIGIT_ASKPASS_*` reaching hooks is acceptable but should be documented. |
| 9 | In-memory IP rate limiter (server) | Process lifetime; resets on every deploy (phase-07:88) | **FAILED** (keying) | The lifetime is acceptable; the key is wrong. Behind Caddy or nginx it is the proxy's IP (Finding 4). phase-07:82/87. |
| 10 | Quota and budget day buckets (SQLite) | Per day | PASS with note | The timezone of "day" isn't defined (a UTC reset happens at 07:00 ICT), but `/v1/ai/quota` returns a "giờ reset". Pick one definition. phase-07:38/69. |

**Scope audit result: FAILED** — 7 of 10 items fail (rows 1, 3, 5, 6, 7, 8, 9).

---

## Checked, not raised (calibration)
- **Apple git version:** `--pathspec-from-file`, `switch` and `restore` are fine; local `/usr/bin/git` is 2.54.0 (Apple Git-157), well above the ≥2.35 floor.
- **Updater custom headers:** supported in JS (`check({ headers })`) and in Rust (`.header()`), so the opt-in `X-Install-Id` header is technically feasible (subject to Finding 3).
- **HTML5 DnD on Windows:** the `dragDropEnabled` claim is accurate, and the pointer-events approach is sound.

## Unresolved Questions
1. With the owner's API key, does Nous's authenticated `GET /v1/models` list any Hermes model today? If not, is OpenRouter's `nousresearch/hermes-4-405b` at $1/$3 acceptable under the "Hermes key" decision?
2. Is Privacy Mode available on the Nous plan the owner will buy, and does it cover models routed through the OpenRouter catalog?
3. VPS reverse proxy: Caddy in compose, or an existing nginx? The answer decides the client-IP and SSE-buffering fixes in Finding 4.

## Sources
- [Nous Portal privacy policy](https://portal.nousresearch.com/privacy)
- [Nous Portal guide (openclawlaunch)](https://openclawlaunch.com/guides/nous-portal)
- [llmreference — Nous Portal](https://www.llmreference.com/provider/nous-portal)
- Live: `https://inference-api.nousresearch.com/v1/models`, `…/v1/chat/completions`; `https://openrouter.ai/api/v1/models` (probed 2026-10-02)
- [Tauri updater plugin](https://v2.tauri.app/plugin/updater/)
- [Tauri macOS signing](https://v2.tauri.app/distribute/sign/macos/)
- [Tauri sidecar](https://v2.tauri.app/develop/sidecar/)
- [Tauri WebDriver testing](https://v2.tauri.app/develop/tests/webdriver/)
- [Tauri channel.rs (dev)](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri/src/ipc/channel.rs)
- [Tauri api core.ts (dev)](https://github.com/tauri-apps/tauri/blob/dev/packages/api/src/core.ts)
- [trash crate docs](https://docs.rs/trash/latest/trash/)
- [trash-rs macOS source](https://github.com/Byron/trash-rs/blob/master/src/macos/mod.rs)
- [Ad-hoc signing fixes the "damaged" error (example PR)](https://github.com/jaysonwu991/oxide/pull/63)
- [Microsoft Learn — Artifact Signing quickstart](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart)
- [Microsoft Q&A — individual identity country availability](https://learn.microsoft.com/en-nz/answers/questions/5810735/cant-create-a-new-trusted-signing-individual-ident)
