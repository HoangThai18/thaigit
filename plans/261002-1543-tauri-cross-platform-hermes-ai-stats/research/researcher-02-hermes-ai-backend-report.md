# Nhánh Tauri 2: Hermes AI Backend & Telemetry Research

**Date:** 2026-10-02 | **Researcher:** Claude Haiku 4.5

---

## 1. Hermes AI in 2026: API Options & Pricing

### API Layers

**Nous Portal API (Production Recommended)**
- Supports `https://api.nous.nousresearch.com/v1/chat/completions` (OpenAI-compatible)
- Hermes-4-70B: $0.05/1M input, $0.2/1M output tokens
- Hermes-4-405B: $0.09/1M input, $0.37/1M output tokens
- Rate limits by tier:
  - Free: 45 RPM, 450k TPM (no credit)
  - Plus ($20/mo): 400 RPM, 4M TPM + $22 credits
  - Super ($100/mo): 800 RPM, 8M TPM + $110 credits
  - Ultra ($200/mo): 1,600 RPM, 16M TPM + $220 credits
- **Best for:** Production proxy (owner pays once, users free)

**Hermes Agent Framework (Feb 2026+)**
- Wraps any OpenAI-compatible provider; includes Nous Portal integration
- v0.4.0+ exposes `/v1/chat/completions` endpoint for client routing
- No agent-specific benefit for simple "diff → commit message" task
- **Not recommended:** Adds agent orchestration overhead you don't need

**Self-Hosting Local Inference**
- Hermes Agent framework only: 1 GB RAM, 1 vCPU; 2-4 GB recommended
- Local inference server (Ollama/LM Studio) with Hermes-70B model:
  - Requires: 40-48+ GB RAM, 8+ cores, **GPU strongly recommended** (5-20x faster)
  - CPU-only: 0.5-3 tokens/sec (unusable for real-time)
- **Verdict:** Not viable for typical VPS; self-hosting kills the "free for users" model

### Recommendation

**Use Nous Portal API directly.** Owner buys Ultra tier ($200/mo = $2,400/yr + overage buffer) to get 800 RPM, 8M TPM. For simple commit-message tasks (avg ~200-400 tokens/request at <25°C temp), this allows ~20K free user requests/month before overage. Proxy enforces per-install daily quotas (e.g., 10 requests/day = 200K requests/month within budget).

---

## 2. Commit Message Generation: Prompt Design & Best Practices

### Existing Tools' Approaches

- **aicommits** (GitHub): Custom prompts, supports multiple LLM providers, {changes} placeholder for diff
- **OpenCommit**: Enforces Conventional Commits format, provider-agnostic (OpenAI/Anthropic/Ollama/others)
- **GitKraken AI**: Closed-source; likely uses similar diff→summary→conventional commit pipeline

### Recommended Prompt Strategy

**System Prompt:**
```
You are an expert git commit message writer using Conventional Commits.
Format: <type>(<scope>): <subject>
- Subject: ≤72 chars, imperative mood, no period
- Type: feat|fix|refactor|docs|test|chore
- Scope: optional, module/feature name
- Body: wrap at 72 chars, explain "why", not "what" (user sees diff already)
- Trailer: closes #123, Co-Authored-By: etc. (optional)
Use Vietnamese in subject if code is Vietnamese.
```

**Prompt Template:**
```
Given this diff, write 1 commit message in Conventional Commits format.
Return **only** the message, no markdown, no explanation.

DIFF:
{DIFF_CONTENT}

INSTRUCTIONS:
- Max subject line: 72 chars
- English unless codebase is primarily Vietnamese
- Analyze what changed and why, not how
- If diff is >2000 tokens, summarize: list file changes + top 2-3 hunks
```

### Handling Large Diffs

**Token Budget:** At 70B model (~4k context), allocate 1k for prompt, leave 2k for output; max diff = 1k tokens
- Per-file summaries: detect file type; skip: `*.lock`, `*.min.js`, generated code, binaries
- Top hunks strategy: Keep hunks with semantic changes (ignore formatting, imports)
- Fallback for >1k tokens: "Multiple files changed" + file list, conservative summary

