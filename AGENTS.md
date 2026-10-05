# AGENTS.md

Hướng dẫn cho agent lập trình (Claude Code, Codex, Cursor, Gemini…) làm việc trong repo Thaigit. Code, chuỗi giao diện và commit message viết bằng tiếng Việt như phần còn lại của repo; **chú thích trong code viết bằng tiếng Anh** (repo mở nguồn) — và chỉ chú thích chỗ cần: giải thích *tại sao* / quyết định thiết kế, cảnh báo gotcha, doc public API (`///` cho Rust / Swift), MARK chia mục. Không chú thích lại cái mà tên hàm đã nói, không chú thích từng dòng cho dễ đọc.

## Repo gồm gì

Thaigit là git client có **hai app độc lập, không dùng chung code**:

- **App macOS (Swift, bản 1.x)**: `Package.swift`, `Sources/`, `Tests/`, `Resources/Info.plist`, nhật ký `CHANGELOG.md` ở gốc. Module vẫn mang tên cũ: `Nhanh` (app SwiftUI/AppKit, mặc định chạy trên MainActor) và `NhanhCore` (lõi không phụ thuộc giao diện — logic mới và test đặt ở đây).
- **App đa nền tảng (Tauri 2 + Svelte 5 + TypeScript, bản 2.x, đang phát hành cho Windows)**: `apps/desktop` (Rust ở `src-tauri/`), nhật ký `apps/desktop/CHANGELOG.md`. Dùng `packages/core` (lõi TS, port từ NhanhCore) và `packages/contracts` (hợp đồng TS ↔ Rust).
- `server/`: proxy AI tới Hermes tự host + thống kê (Hono). Node ≥ 24 chạy thẳng file `.ts`, nên chỉ dùng cú pháp TS xoá được (`erasableSyntaxOnly`: không `enum`, `namespace`…). Dựng máy chủ: `docs/deploy-server.md`.
- `site/`: trang chủ git.thaipro.store (Next.js xuất trang tĩnh) — `docs/deploy-site.md`.

Mỗi yêu cầu chỉ làm cho bản app được nhắc tới; không tự port tính năng sang bản kia.

## Lệnh

pnpm workspace, Node 24 (`.nvmrc`), chạy từ gốc repo:

```bash
pnpm install
pnpm check    # tsc / svelte-check --fail-on-warnings ở mọi package — cảnh báo cũng là lỗi
pnpm lint     # ESLint (eslint.config.js ở gốc) cho TS / Svelte / JS — CI chạy
pnpm test     # vitest mọi package; test core/contracts chạy git thật
pnpm format   # prettier — CI KHÔNG kiểm định dạng, tự chạy trước khi commit
pnpm --filter @thaigit/desktop exec vitest run test/staging.test.ts   # một file test
(cd apps/desktop/src-tauri && cargo clippy --all-targets -- -D warnings && cargo test)
```

App Swift — máy chỉ có Command Line Tools (không có Xcode) phải chỉ SDK và plugin của Swift Testing; có Xcode 26 thì `swift test` là đủ (như CI):

```bash
SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.sdk swift test \
  -Xswiftc -plugin-path -Xswiftc /Library/Developer/CommandLineTools/usr/lib/swift/host/plugins/testing
./scripts/build-app.sh --debug   # build/Thaigit.app (script tự chọn SDK)
```

Xem giao diện Tauri trong trình duyệt thường, không mở cửa sổ app — "cầu nối DEV" chỉ-đọc trên một repo thật (`apps/desktop/dev/bridge-plugin.ts`):

```bash
THAIGIT_DEV_REPO=/đường/dẫn/repo THAIGIT_DEV_AUTOOPEN=1 pnpm --filter @thaigit/desktop exec vite --port 1431 --host 127.0.0.1
```

- Đừng dùng `pnpm --filter @thaigit/desktop dev -- --port …`: vite nhận nguyên chữ `--` rồi quay về cổng 1420 của Tauri.
- Puppeteer: chờ `load` rồi chờ `.g-row`; không dùng `networkidle0` (cầu nối giữ long-poll 20 giây ở `/__thaigit_dev/changes`).
- `$effect` không chạy trong vitest (component biên dịch kiểu SSR), nên lỗi vòng lặp của effect phải kiểm trong trình duyệt.

## Quy tắc bắt buộc

