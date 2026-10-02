---
phase: 2
title: "Rust Backend Bridge"
status: pending
priority: P1
effort: "4-6 ngày"
dependencies: [1]
---

# Phase 2: Rust Backend Bridge

## Overview
Lớp Rust mỏng: chạy git (stream byte, huỷ được, không nháy cửa sổ console trên Windows), tìm git trên máy, cầu nối askpass để hỏi mật khẩu/passphrase trong UI, theo dõi file, và các lệnh tích hợp hệ điều hành. Toàn bộ logic git (parse, graph, patch…) nằm ở TS (phase 3).

## Context Links
- Swift gốc: `Sources/NhanhCore/Support/ProcessRunner.swift`, `Git/GitEnvironment.swift`, `Git/GitRunner.swift`, `Support/RepoWatcher.swift`
- [Tauri research §2, §5](./research/researcher-01-tauri-desktop-report.md)

## Key Insights
- Trả stdout dạng **byte thô** (`tauri::ipc::Response` / Channel gửi `Vec<u8>`), TS decode bằng `TextDecoder`. Không bọc vào JSON: output `-z` có NUL, và chuỗi lớn sẽ chậm.
- git sinh process con (ssh, git-remote-https). Huỷ phải giết **cả cây process**: Unix dùng process group, Windows dùng Job Object.
- Windows: cờ `CREATE_NO_WINDOW` cho mọi lần spawn, nếu không sẽ nháy console.
- macOS: `/usr/bin/git` là shim của Xcode, chưa cài CLT sẽ bật hộp thoại cài → kiểm tra bằng `xcode-select -p` trước. Đọc PATH từ login shell (port từ Swift) để thấy git của Homebrew.
- Askpass phải là **file thực thi** (GIT_ASKPASS/SSH_ASKPASS) → dùng sidecar `thaigit-askpass` gọi về app qua localhost kèm token.
- Bài học watcher từ Swift: so khớp bằng đường dẫn thật (realpath; trên Windows dùng crate `dunce` để tránh tiền tố `\\?\`), không phân biệt hoa thường.

## Requirements
- Functional
  - `git_exec(req, on_event: Channel)`: args, cwd, stdin (bytes), env thêm, acceptExitCodes. Trả {code, stdout bytes, stderr text}. Stream các dòng stderr (tiến trình fetch/push/clone `--progress`) và stdout lớn theo khối.
  - `git_cancel(op_id)`: giết cây process, lệnh đang chờ trả về trạng thái `cancelled` (không phải lỗi git).
  - `git_locate()`: {path, version} hoặc lỗi có hướng dẫn cài (macOS: CLT/Homebrew; Windows: Git for Windows).
  - Askpass: sidecar nhận prompt → app hiện modal (mật khẩu thì ẩn ký tự; câu hỏi yes/no thì hiện 2 nút) → trả lời.
  - `watch_repo(root, git_dir, common_dir)` / `unwatch_repo`: phát sự kiện `{repoId, kinds: [workingTree|refs]}` đã debounce khoảng 300 ms. Khi tràn bộ đệm thì phát `rescan`.
  - Tích hợp OS: mở Terminal (macOS: Ghostty/iTerm/Warp/Terminal; Windows: Windows Terminal/PowerShell/Git Bash), mở editor (VS Code/Cursor/Zed/Sublime), hiện trong Finder/Explorer, đưa file vào Thùng rác (crate `trash`), mở URL.
- Non-functional: output 30k commit (khoảng 6 MB) tới TS dưới 1 s; không deadlock khi stdout/stderr đều lớn; RAM backend dưới 50 MB lúc rảnh.

## Architecture
```
TS GitRunner ──invoke("git_exec", {opId,args,cwd,stdin,env}) + Channel──► Rust exec.rs
   ▲   bytes(stdout chunks) / progress lines / exit                         │ spawn (env chuẩn, no-window, process group/Job)
   └───────────────────────────────────────────────────────────────────── git ─► ssh / remote-https
git ──GIT_ASKPASS──► thaigit-askpass (sidecar) ──TCP 127.0.0.1:port + token──► askpass_server.rs ──event──► UI modal ──reply──┘
notify(debouncer) ──► watcher.rs (classify .git paths) ──event "repo-changed"──► TS RepoStore
```
Env chuẩn (giữ nguyên như Swift): `GIT_TERMINAL_PROMPT=0`, `GIT_EDITOR=true`, `LC_MESSAGES=C`, `LANGUAGE=C`, `GIT_ASKPASS`/`SSH_ASKPASS`=sidecar, `SSH_ASKPASS_REQUIRE=force`, `THAIGIT_ASKPASS_PORT/TOKEN`. Cờ chung do TS thêm: `-c core.quotepath=false -c color.ui=false …`.

## Related Code Files
- Create: `apps/desktop/src-tauri/src/{main.rs,lib.rs,exec.rs,locate.rs,askpass_server.rs,watcher.rs,os_integration.rs,errors.rs}`
- Create: `apps/desktop/src-tauri/askpass/` (crate bin `thaigit-askpass`, khai báo `externalBin` trong `tauri.conf.json`)
- Create: `apps/desktop/src/lib/ipc/{gitExec.ts,watcher.ts,askpass.ts,os.ts}` (wrapper typed cho invoke/Channel/event)
- Modify: `apps/desktop/src-tauri/Cargo.toml` (tokio, notify, notify-debouncer-full, dunce, trash, serde, windows-sys/job objects, nix/libc), `tauri.conf.json`, `capabilities/*.json` (chỉ mở đúng các command cần)

## Implementation Steps
1. `exec.rs`: tokio::process; Unix gọi `setsid`/`process_group(0)`; Windows tạo Job Object với KILL_ON_JOB_CLOSE + `CREATE_NO_WINDOW`. Đọc stdout/stderr đồng thời; stdout gom khối 64 KB gửi qua Channel; stderr tách dòng theo `\r`/`\n` (port `onStderrLine`). Bảng `op_id → child` để huỷ.
2. `locate.rs`: thứ tự tìm git: cấu hình người dùng → PATH (macOS bổ sung PATH từ login shell, timeout 3 s) → vị trí mặc định (`/opt/homebrew/bin`, `/usr/local/bin`, `C:\Program Files\Git\cmd`) → `where.exe`. Kiểm tra `git --version` (yêu cầu ≥ 2.35 vì dùng `--pathspec-from-file`, `switch`, `restore`).
3. Askpass: lúc khởi động bind `127.0.0.1:0` và sinh token 32 byte. Sidecar đọc env, gửi `{token, prompt}`; server kiểm token, phát event `askpass-request {id, prompt, kind}`; UI trả lời qua command `askpass_reply(id, answer|null)`. Timeout 5 phút. Không log nội dung trả lời.
4. `watcher.rs`: debouncer-full 300 ms; theo dõi root (recursive) + git_dir/common_dir nếu nằm ngoài root; port `classifyGitPath` kèm unit test; xử lý `Rescan`; đường dẫn chuẩn hoá bằng `dunce::canonicalize`; so khớp tiền tố không phân biệt hoa thường.
5. `os_integration.rs`: phát hiện app có sẵn (macOS: `/Applications/*.app`; Windows: `wt.exe`, `code.cmd` trong PATH), trả danh sách cho menu "Mở bằng…".
6. Capabilities Tauri: chỉ cho phép đúng command của app; tắt `shell:allow-execute` chung chung (git chạy qua command riêng, không cho JS tự spawn bất kỳ thứ gì).
7. Test Rust (`cargo test`): stream 50 MB không deadlock; huỷ giết cả cây (spawn git clone repo cục bộ lớn rồi huỷ); askpass round-trip với listener giả; watcher nhận sự kiện qua đường dẫn symlink (`/tmp` macOS) và tên ngắn 8.3 (`RUNNER~1` Windows); giữ đúng byte UTF-8 tiếng Việt và CRLF.

## Todo List
- [ ] exec + cancel + progress stream
- [ ] locate git cả 2 OS + màn hình hướng dẫn cài khi thiếu
- [ ] askpass sidecar + modal UI tối thiểu
- [ ] watcher + classify + rescan
- [ ] OS integration
- [ ] capabilities tối thiểu + cargo test xanh trên CI 2 OS

## Success Criteria
- [ ] `git log` 30k commit tới TS dưới 1 s (đo trên CI)
- [ ] Huỷ fetch/clone đang chạy dừng ngay dưới 1 s, không còn process mồ côi (kiểm bằng Task Manager / `ps`)
- [ ] Push qua HTTPS cần mật khẩu hiện modal trong app, trên cả 2 OS
- [ ] Sửa file ngoài app → UI nhận sự kiện dưới 500 ms
- [ ] Windows: không nháy cửa sổ console khi chạy lệnh

## Risk Assessment
- Job Object/process group xử lý sai → treo hoặc sót process. Giảm thiểu: test chuyên biệt, đặt timeout cho lệnh không cần mạng.
- Windows Defender quét chậm lúc spawn → mỗi lệnh git khoảng 50–100 ms. Giảm thiểu: gộp lệnh, cache, chạy song song có giới hạn.
- Sidecar askpass bị chặn bởi firewall/AV (localhost thường không bị). Phương án dự phòng: named pipe trên Windows.

## Security Considerations
- Askpass chỉ nghe localhost, token ngẫu nhiên mỗi phiên, so token bằng constant-time; không bao giờ ghi log prompt/answer.
- Capabilities hạn chế: frontend không spawn được lệnh tuỳ ý. Chỉ `git_exec` (binary git đã định vị) và các lệnh OS đã liệt kê.
- Args truyền dạng mảng (không qua shell), không ghép chuỗi → không có shell injection; path đưa qua stdin (`--pathspec-from-file=- --pathspec-file-nul`).

## Next Steps
- Phase 3 dùng `gitExec.ts` làm nền cho `GitRunner` TS.