### Temperature & Parameters

- Temperature: 0.3-0.5 (deterministic, consistent tone)
- Max tokens: 150 (one message, no alternatives)
- No streaming (single call, simpler for proxy)

### Expanding to "Explain Commit" & PR Description

**Explain Commit:**
```
System: You are a git historian. Given a commit message and diff, 
explain the change in 2-3 bullets for code review.
```

**PR Description:**
```
System: You are a PR summarizer. Given multiple commits from a branch 
and their diffs, write a PR description: Summary, Changes, and Testing notes.
Keep <500 words.
```

---

## 3. Proxy Design on VPS: Architecture & Safety

### Request Flow

```
[Tauri App] 
  → POST /api/ai/commit-message (signed install-id, diff, language)
  → [Proxy: validate, dedup, rate-limit, stream to SSE]
    → Nous Portal (/v1/chat/completions)
    → [Log request + redact code before storage]
  → Stream response back to app
```

### Rate Limiting (Multi-Layer)

**Per-Install Quotas:**
- Install-id (random UUID, server-signed on first launch; spoofable but good enough)
- Daily limit: 10 requests/day/install (200 requests/mo)
- Window: 24h rolling
- Storage: SQLite `install_quotas` table (install_id, date, count)

**Per-IP Abuse Prevention:**
- IP-level hard rate limit: 100 req/min (catch hammering)
- Token-per-second ceiling: global Nous Portal 8M TPM ≈ 13.3k tokens/sec; proxy limit to 10k tokens/sec to leave 25% headroom

**Global Kill-Switch:**
- Daily token budget: start with 6M tokens/day (Nous $220 credits ≈ 10.8M tokens/day at mid pricing)
- If exceeded before daily reset, deny all requests with 429 Retry-After

### Proxy Stack (Recommended)

**Framework:** Node.js + Hono
- Small footprint (~14KB), TypeScript-native, edge-friendly if migrating later
- Single-file or 3-file structure (routes, db, utils) for team coherence

**Database:** SQLite (better-sqlite3)
- Lightweight for small scale (download counts, install quotas, daily budgets)
- Tables: `installs` (id, created_at, last_seen), `install_quotas` (install_id, date, count), `downloads` (platform, version, os, created_at), `telemetry_events` (type, install_id_hash, metadata, created_at)
- Backups: daily cron to S3 / GitHub repo (encrypted)

**Server:** Caddy + Docker Compose
- Auto HTTPS, reverse proxy to Node app on localhost:3000
- Compose stack: `proxy` (Node), `caddy`, optional `postgres` for future scaling

**Deployment:** VPS (AWS t2.micro or Linode $5 plan)
- 1 GB RAM sufficient for Hono + SQLite
- 10 GB disk (logs, backups)

### Request Size & Privacy

**Diff Size Limits:**
- Max diff payload: 256 KB (prevents accidental buffer exhaustion)
- Streaming for long diffs (≤16 requests/sec per install to prevent stalling)

**Privacy/Logging:**
- **Never store** raw code/diffs in logs or database
- Log only: install_id_hash (SHA256), tokens_used, status_code, timestamp
- Redact: diff content before any non-transient storage
- Retention: 30 days for debugging, then purge

### Install Identification (Spoofing Mitigations)

Problem: UUID is client-generated and spoofable; user can bypass quotas.

Mitigations (realistic without auth):
1. **Server-signed install token** (HMAC): On first launch, app sends UUID; server returns HMAC(secret, UUID). App must send both UUID + token in future requests. Trivially broken with local binary inspection, but prevents naive reuse.
2. **Machine fingerprint** (fallback): Hash of hostname + OS + CPU model (rough, can vary after system reboot, but adds friction).
3. **Accept spoofing, embrace quotas:** Ship with per-install daily limit that's generous enough (10 req/day) that abuse cost ≈ spam. Most users won't bother.

