---
phase: 6
title: "AI Commit Features (Hermes)"
status: pending
priority: P1
effort: "3-4 ngày (client)"
dependencies: [3, 5, 7]
---

# Phase 6: AI Commit Features (Hermes)

## Overview
Thêm AI kiểu GitKraken vào app: **viết commit message** từ thay đổi đã stage (chính), **giải thích commit**, **viết mô tả PR/nhánh** *(mở rộng)*. App gọi server Thaigit (phase 7); server giữ key và gọi model Hermes 4 của Nous Research. Người dùng không cần cấu hình gì, có hộp thoại đồng ý trước lần dùng đầu tiên.

## Context Links
- [Hermes + backend research](./research/researcher-02-hermes-ai-backend-report.md) (prompt mẫu, giới hạn, quyền riêng tư)
- Phase 7: endpoint `/v1/ai/*`, `/v1/install`, `/v1/ai/quota`

## Key Insights
- Hermes 4 (70B/405B) có context 128k → gửi được diff khá lớn, nhưng **chi phí và độ trễ** mới là giới hạn thật. Ngân sách mặc định khoảng 12k token cho diff, cắt thông minh.
- Prompt nằm **ở server** (có version), nên chỉnh prompt không cần phát bản app mới. App chỉ gửi "ngữ cảnh" đã đóng gói.
- Học giọng văn từ 10 commit gần nhất của repo (chỉ gửi subject, không gửi code) để message hợp phong cách repo (tiếng Việt/Anh, có Conventional Commits hay không).
- Stream (SSE) để chữ hiện dần, bấm Huỷ là dừng ngay (AbortController), đỡ cảm giác chờ.

## Requirements
- Functional
  - Composer: nút "✨ Viết bằng AI" (phím tắt ⌘/Ctrl+Shift+G). Chưa stage gì thì hỏi "Dùng tất cả thay đổi?". Chữ stream vào ô tóm tắt + mô tả; có nút Huỷ, Tạo lại, và menu tuỳ chọn: ngôn ngữ (Tự động/Tiếng Việt/English), Conventional Commits (bật/tắt), độ dài (ngắn/chi tiết).
  - Chi tiết commit: nút "Giải thích" → panel markdown (tóm tắt, thay đổi chính, rủi ro).
  - Menu nhánh: "Viết mô tả PR với AI" → so với nhánh gốc (upstream hoặc nhánh mặc định) → dialog markdown + nút Copy *(mở rộng)*.
  - Đồng ý: lần đầu hiện modal nói rõ gửi gì (diff đã lọc), gửi tới đâu (server Thaigit → Nous Research), không lưu nội dung; có tick "Không hỏi lại". Cài đặt: bật/tắt AI; tắt AI cho repo hiện tại *(mở rộng)*.
  - Hiển thị lượt còn lại hôm nay; lỗi rõ ràng bằng tiếng Việt: hết lượt (429), server tạm dừng vì chạm trần chi phí (503), diff quá lớn (413), mất mạng.
  - Danh tính cài đặt: lần chạy đầu tạo UUID → `POST /v1/install` nhận token ký HMAC → lưu bằng tauri-plugin-store.
  - *(stretch)* BYOK: nhập endpoint chuẩn OpenAI (Ollama, Hermes Agent tự host, OpenRouter) để gọi thẳng, không qua server và không bị giới hạn lượt.
- Non-functional: chữ đầu tiên hiện dưới 2 s (p50); không bao giờ gửi file nằm trong danh sách loại trừ; cấu hình không lộ key server.

## Architecture
```
CommitComposer ──► aiStore.generateCommitMessage()
   core/ai/context-builder.ts: staged diff → {files[{path,status,+/-,hunks(trimmed)}], skipped[{path,reason}], stats, branch, recentSubjects[10], options}
   core/ai/sse.ts: parse "data:" frames (delta/usage/error/done)
   fetch(POST https://<domain>/v1/ai/commit-message, headers: X-Install-Id, X-Install-Token, X-App-Version) → stream → điền vào composer
Server (phase 7): kiểm token/quota/budget → dựng prompt (templates/v1) → Nous Portal chat.completions(stream) → chuyển tiếp SSE
```
Luật lọc (context builder): bỏ lockfile (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `Cargo.lock`, `Podfile.lock`…), file minified/bundle (`*.min.*`, `dist/`, `build/`), nhị phân, `linguist-generated` trong `.gitattributes`, `vendor/`, `node_modules/`, file nhạy cảm (`.env*`, `*.pem`, `*.key`, `id_rsa*`, `*.p12`). Mỗi file tối đa khoảng 2k token, ưu tiên hunk có nhiều dòng đổi; phần bị cắt vẫn báo "path +a −d (đã rút gọn)".

