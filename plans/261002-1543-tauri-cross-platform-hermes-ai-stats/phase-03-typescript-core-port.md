---
phase: 3
title: "TypeScript Core Port"
status: pending
priority: P1
effort: "6-8 ngày"
dependencies: [2]
---

# Phase 3: TypeScript Core Port

## Overview
Port toàn bộ `NhanhCore` (Swift, khoảng 2.800 dòng) sang `packages/core` (TypeScript thuần, không phụ thuộc UI) và port đủ 40 test sang Vitest. Test chạy với git thật trên cả macOS và Windows.

## Context Links
- [Port inventory + bất biến cần giữ](./reports/scout-report.md)
- Swift: `Sources/NhanhCore/**`, `Tests/NhanhCoreTests/**`

## Key Insights
- Core phụ thuộc một interface `Exec` duy nhất: test chạy bằng Node `child_process`, còn app chạy qua Rust `git_exec`. Cùng một code repository dùng cho cả hai.
- `PatchBuilder` là phần rủi ro nhất (stage từng dòng, `\ No newline at end of file`, CRLF). Port **toàn bộ** test cạnh biên và thêm test CRLF trên Windows.
- Windows: `GIT_CONFIG_GLOBAL` trỏ tới `NUL` thay cho `/dev/null`; git trả đường dẫn dạng `C:/...` (gạch xuôi), cần chuẩn hoá thống nhất.
- Parse 30k commit và xếp làn graph phải nhanh: chạy được trong Web Worker; không dùng regex quay lui.

## Requirements
- Functional: API tương đương `GitRepository` (khoảng 80 thao tác), models, parsers, diff/patch/conflict, graph layout, command log, `isValidRefName`, clone/init với tiến trình.
- Non-functional: strict TS, không `any`; parse log 30k dưới 300 ms và layout 30k dưới 300 ms (Node, máy M1); 0 phụ thuộc runtime nặng.

## Architecture
```
packages/core/src/
├── exec/        types.ts (Exec, ExecRequest, ExecResult, CancelToken), node.ts (child_process adapter cho test)
├── git/         runner.ts (global -c flags, env, acceptExitCodes, progress, cancel→CancelledError)
│                models.ts · parsers.ts · repository.ts (≈80 ops) · environment.ts (askpass env keys)
├── diff/        diff.ts (parser, inline highlight) · patch-builder.ts · conflict-file.ts · presentation.ts
├── graph/       layout.ts (lanes, per-lane color, WIP lane)
├── support/     command-log.ts · paths.ts (chuẩn hoá Windows/macOS) · text.ts (decode, unquote git path)
└── index.ts
packages/core/test/  parsers.test.ts · diff.test.ts · graph.test.ts · repository.test.ts · helpers/test-repo.ts
```

## Related Code Files
- Create: tất cả file trên + `packages/core/{package.json,tsconfig.json,vitest.config.ts}`
- Create: `apps/desktop/src/lib/core-tauri-exec.ts` (Exec adapter gọi Rust)
- Tham chiếu (không sửa): `Sources/NhanhCore/**`, `Tests/NhanhCoreTests/**`

## Implementation Steps
1. `exec/types.ts` + `exec/node.ts` (spawn args mảng, stdin Buffer, env merge, kill khi AbortSignal).
2. `git/runner.ts`: cùng cờ chung và env như Swift; ánh xạ lỗi → `GitError{message, exitCode, stderr}`; huỷ → `CancelledError`; ghi `CommandLog`.
3. Port models + parsers (giữ **đúng** format `--format`, `%1f`, `-z`); test parser trước (10 test).
4. Port diff + patch-builder + conflict + presentation; port 6 test diff + toàn bộ case EOF/no-newline; thêm test CRLF (file `\r\n`, stage 1 dòng giữa, `git apply --cached --recount` thành công trên Windows với `core.autocrlf=true`).
5. Port graph layout + 8 test (gồm 5k commit dưới 2 s → siết thành 30k dưới 300 ms).
6. Port repository (≈80 thao tác) + 14 test tích hợp (staging dòng, merge conflict, rebase abort, stash, fetch/push/pull với remote bare cục bộ). Helper `TestRepo` cô lập cấu hình.
7. Thêm test riêng cho Windows: đường dẫn tiếng Việt (`Tài liệu/ghi chú.txt`), có dấu cách, dài hơn 200 ký tự (bật `core.longpaths` trong repo test), file thực thi/mode.
8. Bench `vitest bench`: log parse + layout 30k. Repo giả lập sinh bằng [`research/make-big-repo.py`](./research/make-big-repo.py) (`python3 make-big-repo.py | git fast-import`: 30k commit, khoảng 1.100 ref); chép script vào `packages/core/test/fixtures/`.
9. Tích hợp vào app: `core-tauri-exec.ts`; chạy parse + layout trong Web Worker (`comlink` hoặc postMessage thuần).

## Todo List
- [ ] Exec abstraction + Node adapter
- [ ] Runner + errors + command log
- [ ] Parsers (10 test)
- [ ] Diff/patch/conflict (6+ test, CRLF)
- [ ] Graph layout (8 test, bench)
- [ ] Repository ops (14 test tích hợp)
- [ ] Test riêng Windows + chạy CI 2 OS
- [ ] Tauri exec adapter + worker

## Success Criteria
- [ ] ≥ 45 test xanh trên macOS **và** Windows CI (40 port + test Windows mới)
- [ ] Stage từng dòng đúng với file LF, CRLF, không newline cuối
- [ ] Bench: log parse 30k < 300 ms, layout 30k < 300 ms (Node)

## Risk Assessment
- Khác biệt hành vi git giữa các phiên bản (Apple git vs Git for Windows). Giảm thiểu: CI chạy 2 OS; yêu cầu git ≥ 2.35; tránh cờ quá mới.
- CRLF + `git apply`: rủi ro hỏng patch. Giảm thiểu: test byte-chính-xác, giữ `\r` khi parse diff (không `trim`).

## Security Considerations
- Không ghép chuỗi lệnh; mọi path qua stdin NUL-separated; `GIT_LITERAL_PATHSPECS=1` cho thao tác theo path.

## Next Steps
- Phase 4/5 dùng `@thaigit/core`; Phase 6 thêm `ai/context-builder.ts` vào core.