**Recommended:** Combine server-signed token + honest logging ("this will rate-limit you; turn off AI to save quota"). No crypto-grade security needed.

---

## 4. Download Counting & Tauri Updater Integration

### Download Endpoint

**Redirect Pattern:**
```
GET /download/:platform/:version
→ Record (platform, version, user_os, timestamp) in `downloads` table
→ 302 Redirect to GitHub Release asset URL (or S3 mirror)
```

**Why redirect:** Saves VPS bandwidth, GitHub CDN is fast, auto-scales
**Fallback:** If GitHub asset missing, serve from VPS `/releases/:name` (slower, use sparingly)

### Tauri Updater Manifest

**Endpoint:** `/api/updater?version={{current_version}}&target={{target}}&arch={{arch}}`

**Response (200 OK, JSON):**
```json
{
  "version": "1.2.3",
  "notes": "Fixed crash on exit. Added dark mode toggle.",
  "pub_date": "2026-10-02T12:00:00Z",
  "platforms": {
    "darwin-aarch64": {
      "signature": "... minisign Ed25519 signature ...",
      "url": "https://vps.domain/releases/nhanh-1.2.3-aarch64.app.tar.gz"
    },
    "windows-x86_64": {
      "signature": "...",
      "url": "https://vps.domain/releases/nhanh-1.2.3-x64.msi"
    }
  }
}
```

**204 No Content:** Return 204 if version matches current (no update available) — Tauri convention.

**Signature:** Tauri updater uses Minisign (Ed25519). Sign with:
```bash
signjson -k release-key.key update-manifest.json
# Copy public key to tauri.conf.json pubkey field
```

### Active Install Counting (DAU/MAU)

**Privacy-Preserving Approach:**
- On app launch, send: `POST /telemetry` with `{install_id_hash, app_version, os, timestamp}`
- `install_id_hash` = SHA256(install_id) — cannot reverse to identify user
- Server deduplicates: hash + date = one entry per install per day (simple GROUP BY)
- Expire events: 60 days (DAU/MAU lookback window)

**Query for Dashboard:**
```sql
SELECT 
  DATE(created_at) as day,
  os,
  COUNT(DISTINCT install_id_hash) as active_installs
FROM telemetry_events
WHERE created_at >= NOW() - INTERVAL '60 days'
GROUP BY day, os;
```

---

## 5. Admin Dashboard: Stack & Layout

### Security Model

Single admin account; no user management overhead.

**Options:**
- Basic auth (username:password in HTTP header, over HTTPS only)
- Cloudflare Access (if using Cloudflare DNS) — zero-trust, one-click setup
- **Recommended for VPS:** Basic auth + rate-limit login attempts (max 5/min per IP)

### Frontend Stack

**Charts:** Chart.js or uPlot
- Chart.js: larger ecosystem, Hono can serve static + endpoint
- uPlot: 10KB, simpler for sparklines (good if minimal)

**Layout:**
- 3-column layout: sidebar (nav) + main chart area + detail cards
- Sections: Downloads (platform × version + trend), Active Installs (DAU/MAU by OS), API usage (tokens/day, top installs by quota usage), System health (last sync time, error rate)

### Backend Route

```
GET /admin/dashboard → server-render HTML + fetch JSON via <script>
GET /api/admin/stats → JSON {downloads_7d, dau_7d, tokens_used, ...}
POST /admin/logout → clear session
```

**Static Files:** Caddy serves `/admin/static/` (chart.js, CSS, minimal JS)

---

## 6. Legal & Privacy: PDPD, Consent & Mitigations

### Vietnam PDPD (Decree 13/2023)

**Key Rule:** **Consent-first** (no legitimate-interests basis like GDPR)
- Explicit, affirmative consent required for all data processing
- Silence = no consent
- Consent is purpose-specific; cannot be catch-all
- Partial/conditional consent allowed