- **Chỉ hiện lỗi thân thiện**: giao diện không bao giờ hiện stderr của git, message gốc của Error/exception, mã lỗi hệ điều hành hay stack trace. Mọi lỗi đi qua `apps/desktop/src/lib/errors/friendly.ts` (Tauri) hoặc `Sources/NhanhCore/Support/FriendlyError.swift` (Swift); chi tiết kỹ thuật chỉ ghi vào Nhật ký lệnh git.
- **Chính sách chạy git** `packages/contracts/git-policy.json` là nguồn chung: Rust nhúng bằng `include_str!` (`src-tauri/src/policy.rs`), TS đọc ở `packages/contracts/src/policy.ts`. Đổi chính sách thì thêm ca vào `git-policy.vectors.json` — test TS và test Rust `vectors_match_reference` phải cho kết quả giống hệt. Webview là bên không tin cậy: cờ `-c`, env và bộ kiểm lệnh chỉ nằm ở Rust; frontend chỉ gửi `sub` + `args`.
- Phân loại lệnh đọc / ghi phải xét toàn bộ args, không chỉ `args[0]`: `git remote -v add …` không phải lệnh đọc; `git diff <đường dẫn tuyệt đối> …` là `--no-index` ngầm.
- Repo lạ là không tin cậy: không chạy chương trình do repo tự đặt (`core.fsmonitor`, `diff.*.textconv`, `gpg.program`…).
- Chuỗi lấy từ repo (message, tên nhánh / file, tác giả) chỉ render dạng text. Cấm `{@html}` và mọi cách chèn HTML thô — `apps/desktop/test/no-raw-html.test.ts` chặn cả `innerHTML` & co., không chỉ `{@html}` như ESLint.
- ESLint cố ý tắt `svelte/prefer-svelte-reactivity` (store dùng Map/Set thường, kiểu "chép ra Map mới rồi gán lại") và `no-control-regex` (output git ngăn bằng `\x00` / `\x1f`): đừng đổi sang `SvelteMap` / `SvelteSet` chỉ để chiều linter. Tiền tố `_` đánh dấu biến cố ý không dùng; tắt luật cho một dòng thì kèm chú thích lý do.
- Chuỗi giao diện của app Tauri nằm trong `apps/desktop/src/lib/strings/*.vi.ts` (mỗi tính năng một namespace, gộp ở `strings.vi.ts`); không viết cứng chữ trong component.
- Svelte 5:
  - `{#each}` có key trùng sẽ ném lỗi ngay cả ở bản production và làm hỏng cả lượt cập nhật. Dữ liệu repo **không** duy nhất (sha của stash, parent trùng, dòng config trùng), nên key theo index hoặc selector.
  - `$effect` gọi action của store sẽ lặp vô tận nếu action lỗi mà vẫn để nguyên điều kiện kích hoạt.
  - Phím bấm trong phần tử con của listbox graph nổi bọt lên bộ điều hướng hàng.
- Test không được đụng Keychain thật, cấu hình git của máy hay mạng thật: cô lập git bằng `GIT_CONFIG_NOSYSTEM=1` + `GIT_CONFIG_GLOBAL=/dev/null` (xem `Tests/NhanhCoreTests/TestSupport.swift`), repo thử tạo trong thư mục tạm, kho token dùng bản trong bộ nhớ.
- Định dạng: prettier (`printWidth` 110, nháy đơn); Swift / Rust thụt 4 dấu cách, còn lại 2 (`.editorconfig`). Prettier bỏ qua `Sources/`, `Tests/` và `*.md`.

## Commit, nhật ký thay đổi, phát hành

- Commit thẳng lên `main`. Message tiếng Việt, một dòng, mở đầu bằng khu vực: `App macOS: …`, `App Windows: …`, `Bản đa nền tảng: …`, `Trang chủ: …`, `Admin: …`.
- Thay đổi người dùng thấy được thì ghi luôn, trong cùng commit, vào mục `## Chưa phát hành` của đúng nhật ký (`CHANGELOG.md` cho macOS, `apps/desktop/CHANGELOG.md` cho Tauri): mỗi ý một gạch `- `, viết cho người dùng cuối. Giữ đúng dạng tiêu đề `## <phiên bản> — <YYYY-MM-DD>` — tab "Có gì mới" của app macOS (`ReleaseNotes.swift`), trang chủ (`site/lib/changelog.ts`) và workflow phát hành đều đọc file này.
- Chỉ phát hành khi được yêu cầu:
  - macOS: `./scripts/release.sh <phiên bản> "<ghi chú>" [--publish]` — đổi `## Chưa phát hành` thành phiên bản, tăng `Resources/Info.plist`, ký Ed25519 bằng khoá trong Keychain. Sau đó commit `Resources/Info.plist`.
  - Windows: đẩy tag `desktop-v<phiên bản>`. Phiên bản phải khớp ở `apps/desktop/src-tauri/tauri.conf.json`, `apps/desktop/package.json` và tiêu đề `## <phiên bản> ` trong `apps/desktop/CHANGELOG.md`, nếu không workflow dừng. Hậu tố `-beta.N` là bản thử (chỉ lên kênh beta).
