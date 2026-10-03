---
phase: 5
title: "Cờ rủi ro (Tauri + Swift)"
status: completed
priority: P2
dependencies: [2, 4]
---

# Phase 5: Cờ rủi ro (Tauri + Swift)

## Overview
Luật (không AI) xét thay đổi chưa commit, hiện dải cảnh báo trên panel commit trước khi commit.

## Rules (v1)
| Mã | Điều kiện |
|---|---|
| `tests-removed` | file test bị xoá (đường dẫn khớp `test/`, `tests/`, `__tests__/`, `*.test.*`, `*.spec.*`, `*_test.*`, `Tests/`) |
| `tests-skipped` | dòng thêm chứa `.skip(`, `.only(`, `xit(`, `xdescribe(`, `@Disabled`, `#[ignore]`, `XCTSkip` trong file test |
| `deps-changed` | manifest / lockfile: `package.json`, `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `Cargo.toml`, `Cargo.lock`, `Package.swift`, `Package.resolved`, `go.mod`, `requirements*.txt`, `pyproject.toml`, `Gemfile*`, `composer.*` |
| `ci-changed` | `.github/workflows/*`, `.circleci/*`, `.gitlab-ci.yml`, `Jenkinsfile`, `Dockerfile*`, `docker-compose*` (`.env*` thuộc `secret`) |
| `large-file` | file > 1 MB được thêm / sửa (Tauri chỉ đo file mới — không có API đo kích thước) |
| `secret` | dòng thêm khớp `findSecret` (TS có sẵn, Swift port) hoặc file nhạy cảm (`classifyPath`) |

- Hợp đồng: `packages/contracts/risk-rules.vectors.json` (đầu vào: danh sách {path, status, addedLines[], binarySize?} → mã cờ). TS và Swift test cùng vectors.
- TS: `packages/core/src/risk/risk-flags.ts` (dùng lại `secret-scan.ts`); Tauri: dải trong `staging/CommitComposer.svelte` hoặc `inspector/WipPanel.svelte`, bấm cờ → lọc danh sách file. Chuỗi `strings/risk.vi.ts`.
- Swift: `Sources/NhanhCore/Support/RiskFlags.swift` (+ port tối thiểu của `findSecret`/`classifyPath`, có vectors riêng nếu port); view trong panel commit.
- Chỉ đọc diff đã có sẵn trong store (không chạy thêm lệnh nặng); diff quá lớn → chỉ xét theo đường dẫn.

## Related Code Files
- Create: `packages/contracts/risk-rules.vectors.json`, `packages/core/src/risk/risk-flags.ts`, `packages/core/test/risk-flags.test.ts`, `apps/desktop/src/lib/strings/risk.vi.ts`, `Sources/NhanhCore/Support/RiskFlags.swift`, `Tests/NhanhCoreTests/RiskFlagsTests.swift`
- Modify: `packages/contracts/package.json` (exports), `packages/core/src/index.ts`, `apps/desktop/src/lib/inspector/WipPanel.svelte` hoặc `staging/CommitComposer.svelte`, `strings.vi.ts`, view panel commit Swift

## Implementation Steps (TDD)
Tests Before (vectors, cả TS và Swift, đỏ) → implement lõi → UI → regression gate.

## Success Criteria
- [ ] Vectors xanh ở TS và Swift, kết quả giống hệt.
- [ ] Không chặn commit, chỉ cảnh báo; không hiện nội dung secret ra giao diện (chỉ tên file + dòng số).