### Application to Nhánh

**Telemetry (Install Tracking):**
- Requires explicit opt-in checkbox in first-launch setup ("Help improve Nhánh: send anonymous install stats")
- Must disclose: *what* (version, OS), *why* (usage trends), *retention* (60 days), *no personal data*
- Provide opt-out toggle in settings (disabled telemetry stops sending hashes)
- Legal: Privacy Policy section "Telemetry" stating the above

**Code/Diff Sending (AI Features):**
- Requires checkbox at first use: "Send code to Nous Research Hermes API for commit message generation"
- Disclose: *what* (staged diff), *where* (Nous Portal server), *retention* (logs redacted, not stored), *privacy* (your code is never logged)
- No generic "agree to ToS" catch-all; explicit per-feature consent

### Practical Privacy Mitigations

1. **No code in logs:** Redact before any write (including stdout for reverse-engineering)
2. **No user tracking:** Never store install_id in readable form; use hashed version only for dedup
3. **Retention limits:** Delete telemetry after 60d, logs after 30d (set cron job)
4. **Transparency:** In-app settings show: "You've used X/10 requests today," "Telemetry on/off" toggle
5. **Opt-out:** Checkbox for telemetry, separate opt-out for AI features (both off by default in initial build)

---

## Recommendations

### Concrete Starting Defaults

| Component | Choice | Rationale |
|-----------|--------|-----------|
| **Hermes API** | Nous Portal (Ultra $200/mo) | Fixed cost, owner-controlled, frees users |
| **Proxy Framework** | Hono (Node.js) | Small, TypeScript, streaming-ready |
| **Database** | SQLite (better-sqlite3) | Single file, no sysadmin, scales to millions of rows |
| **Per-Install Quota** | 10 req/day | ~3,000 requests/mo/1000 installs = 0.6M tokens ≈ $30 in Hermes costs |
| **Global Budget** | 5M tokens/day | Burn $240/mo, 20% headroom on $200 Nous credits |
| **Diff Size Limit** | 256 KB | Catches accidental large files, fits in Tauri payload |
| **Rate Limit (IP)** | 100 req/min | Prevent hammering; streaming request = 1 req |
| **Telemetry Retention** | 60 days | Enough for weekly/monthly trend charts, privacy-conscious |
| **Log Retention** | 30 days | Debugging support, then purge (compliance) |
| **Admin Auth** | Basic auth + Cloudflare Access | No OAuth complexity; if VPS only, basic auth + rate-limit logins |

### Endpoint Summary

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/ai/commit-message` | POST | install-id + HMAC | Diff → commit message (stream SSE) |
| `/api/ai/explain-commit` | POST | install-id + HMAC | Commit hash → explanation |
| `/api/ai/pr-description` | POST | install-id + HMAC | Branch diffs → PR body |
| `/download/:platform/:version` | GET | none | Count + redirect to GH Release |
| `/api/updater` | GET | none | Tauri manifest + active install count |
| `/telemetry` | POST | none | Record install + version on launch |
| `/api/admin/stats` | GET | basic auth | Dashboard data (JSON) |
| `/admin/dashboard` | GET | basic auth | Dashboard HTML |

### Initial Data Schema (SQLite)

```sql
-- Install tracking (spoofing tolerated)
CREATE TABLE installs (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMP,
  last_seen TIMESTAMP
);

-- Per-install daily quota (rolling window)
CREATE TABLE install_quotas (
  install_id TEXT,
  date DATE,
  count INTEGER DEFAULT 0,
  PRIMARY KEY (install_id, date)
);

-- Download counting
CREATE TABLE downloads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT,
  version TEXT,
  os TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Telemetry for DAU/MAU
CREATE TABLE telemetry_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  install_id_hash TEXT,
  app_version TEXT,
  os TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- API usage (for budget tracking)
CREATE TABLE api_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  install_id TEXT,
  tokens_used INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|------------|-----------|
