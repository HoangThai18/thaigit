---
phase: 6
title: "AI Commit Features (Hermes)"
status: pending
priority: P1
effort: "4-5 ngày (client)"
dependencies: [5, 7]
---

# Phase 6: AI Commit Features (Hermes)

## Overview
AI kiểu GitKraken: **viết commit message** từ thay đổi đã stage (chính), **giải thích commit**, **mô tả PR** *(mở rộng)*. App gọi API Thaigit (phase 7a); API chuyển cho **Hermes tự host trên VPS của chủ dự án** — không bên thứ ba, người dùng không cần key. Hộp thoại đồng ý trước lần dùng đầu. Thuộc mốc **M2** (sau spike S1 + 7a).

## Context Links
- Phase 7: `/v1/ai/install`, `/v1/ai/quota`, `/v1/ai/*`, hợp đồng trong `packages/contracts`
- [Research Hermes + backend](./research/researcher-02-hermes-ai-backend-report.md) (prompt mẫu còn dùng được; phần Nous Portal/giá đã lỗi thời) · [Red team](./plan.md#red-team-review): SA4/AD3, SA5/AD2, SC8, AD1

## Key Insights
- Năng lực thật (context, tốc độ, số luồng) do máy chủ Hermes quyết định → client đọc `maxInputTokens` từ `/v1/ai/quota` để đặt ngân sách diff (mặc định ≈ 6k token; server tự cắt thêm).
- Prompt nằm ở server (có version) → chỉnh prompt không cần phát bản app. App chỉ gửi ngữ cảnh đã đóng gói.
- Học giọng văn từ 10 subject gần nhất (chỉ subject, không code).
- Stream SSE: chữ hiện dần; Huỷ = AbortController. Khi chờ hàng đợi server gửi frame `queued` → hiện "Đang chờ máy chủ AI (vị trí n)".
- Server không sửa được chữ đã stream → client hoàn thiện sau `done`: bỏ code fence, tách tóm tắt (≤ 72 ký tự) và mô tả.

## Requirements
- Composer: nút "✨ Viết bằng AI" (⌘/Ctrl+Shift+G); chưa stage gì → hỏi "Dùng tất cả thay đổi?"; stream vào ô tóm tắt + mô tả; Huỷ, Tạo lại; tuỳ chọn ngôn ngữ (Tự động/Tiếng Việt/English), Conventional Commits, độ dài; hoàn tác về nội dung trước khi AI ghi.
- Chi tiết commit: "Giải thích" → panel markdown (tóm tắt, thay đổi chính, rủi ro).
- Menu nhánh: "Viết mô tả PR với AI" → so với nhánh gốc → dialog markdown + Copy *(mở rộng)*.
- **Đồng ý AI** (lần đầu, trước mọi request): nói rõ gửi gì (diff đã lọc + đã quét bí mật; với Giải thích/PR là diff của commit/nhánh được chọn; 10 subject gần nhất), gửi đi đâu ("máy chủ Thaigit do chủ dự án vận hành tại <vị trí VPS>; model Hermes chạy ngay trên máy chủ đó — **không gửi cho bên thứ ba, không lưu nội dung**; chỉ lưu số liệu kỹ thuật (số token, thời gian, mã lỗi) 30 ngày"); nút "Xem dữ liệu sẽ gửi"; tick "Không hỏi lại". Cài đặt: bật/tắt AI; tắt AI cho repo hiện tại *(mở rộng)*.
- **Danh tính AI**: chỉ sau khi đồng ý mới tạo `aiInstallId` (UUID ngẫu nhiên) → `POST /v1/ai/install` → token; lưu plugin-store; tắt AI → xoá id + token. Hoàn toàn tách khỏi `telemetryId` (phase 8b). Header: `X-AI-Install-Id`, `X-AI-Token`, `X-App-Version`.
- Hiện lượt còn lại hôm nay; lỗi theo `code` (contracts): `quota_exhausted` (hết lượt, reset 0:00 giờ VN), `ip_rate_limited` / `ai_busy` (bận, thử lại sau n giây theo `Retry-After`), `ai_unavailable` (máy chủ AI tạm ngừng), `ai_disabled` (AI đang tắt), `too_large` (diff quá lớn), mất mạng. App vẫn dùng bình thường.
- *(stretch, 1.x)* BYOK endpoint OpenAI-compatible (vd. Ollama trên máy người dùng): key trong keychain OS (crate `keyring`), gọi từ Rust để scope HTTP của webview vẫn chỉ 1 domain.
- Non-functional: thời gian tới chữ đầu (TTFT, không tính chờ hàng đợi) p50 ≤ ngưỡng chốt sau spike S1 (mục tiêu ≤ 3 s với diff ≈ 2k token); không bao giờ gửi file/đoạn bị loại; không lộ cấu hình server.

## Architecture
```
CommitComposer ──► aiStore.generateCommitMessage()
  core/ai/context-builder.ts: staged diff (bytes → UTF-8, bỏ file không decode được) → lọc theo tên → quét bí mật nội dung
     → {files[{path,status,+/-,hunks}], skipped[{path,reason}], redactions[{path,rule}], stats, branch, recentSubjects[10], options}
  core/ai/sse.ts: frame queued / delta / done{usage} / error{code}
  fetch POST https://<domain>/v1/ai/commit-message (X-AI-Install-Id, X-AI-Token, X-App-Version) → stream → core/ai/finalize.ts
Server (7a): token → quota → hàng đợi năng lực → prompt (templates v1) → Hermes nội bộ (stream) → chuyển tiếp SSE
```
- Lọc theo tên: lockfile (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `Cargo.lock`, `Podfile.lock`…), minified/bundle (`*.min.*`, `dist/`, `build/`), nhị phân, `linguist-generated`, `vendor/`, `node_modules/`; nhạy cảm: `.env*`, `*.pem`, `*.key`, `id_rsa*`, `id_ed25519*`, `id_ecdsa*`, `*.p12`, `*.pfx`, `*.jks`, `*.keystore`, `.npmrc`, `.pypirc`, `.netrc`, `.git-credentials`, `credentials*.json`, `*.tfvars`, `*.tfstate*`, `kubeconfig`, `appsettings*.json`.
- Quét nội dung (kiểu gitleaks, ≈ 20 regex tín hiệu cao + entropy): khoá AWS (`AKIA…`), `ghp_`/`github_pat_`, `glpat-`, `xox[bpas]-`, `sk-…`, `AIza…`, `-----BEGIN … PRIVATE KEY-----`, JWT, chuỗi entropy cao gán cho biến tên `*secret*|*token*|*password*|*key*` → bỏ hunk, báo "Đã bỏ n đoạn có thể chứa bí mật".
- Mỗi file ≤ ≈ 2k token, ưu tiên hunk nhiều dòng đổi; phần cắt vẫn báo "path +a −d (đã rút gọn)".

## Related Code Files
- Create: `packages/core/src/ai/{context-builder.ts,secret-scan.ts,token-estimate.ts,sse.ts,finalize.ts}` + test; schema dùng chung `packages/contracts/src/ai.ts`
- Create: `apps/desktop/src/lib/ai/{aiStore.svelte.ts,AiButton.svelte,AiOptions.svelte,ConsentDialog.svelte,PayloadPreview.svelte,ExplainPanel.svelte,PrDescriptionDialog.svelte}`
- Modify: `lib/staging/CommitComposer.svelte`, `lib/inspector/CommitDetail.svelte`, menu nhánh (`lib/sidebar`, `lib/graph`), Settings; CSP `connect-src` thêm domain API; capabilities (nếu dùng tauri-plugin-http thì scope đúng 1 domain)

## Implementation Steps
1. `context-builder.ts` + `secret-scan.ts` + test: payload không bao giờ chứa file/đoạn bị loại; giữ Unicode/CRLF; thống kê phần bỏ; ngân sách token (ký tự / 3,5, hệ số riêng cho tiếng Việt).
2. `sse.ts` + `finalize.ts` + test (frame cắt giữa chừng, nhiều dòng `data:`, `queued`, lỗi; bỏ fence, tách tóm tắt ≤ 72).
3. Consent + xem trước payload + tạo `aiInstallId` lười + đăng ký; token hỏng → đăng ký lại (backoff, tối đa 3 lần/ngày).
4. AiButton trong composer: stream, Huỷ, Tạo lại, tuỳ chọn, hoàn tác.
5. Quota + map lỗi theo `code`.
6. Giải thích commit + mô tả PR *(mở rộng)*: render markdown bằng allow-list (không HTML thô, không ảnh, link hiện dạng text, mở qua xác nhận + `open_url`); prompt server dặn bỏ qua mọi chỉ dẫn nằm trong diff.
7. Test với server giả (Hono local trả SSE chậm/lỗi) + 1 kịch bản E2E.
8. Chọn cách gọi HTTP: `fetch` từ webview (server cho phép origin `tauri://localhost`, `http(s)://tauri.localhost`) hay tauri-plugin-http (scope 1 domain) — thử stream SSE trên 2 OS rồi chốt.

## Todo List
- [ ] Context builder + quét bí mật + test
- [ ] SSE parser + finalize + test
- [ ] Consent + xem trước payload + `aiInstallId` lười
- [ ] Nút AI trong composer (stream, huỷ, tạo lại, tuỳ chọn)
- [ ] Quota + lỗi theo `code`
- [ ] Giải thích commit / mô tả PR (mở rộng)
- [ ] Test với server giả + chọn cách gọi HTTP

## Success Criteria
- [ ] Trên repo thật: message hợp lý (đúng loại thay đổi, dòng đầu ≤ 72 ký tự); TTFT đạt ngưỡng S1
- [ ] Test payload: `.env`, `id_ed25519`, `.npmrc`, lockfile, ảnh, và chuỗi `AKIA…`/`ghp_…` trong file `.ts` thường **không** xuất hiện
- [ ] Chưa đồng ý AI → không có request nào tới `/v1/ai/*` và không tồn tại `aiInstallId`
- [ ] Hết lượt / bận / AI tắt / model ngừng → thông báo đúng theo `code`; app vẫn dùng bình thường

## Risk Assessment
- Model trả lời lan man/sai định dạng → system prompt ép format + client finalize; thử prompt trên ≈ 30 diff mẫu với đúng model của chủ dự án.
- Model self-host chậm (CPU) → TTFT cao: hàng đợi + frame `queued`, giảm `maxInputTokens`, không gửi diff lớn mặc định.
- Lộ bí mật của người dùng → lọc tên + quét nội dung + xem trước + đồng ý; server không log nội dung.
- Prompt injection từ commit lạ → output chỉ là text/markdown allow-list, không bao giờ thành lệnh hay HTML.
- Rollback: tắt AI toàn hệ thống bằng kill switch server (`AI_KILL_SWITCH_FILE`) hoặc tắt trong Cài đặt app.

## Security Considerations
- Token AI chỉ để gắn quota, không cấp quyền gì khác.
- Không lưu diff ngoài bộ nhớ; không log payload ở client.
- Kết quả AI hiển thị text/markdown allow-list (không `{@html}`).

## Next Steps
- Sau GA: đo tỉ lệ giữ nguyên/sửa message AI (chỉ đếm, chỉ khi đã opt-in thống kê) để chỉnh prompt.
