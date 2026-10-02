---
phase: 3
title: "TypeScript Core Port"
status: in-progress
priority: P1
effort: "8-10 ngày"
dependencies: [2]
---

# Phase 3: TypeScript Core Port

## Overview
Port `NhanhCore` (Swift, ≈ 2.800 dòng) sang `packages/core` (TS thuần, không phụ thuộc UI) với **hai** port I/O (`Exec`, `RepoFs`) và xử lý nội dung **theo byte**. Port 39 test Swift sang Vitest (Parser 10, Diff 6, GraphLayout 8, Repository 15); 2 test watcher sang `cargo test` (phase 2); 7 test cập nhật của Swift không port (updater Tauri có test riêng ở phase 8). Test chạy với git thật trên macOS + Windows. Thuộc mốc **M1a**.

## Context Links
- [Port inventory](./reports/scout-report.md) · [Red team](./plan.md#red-team-review): SC3/AD8, AD5, AD9, FM2, FM8, SA10
- Swift: `Sources/NhanhCore/**`, `Tests/NhanhCoreTests/**`

## Key Insights
- 10 thao tác Swift đọc/ghi file trực tiếp (`open`, `operationState`, `pendingCommitMessage`, đọc/ghi working file, `addToGitignore`, `trashUntracked`, clone/init mkdir) → core cần port `RepoFs` bên cạnh `Exec`. Mỗi port có adapter Node (test) và adapter Tauri (app, phase 2).
- Env + cờ `-c` **không** viết trong runner TS: lấy từ `packages/contracts/git-policy.json` (Rust thực thi trong app; adapter Node áp cùng file khi test) → một nguồn sự thật, test và app cùng hành vi.
- Swift giải mã lossy (`String(decoding:)`) và tách diff theo Character (`"\r\n"` là 1 grapheme → dòng CRLF không tách, `Diff.swift:127`). **Không port nguyên**: parse diff trên `Uint8Array`, tách theo byte `\n`, giữ `\r` trong dòng, build patch thành bytes; chỉ decode UTF-8 để hiển thị.
- API tách: `exec*()` trả bytes (main thread) và hàm thuần `parse*()`/`layout()` (worker). `history()` không gói exec + parse + layout trong một lời gọi nữa.
- `PatchBuilder` rủi ro nhất: port toàn bộ test cạnh biên + ma trận CRLF/encoding.
- Windows: `GIT_CONFIG_GLOBAL=NUL` (thay `/dev/null`) trong TestRepo; git trả `C:/...`, chuẩn hoá thống nhất.

## Requirements
- API tương đương `GitRepository` (80 thao tác), models, parsers, diff/patch/conflict (byte), graph layout, command log, `isValidRefName`, clone/init có tiến trình.
- Huỷ: kết quả `{cancelled, exitCode}` → `CancelledError` mang mã thoát (không che kết quả thật); pull = `fetch` (huỷ được) rồi `merge`/`rebase` (không huỷ).
- Command log: che `scheme://user:pass@` → `scheme://***@` và mẫu token (`ghp_`, `github_pat_`, `glpat-`, `xox[bp]-`, `AKIA…`) trong argv và stderr **ngay lúc ghi**.
- Non-functional: strict TS, không `any`; parse log 30k < 300 ms, layout 30k < 300 ms (Node, M1); không phụ thuộc runtime nặng; không regex quay lui.

## Architecture
```
packages/core/src/
├── ports/    exec.ts (ExecRequest{repoId, kind, sub, args, stdin, env}, ExecResult{code, stdout: Uint8Array, stderr, cancelled})
│             repo-fs.ts (RepoFs) · node/ (adapter Node cho cả hai, đọc git-policy.json)
├── git/      runner.ts (acceptExitCodes, GitError, CancelledError, CommandLog) · models.ts · parsers.ts · repository.ts (80 thao tác)
├── diff/     bytes.ts (tách dòng theo byte) · diff.ts · patch-builder.ts (bytes) · conflict-file.ts (bytes) · presentation.ts (decode để hiển thị)
├── graph/    layout.ts (làn, màu theo làn, làn WIP)
├── support/  command-log.ts (che credential) · paths.ts · text.ts (decode fatal / không fatal, unquote path)
└── index.ts
packages/core/test/  parsers · diff · patch-bytes (ma trận) · graph · repository · helpers/test-repo.ts
```

## Related Code Files
- Create: các file trên + `packages/core/{package.json,tsconfig.json,vitest.config.ts}`
- Create: `apps/desktop/src/lib/core-tauri.ts` (adapter `Exec` + `RepoFs` gọi phase 2), `apps/desktop/src/workers/history.worker.ts` (nhận bytes → parse + layout)
- Tham chiếu (không sửa): `Sources/NhanhCore/**`, `Tests/NhanhCoreTests/**`

## Implementation Steps
1. Ports + adapter Node (spawn args mảng, stdin bytes, env + cờ từ policy, AbortSignal → huỷ; RepoFs Node cùng luật phạm vi).
2. `runner.ts`: `GitError{message, exitCode, stderr}`, `CancelledError{exitCode}`, ghi CommandLog đã che.
3. Models + parsers (giữ đúng `--format`, `%1f`, `-z`); 10 test parser trước.
4. Diff/patch/conflict theo byte; 6 test diff + case EOF/no-newline. **Ma trận CRLF**: {autocrlf true/input/false} × {LF trong index, CRLF trong index (`-text`), lẫn lộn} × {stage dòng, unstage dòng, huỷ dòng, không newline cuối}; so **byte** blob index (`git cat-file -p :path`) và file working tree. Thêm: stage 1 dòng file CP1258; conflict file CP1252 bị từ chối (không đổi byte nào); file có BOM giữ BOM.
5. Graph layout + 8 test (siết 30k < 300 ms).
6. Repository (80 thao tác) + 15 test tích hợp (staging dòng, merge conflict, rebase abort, stash, fetch/push/pull với remote bare cục bộ). TestRepo cô lập cấu hình.
7. Test Windows: đường dẫn tiếng Việt (`Tài liệu/ghi chú.txt`), dấu cách, > 200 ký tự (`core.longpaths`), file thực thi/mode.
8. Bench `vitest bench`: parse + layout 30k với repo sinh từ [`make-big-repo.py`](./research/make-big-repo.py) (30k commit, 1.077 ref = 878 nhánh + 199 tag); chép script vào `packages/core/test/fixtures/`.
9. Tích hợp app: `core-tauri.ts` + worker (bytes chuyển bằng transferable `ArrayBuffer`).

## Todo List
- [x] Ports `Exec` + `RepoFs` + adapter Node (37 test)
- [x] Runner + lỗi + command log đã che (16 test)
- [x] Parsers (22 test)
- [x] Diff/patch/conflict theo byte (381 test: ma trận CRLF 144 ô, CP1252/CP1258, BOM, fuzz 96 cặp)
- [x] Graph layout (12 test; bench repo 30k commit: log 16 ms + layout 8 ms + history 26 ms)
- [x] Repository (53 test tích hợp trên git thật, gồm kiểm chính sách cho mọi thao tác)
- [ ] Test riêng Windows + CI 2 OS (workflow có, chưa chạy trên GitHub)
- [ ] Adapter Tauri + worker

## Success Criteria
- [ ] 39 test port + test mới (ma trận CRLF, encoding, Windows) xanh trên macOS **và** Windows CI
- [ ] Mọi ô ma trận CRLF khớp byte (index + working tree)
- [ ] File không phải UTF-8 không bao giờ bị ghi lại qua đường decode
- [ ] Bench: parse 30k < 300 ms, layout 30k < 300 ms (Node)
- [ ] Đủ 80 thao tác chạy qua validator phase 2 không bị chặn nhầm (qua adapter Tauri trong harness 4a)

## Risk Assessment
- Khác biệt hành vi git giữa phiên bản (Apple git vs Git for Windows) → CI 2 OS; sàn bảo mật (phase 2); tránh cờ quá mới.
- Patch theo byte khó debug → test vàng (golden bytes) cho từng ô ma trận.
- Rollback: chưa phát hành tới M1b → revert commit.

## Security Considerations
- Không ghép chuỗi lệnh; path qua stdin NUL-separated hoặc sau `--` với `GIT_LITERAL_PATHSPECS=1`.
- Command log không bao giờ giữ credential ở dạng rõ.

## Ghi chú sau khi port (2026-10-02)
- Port phát hiện 3 lỗi của bản Swift mà `git apply` áp âm thầm (dòng "không newline cuối file" đặt trước ngữ cảnh → hai dòng dính nhau; unstage một phần file đổi tên → đổi tên ngược trong index; dòng được thêm xuống dòng trong file CRLF nhận "\n" lẻ). Bản TS đã sửa. Bản Swift còn tách dòng CRLF sai (`String.split` coi "\r\n" là một ký tự) và giải mã UTF-8 kiểu thay thế → đang sửa trong app Swift.
- `applyPatch` có tuỳ chọn `unidiffZero` (patch `-U0` cần `--unidiff-zero`).
- Việc tiếp (làm sau khi Rust 2a xong, sửa cùng lúc TS + Rust + vectors): thêm `readSecond` vào `git-policy.json` cho dạng chỉ đọc của sub ghi (`stash list|show`, `remote -v|get-url`) để làm mới không phải chờ sau fetch/push đang giữ khoá.
- `classifyGitPath` bản TS chỉ để tham chiếu: khi watcher Rust (2b) xong → chuyển case test sang `packages/contracts` làm vectors chung rồi xoá bản TS.

## Next Steps
- Phase 4/5 dùng `@thaigit/core`; phase 6 thêm `ai/*` vào core.