| **Quota bypass (spoofed install-id)** | High | Server-signed token + honest logging; accept abuse cost ≈ spam |
| **DDoS on `/api/ai/*`** | Medium | IP rate-limit + Cloudflare DDoS protection (optional paid) |
| **Nous Portal account banned** | Low | Owner monitors budget; set global token ceiling + daily budget kill-switch |
| **Leaking user code** | Medium | Strict "no code in logs" rule; code review telemetry writing; optional audit trail |
| **Updater signature key loss** | High | Backup TAURI_SIGNING_PRIVATE_KEY in KMS/encrypted vault; rotate yearly |
| **PDPD non-compliance (consent)** | Medium | Explicit checkboxes first-launch; privacy policy; opt-out toggle; no catch-all ToS |
| **SQLite disk full** | Low | Monitor disk; set log rotation (30d purge); daily backup alerts |

---

## Unresolved Questions

1. **Host on existing VPS or separate?** Scope: does Nhánh team have existing VPS infra, or build from scratch? (Not covered: existing VPS detail unknown from context.)
2. **OpenRouter vs Nous Portal?** Both offer Hermes models; OpenRouter adds provider abstraction but costs more. Chose Nous Portal for direct API + owner control.
3. **GitHub OAuth for higher quota?** Nice-to-have; deferred to v2 (adds complexity, UX friction).
4. **Database: Postgres for future scaling?** Not recommended for MVP; SQLite sufficient for year 1 (millions of rows). Migrate if >100 requests/sec needed.

---

## Sources

**Hermes API & Pricing:**
- [Nous Research Hermes Agent Documentation](https://hermes-agent.nousresearch.com/docs/)
- [Nous Portal API Pricing 2026](https://www.llmreference.com/provider/nous-portal)
- [Hermes Agent System Requirements](https://openclawlaunch.com/guides/hermes-agent-system-requirements)
- [Hermes Agent Hardware Requirements](https://shop.zimaspace.com/pages/hermes-agent-hardware-requirements)

**Commit Message Generation:**
- [aicommits GitHub](https://github.com/nutlope/aicommits)
- [OpenCommit NPM](https://www.npmjs.com/package/opencommit)
- [AI Commit Message Generation Guide](https://dev.to/thukhakyawe_cloud/1generate-commit-messages-with-ai-2e2j)

**Tauri Updater:**
- [Tauri Updater Documentation (v2)](https://v2.tauri.app/plugin/updater/)
- [Tauri v2 Auto-Updates Without Maintaining latest.json](https://dev.to/eddie_mate/tauri-v2-auto-updates-without-maintaining-latestjson-14de)
- [Tauri Updater Signature Verification](https://jonaskruckenberg.github.io/tauri-docs-wip/distributing/updater.html)

**Rate Limiting & API Security:**
- [LLM API Rate Limiting & Abuse Prevention](https://www.flowhunt.io/blog/llm-api-security-rate-limiting-auth-abuse-prevention/)
- [Rate Limiting in LLM Gateways](https://www.truefoundry.com/blog/rate-limiting-in-llm-gateway/)

**Backend Stack Comparison:**
- [Hono vs Fastify 2026](https://kanopylabs.com/blog/hono-vs-fastify-backend-frameworks)
- [NestJS vs Fastify vs Hono 2026](https://encore.dev/articles/nestjs-vs-fastify-vs-hono)

**Vietnam Privacy Regulation:**
- [Vietnam Personal Data Protection Decree 13/2023](https://securiti.ai/vietnam-personal-data-protection-decree/)
- [Vietnam PDPD Consent Requirements](https://www.dataguidance.com/news/vietnam-government-publishes-personal-data-protection)
- [Vietnam Decree 13 Compliance Overview](https://fpf.org/blog/vietnams-personal-data-protection-decree-overview-key-takeaways-and-context/)

---

**Report Location:** `plans/261002-1543-tauri-cross-platform-hermes-ai-stats/research/researcher-02-hermes-ai-backend-report.md`