## Related Code Files
- Create: `packages/core/src/ai/{context-builder.ts,token-estimate.ts,sse.ts,types.ts}` + test tương ứng
- Create: `apps/desktop/src/lib/ai/{aiStore.svelte.ts,AiButton.svelte,AiOptions.svelte,ConsentDialog.svelte,ExplainPanel.svelte,PrDescriptionDialog.svelte}`
- Modify: `lib/staging/CommitComposer.svelte`, `lib/inspector/CommitDetail.svelte`, menu nhánh trong `lib/sidebar` + `lib/graph`, `Settings`
- Modify: `apps/desktop/src-tauri/capabilities/*.json` (cho phép HTTP tới domain API; nếu dùng tauri-plugin-http thì giới hạn scope đúng domain)

## Implementation Steps
1. `context-builder.ts` + test: lọc, ngân sách token (ước lượng: số ký tự / 3,5, có hệ số riêng cho tiếng Việt), rút gọn hunk, giữ nguyên CRLF/Unicode, có thống kê file bị bỏ.
2. `sse.ts` + test (frame bị cắt giữa chừng, nhiều dòng `data:`, `[DONE]`, frame lỗi).
3. Đăng ký cài đặt + lưu token; xử lý token hỏng → đăng ký lại.
4. AiButton trong composer: stream vào trường, Huỷ/Tạo lại, tuỳ chọn; hoàn tác về nội dung trước khi AI ghi đè.
5. Consent dialog + cài đặt bật/tắt; hiện quota.
6. Explain commit + PR description *(mở rộng)*.
7. Test UI với server giả (MSW hoặc Hono chạy cục bộ trả SSE).
8. Kiểm tra CORS: webview gọi API (`tauri://localhost` trên macOS, `http(s)://tauri.localhost` trên Windows). Hoặc cho phép đúng các origin đó ở server, hoặc dùng tauri-plugin-http (request đi từ Rust, không dính CORS). Chọn sau khi thử stream SSE trên cả 2 OS.

## Todo List
- [ ] Context builder + test
- [ ] SSE parser + test
- [ ] Install registration
- [ ] Nút AI trong composer (stream, huỷ, tạo lại, tuỳ chọn)
- [ ] Consent + quota + lỗi
- [ ] Explain commit / PR description (stretch)
- [ ] Test UI với server giả, chọn cách gọi HTTP

## Success Criteria
- [ ] Trên repo thật, bấm AI → message hợp lý (đúng loại thay đổi, ≤ 72 ký tự dòng đầu), chữ đầu tiên hiện dưới 2 s
- [ ] `.env`, lockfile, ảnh không bao giờ xuất hiện trong payload (test kiểm payload)
- [ ] Hết lượt / server chạm trần → thông báo rõ, app vẫn dùng bình thường

## Risk Assessment
- Model trả lời lan man/sai định dạng → server ép format (system prompt + hậu xử lý: bỏ ```, cắt dòng đầu ≤ 72). Thử prompt trên khoảng 30 diff mẫu trước khi phát hành.
- Lộ code nhạy cảm của người dùng → lọc phía client, có đồng ý, server không log nội dung, công bố chính sách rõ ràng.
- Lạm dụng quota (giả UUID) → xử lý ở server (phase 7).

## Security Considerations
- Token cài đặt không phải bí mật tuyệt đối (lấy được từ máy) → chỉ dùng để gắn quota, không cấp quyền gì khác.
- Không lưu diff ở client ngoài bộ nhớ; không ghi log payload.
- Hiển thị kết quả AI dạng text/markdown đã sanitize (không chạy HTML).

## Next Steps
- Sau phát hành: đo tỉ lệ người dùng giữ nguyên/sửa message AI (chỉ đếm, không gửi nội dung) để chỉnh prompt.
