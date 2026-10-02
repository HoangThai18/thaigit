---
phase: 2
title: "Rust Backend Bridge"
status: in-progress
priority: P1
effort: "7-10 ngày (2a: 6-8, 2b: 1-2)"
dependencies: [1]
---

# Phase 2: Rust Backend Bridge

## Overview
Lớp Rust mỏng nhưng là **ranh giới bảo mật** giữa webview và máy: chạy git qua bộ kiểm tra (Rust giữ env + cờ `-c`), stream byte qua Channel, khoá thao tác theo repo, huỷ theo bậc, đọc/ghi file theo byte trong phạm vi repo, watcher có lọc, tìm git, askpass. Logic git (parse, graph, patch) ở TS (phase 3).
- **2a (M1a):** policy + validator, repo registry + trust gate, exec + frame, khoá, huỷ, health, RepoFs, watcher, locate, OS tối thiểu, CSP.
- **2b (M1b, sau 4a):** askpass bằng chính binary app (`thaigit --askpass`) + 2 hồ sơ env interactive/background.

## Context Links
- Swift: `Sources/NhanhCore/Support/ProcessRunner.swift`, `Git/GitEnvironment.swift` (env :33-49), `Git/GitRunner.swift` (cờ `-c` :67-78, đã có `core.fsmonitor=false`), `Support/RepoWatcher.swift`
- [Red team](./plan.md#red-team-review): SA1/AD6, SA2, SA9, SA10, SC3/AD8, SC4, AD5, FM3, FM5, FM9, FM10

## Key Insights
- Webview hiển thị chuỗi do người lạ kiểm soát (commit, tên file, output AI) → coi frontend là **không tin cậy**. `-c core.fsmonitor=<lệnh>`, `--upload-pack=<lệnh>`, `GIT_SSH_COMMAND`… đều là chạy lệnh tuỳ ý, nên frontend không được đặt cờ/env.
- `Channel<Vec<u8>>` bị gửi thành mảng số JSON và lệnh có thể resolve trước khi khối cuối tới → dùng `Channel<InvokeResponseBody>` frame **Raw** có tag; TS chỉ resolve khi nhận frame `exit`.
- `invoke` không có trong Web Worker → exec ở main thread; worker chỉ nhận bytes để parse/layout.
- Giết cứng git đang ghi → `index.lock` mồ côi, rebase dở. Chỉ lệnh mạng được huỷ, huỷ theo bậc; không timeout lệnh ghi.
- Windows: `CREATE_NO_WINDOW` cho mọi spawn; GCM (helper mặc định của Git for Windows) trả lời HTTPS **trước** `GIT_ASKPASS` bằng UI riêng; chỉ `GCM_INTERACTIVE=never` chặn được.
- ReadDirectoryChangesW không gom sự kiện như FSEvents → phải lọc gitignore trong Rust, nếu không mỗi lần build là một chuỗi `git status`.
- Toast khôi phục ("Stash rồi checkout", "Pull / Force push"…) so khớp **stderr tiếng Anh** ở 7 chỗ → env phải port y nguyên Swift (bỏ `LC_ALL`, `LANGUAGE=en`…).

## Requirements
### Lệnh IPC (2a)
| Lệnh | Mô tả |
|---|---|
| `pick_repo_folder()`, `open_repo(source)` → `{repoId, root, gitDir, commonDir, trust}` | Đường dẫn chỉ đến từ dialog native (Rust gọi), sự kiện thả file native, argv/"Mở bằng", hoặc danh sách gần đây do Rust lưu — JS không đưa đường dẫn tuỳ ý |
| `trust_repo(repoId)` | Ghi nhận tin tưởng: realpath + băm tập khoá chạy lệnh (tập đổi → hỏi lại) |
| `git_exec(req, channel)` | `req = {repoId, opId, kind: read\|write\|network, sub, args[], stdin?, env?}` → frame; lệnh trả `()` |
| `git_cancel(opId)` | Chỉ `kind=network`; huỷ theo bậc |
| `repo_health(repoId)`, `remove_stale_lock(repoId, path)` | Khoá mồ côi (`index.lock`, `HEAD.lock`, `refs/**.lock`, `packed-refs.lock`…) khi không còn git con của repo + trạng thái dở (merge/rebase/cherry-pick/revert); gỡ sau khi user xác nhận |
| `fs_*` (RepoFs, dưới) | Đọc/ghi theo byte, trong phạm vi repo |
| `watch_repo(repoId)` / `unwatch_repo` | Sự kiện `{repoId, kinds: [workingTree\|refs\|rescan]}` |
| `git_locate()`, `set_git_path(path)` | Rust là nguồn sự thật duy nhất cho git + env; đổi → phát `git-env-changed` |
| `open_in_terminal`, `open_in_editor`, `reveal`, `open_url` | Như Swift: mở app đầu tiên tìm thấy |
| `session_reset()` | Webview tải lại/đóng: huỷ op con + bỏ watcher của cửa sổ đó |

### Chính sách chạy git (dữ liệu: `packages/contracts/git-policy.json`; Rust `include_str!` và thực thi; Node adapter của test đọc cùng file)
- Env port **y nguyên** Swift: PATH (login shell macOS + fallback), `GIT_TERMINAL_PROMPT=0`, `GIT_EDITOR=true`, `GIT_MERGE_AUTOEDIT=no`, `GIT_PAGER=cat`, `PAGER=cat`, bỏ `LC_ALL`, `LANG=en_US.UTF-8` nếu trống, `LC_MESSAGES=C`, `LANGUAGE=en`. Bỏ biến thừa kế làm sai ngữ cảnh: `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_CONFIG_PARAMETERS`, `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_*`/`GIT_CONFIG_VALUE_*`, `GIT_EXEC_PATH`.
- Cờ luôn chèn trước subcommand: 8 cờ của Swift (`core.quotepath=false`, `color.ui=false`, `core.pager=cat`, `log.showSignature=false`, `diff.noprefix=false`, `diff.mnemonicPrefix=false`, `advice.detachedHead=false`, `core.fsmonitor=false`) **+** `safe.bareRepository=explicit`, `protocol.file.allow=user`. Lệnh sinh diff (`diff`, `show`, `log -p`, `stash show -p`) luôn thêm `--no-ext-diff --no-textconv`.
- Env từ frontend chỉ nhận: `GIT_OPTIONAL_LOCKS=0`, `GIT_LITERAL_PATHSPECS=1`, `GIT_INDEX_FILE` (chỉ đường dẫn trong git dir).
- `sub` thuộc allowlist (~30 lệnh — scout report); alias không chạy được.
- Từ chối ở mọi vị trí: `-c`, `--config`, `--config-env`, `--exec-path`, `-C`, `--git-dir`, `--work-tree`, `--namespace`, `--upload-pack`, `--receive-pack`, `--exec`, `-x` (rebase), `--template`, `--output`/`-o` (diff), `--ext-diff`, `--textconv`, `-u` khi sub là fetch/clone/pull/ls-remote (push dùng `--set-upstream`); URL `ext::`, `fd::`, hoặc URL bắt đầu bằng `-`.
- Lệnh rủi ro cao có lệnh riêng có kiểu: `git_config_set(key ∈ allowlist: user.name, user.email, branch.*.remote/merge, pull.rebase, init.defaultBranch…)`, `git_remote_add`/`git_remote_set_url(name, url đã kiểm)`, `git_clone(url, destToken)`.
- Hồ sơ env: **background** (auto-fetch): `GCM_INTERACTIVE=never`, askpass ở chế độ từ chối + `SSH_ASKPASS_REQUIRE=force` (không đè `core.sshCommand` của user) → không bao giờ bật cửa sổ; **interactive**: askpass thật (2b), GCM được hiện UI.

### Repo lạ (trust gate)
- `open_repo` chạy `git config --list --show-scope --show-origin` (đã gắn cờ trên), lọc scope `local`/`worktree` (gồm file `include`), so regex khoá chạy lệnh: `core.(fsmonitor|hookspath|sshcommand|askpass|gitproxy|editor|pager)`, `filter.*.(clean|smudge|process)`, `diff.*.(textconv|command)`, `diff.external`, `merge.*.driver`, `credential.*helper`, `gpg.*program`, `remote.*.(uploadpack|receivepack|vcs)`, `protocol.*.allow`, `url.*.insteadof`, `include.path`, `includeif.*`; cộng file hook không phải `.sample`.
- Không có gì → mở bình thường. Có → `trust: unknown` → UI hỏi (4b). Chưa tin = **chế độ hạn chế**: thêm `-c core.hooksPath=<thư mục rỗng của app>`; đặt lại `credential.helper` rồi thêm lại helper scope global/system; ghi đè từng khoá tìm thấy bằng giá trị global/system hoặc giá trị vô hiệu (test từng loại); không auto-fetch. Repo do app tạo/clone → tin sẵn.
- Sàn git **bảo mật**: bảng phiên bản tối thiểu theo advisory git mới nhất (CVE-2022-23521 → 2.35.6/2.36.4/…/2.39.1, cộng các CVE clone/checkout mới hơn) trong `locate.rs`, xem lại mỗi release; thấp hơn → cảnh báo đỏ, chặn clone/fetch.

### RepoFs (2a; byte, phạm vi repo)
- Đường dẫn tương đối → `dunce::canonicalize` → phải nằm trong root/gitDir; từ chối `..`, đường dẫn tuyệt đối, symlink trỏ ra ngoài.
- `fs_read_git_file(rel ∈ {MERGE_HEAD, MERGE_MSG, SQUASH_MSG, CHERRY_PICK_HEAD, REVERT_HEAD, BISECT_LOG, rebase-merge/*, rebase-apply/*})`.
- `fs_read_worktree_file(rel, maxBytes)`; `fs_write_worktree_file(rel, bytes, expectedSha256)`: CAS với nội dung hiện tại, ghi tạm + rename, giữ mode.
- `fs_append_gitignore(line)`: append theo byte, theo kiểu xuống dòng sẵn có, thêm xuống dòng cuối nếu thiếu; không decode.
- `fs_trash_untracked(rels) → token` vào `<commonDir>/thaigit/trash/<ts>/` (cùng ổ → rename, khác ổ → copy rồi xoá); `fs_restore_trash(token)`; dọn sau 7 ngày. Không dùng crate `trash` (không trả vị trí; restore không có trên macOS).

### Thực thi & IPC (2a)
- Frame: byte đầu là tag — `1` khối stdout ≤ 64 KB, `2` một dòng stderr (tách `\r`/`\n`, giữ byte), `3` exit `{code: i32, cancelled: u8}`. Lệnh trả `()`; TS resolve khi nhận `exit`.
- Khoá theo `realpath(commonDir)`, toàn tiến trình (chung mọi cửa sổ, mọi worktree): `write`/`network` độc quyền; `read` không khoá (`status` chạy với `GIT_OPTIONAL_LOCKS=0`); auto-fetch = `network` ưu tiên thấp, chỉ chạy khi `try_lock` được và không có op chờ.
- Huỷ theo bậc (chỉ `network`): Unix SIGTERM cả process group → chờ 3–5 s → SIGKILL; Windows CTRL_BREAK tới process group → chờ → `TerminateJobObject`. Trả `{cancelled: true, code}`; UI làm mới + `repo_health`.
- Không timeout cho `write`; `read` chỉ cảnh báo khi chậm (không kill).
- Op và watcher gắn nhãn cửa sổ sở hữu → `session_reset` dọn sạch khi webview tải lại.

### Watcher (2a)
- `notify-debouncer-full`; **một** debounce ở Rust, thích nghi: ≥ 150 ms và ≥ thời gian `status` lần trước; tắt tiếng sự kiện working tree khi repo đang có op `write`/`network` của app (op tự làm mới khi xong).
- Lọc: port nguyên `classifyGitPath` (bỏ `objects/`, `logs/`, `*.lock`, `fsmonitor`…) + gitignore bằng crate `ignore` (`.gitignore` gốc, `info/exclude`, `core.excludesFile`; file lồng nhau nạp lười).
- Đường dẫn chuẩn hoá `dunce`, so tiền tố không phân biệt hoa thường; tràn bộ đệm → `rescan`.

### Askpass (2b)
- Không sidecar/`externalBin`: `GIT_ASKPASS`/`SSH_ASKPASS` trỏ tới chính binary app; `main()` kiểm `--askpass` **trước** khi dựng Tauri (trước cả plugin single-instance) → nối `127.0.0.1` + token → in câu trả lời → thoát.
- Token **theo op**: chỉ cấp cho op `network` hồ sơ interactive, thu hồi khi tiến trình thoát; yêu cầu không khớp op đang chạy → từ chối. Modal hiện tên thao tác ("git push origin") + host đã parse; từ chối prompt có ký tự điều khiển hoặc `%40`/`%2F` trong host. Đang chờ askpass → BusyBar hiện nút Huỷ. Không log prompt/answer.

### Non-functional
- `git log` 30k commit (≈ 6 MB) tới TS < 1 s; không deadlock khi stdout/stderr cùng lớn; RAM backend < 50 MB lúc rảnh; Windows không nháy console.

## Architecture
```
UI ─invoke(git_exec{repoId,opId,kind,sub,args})+Channel─► exec.rs ─► policy.rs (kiểm + env + -c) ─► spawn git (no-window, process group/Job)
 ▲  frame [tag|bytes]: stdout / stderr / exit                                                         └─► ssh / remote-https / hook (repo tin cậy)
 └─────────────────────────────────────────────────────────────────────────────────────────────┘
git ─GIT_ASKPASS=<binary app> --askpass─► askpass.rs (127.0.0.1 + token theo op) ─event─► modal ─reply─┘
notify ─► watcher.rs (classify + gitignore + debounce thích nghi + mute) ─event "repo-changed"─► RepoStore
registry.rs (repoId, trust, cửa sổ) · locks.rs (realpath(commonDir) → mutex) · repo_fs.rs · health.rs
```

## Related Code Files
- Create: `apps/desktop/src-tauri/src/{main.rs,lib.rs,policy.rs,registry.rs,trust.rs,exec.rs,locks.rs,health.rs,repo_fs.rs,watcher.rs,locate.rs,askpass.rs,os_integration.rs,errors.rs}`
- Create: `apps/desktop/src/lib/ipc/{gitExec.ts,repoFs.ts,watcher.ts,askpass.ts,os.ts}`
- Modify: `packages/contracts/git-policy.json`; `apps/desktop/src-tauri/Cargo.toml` (tokio, notify, notify-debouncer-full, ignore, dunce, serde, sha2, windows-sys (Job Object, console ctrl), nix; **không** `trash`); `tauri.conf.json`; `capabilities/default.json` (chỉ command của app; không `shell:*`, không `fs:*`)

## Implementation Steps
1. `policy.rs` + test: nạp `git-policy.json`, dựng env, chèn cờ, validator. Test bắt buộc: từ chối `-c core.fsmonitor=…`, `--upload-pack=…`, `ext::sh -c …`, env `GIT_SSH_COMMAND`, sub ngoài allowlist; output vẫn tiếng Anh khi `LC_ALL=de_DE.UTF-8` / `vi_VN.UTF-8`.
2. `registry.rs` + `trust.rs`: `pick_repo_folder` (dialog từ Rust), `open_repo`, tính `commonDir`, quét khoá chạy lệnh + hook, danh sách gần đây do Rust lưu.
3. `exec.rs`: tokio::process; Unix `process_group(0)`; Windows Job Object + `CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP`; đọc stdout/stderr đồng thời → frame; bảng `opId → child` gắn cửa sổ.
4. `locks.rs` + `health.rs`: mutex theo commonDir; khoá mồ côi = không còn child của repo + mtime cũ; trạng thái dở.
5. Huỷ theo bậc + spike Windows CTRL_BREAK (0,5 ngày; không ổn → `TerminateJobObject` sau 5 s, luôn chạy `repo_health`).
6. `repo_fs.rs` + test phạm vi (symlink ra ngoài, `..`, tuyệt đối) và byte (BOM, CRLF, Latin-1 giữ nguyên).
7. `watcher.rs` + port `classifyGitPath` + test (symlink `/tmp` macOS, tên 8.3 `RUNNER~1` Windows, `node_modules` bị lọc, tắt tiếng khi có op).
8. `locate.rs`: cấu hình user → PATH (macOS thêm PATH login shell, timeout 3 s) → `/opt/homebrew/bin`, `/usr/local/bin`, `C:\Program Files\Git\cmd` → `where.exe`; macOS kiểm `xcode-select -p` trước khi gọi `/usr/bin/git`; `git --version` + sàn bảo mật.
9. `os_integration.rs`: terminal/editor đầu tiên tìm thấy (như Swift); Windows mở editor bằng `.exe` thật (App Paths, vd. `Code.exe`), **không** `.cmd`/`.bat`; `open_url` chỉ `https:` (`mailto:` qua xác nhận); `reveal`/editor chỉ trong root repo.
10. CSP + điều hướng: `default-src 'self'; script-src 'self'; object-src 'none'; img-src 'self' blob: data:; connect-src ipc: http://ipc.localhost <API>; frame-src 'none'`; `on_navigation` chặn mọi origin ngoài app.
11. Test IPC thật (harness WebdriverIO của 4a): stream > 50 MB, SHA-256 khớp, frame `exit` luôn sau khối stdout cuối.
12. (2b) Askpass binary + token theo op + 2 hồ sơ env; test round-trip với listener giả; test auto-fetch không bật GCM/askpass.

## Todo List
- [x] (2a) policy + validator + test từ chối (đọc chung `git-policy.json` + vectors với TS)
- [x] (2a) registry + trust gate + sàn bảo mật git (repo lạ có khoá không trung hoà được → chặn mạng)
- [x] (2a) exec + frame Raw + bảng op theo cửa sổ
- [x] (2a) khoá theo commonDir + health + huỷ theo bậc
- [x] (2a) RepoFs + thư mục rác của app
- [x] (2a) watcher (gitignore, debounce thích nghi, mute)
- [x] (2a) locate + OS integration tối thiểu + CSP/điều hướng (31 lệnh IPC, khớp đúng `Commands` của contracts)
- [ ] (2a) `cargo test` xanh CI 2 OS (macOS: 178 test xanh; Windows mới kiểm kiểu bằng clippy, chưa chạy); test IPC 50 MB (cùng 4a); frame chưa có backpressure
- [ ] (2a) Review bảo mật độc lập (đang chạy)
- [ ] (2b) askpass bằng binary app + token theo op + hồ sơ env

## Success Criteria
- [ ] `git log` 30k commit tới TS < 1 s; stream 50 MB qua IPC thật, băm khớp
- [ ] Mọi case từ chối ở bước 1 có `cargo test`; JS không có đường nào đặt env/cờ `-c` tuỳ ý
- [ ] Huỷ fetch/clone/push: dừng trong ≤ 5 s (mềm → cứng), không tiến trình mồ côi; lệnh `write` không có nút huỷ, không timeout
- [ ] Giết git giữa chừng → `repo_health` báo khoá mồ côi, gỡ được sau xác nhận
- [ ] Repo có `core.fsmonitor=<lệnh>` hoặc hook lạ: không lệnh nào của repo chạy trước khi user tin tưởng
- [ ] Sửa file ngoài app → sự kiện tới UI < 400 ms; `npm install` trong repo không gây làm mới liên tục
- [ ] Output git vẫn tiếng Anh khi `LC_ALL` là ngôn ngữ khác
- [ ] (2b) SSH passphrase hiện modal trong app trên 2 OS; HTTPS Windows: GCM tự hiện UI (không treo, không hỏi lặp); auto-fetch không bao giờ bật cửa sổ đăng nhập
- [ ] Windows: không nháy console

## Risk Assessment
- Validator chặn nhầm lệnh hợp lệ → chạy đủ 80 thao tác của core qua validator (harness 4a); lỗi rõ "lệnh bị chặn bởi chính sách"; nới trong `git-policy.json`.
- CTRL_BREAK trên Windows không tin cậy → fallback kill + health check.
- Defender làm chậm spawn (50–100 ms/lệnh) → gộp lệnh, cache, giới hạn song song.
- Rollback: chưa phát hành tới M1b → revert commit.

## Security Considerations
- Rust là điểm thực thi chính sách; capability chỉ liệt kê command của app; không `shell:*`/`fs:*`; opener chỉ URL.
- Token askpass theo op, so constant-time, chỉ `127.0.0.1`; không log prompt/answer.
- Args là mảng (không qua shell); path qua `--pathspec-from-file=- --pathspec-file-nul` hoặc sau `--` với `GIT_LITERAL_PATHSPECS=1` (Swift có vài lệnh truyền path trong argv — chấp nhận khi có `--` + literal).
- `rust-version` ≥ 1.77.2 (BatBadBut); không bao giờ chạy `.cmd`/`.bat` với tham số lấy từ repo.

## Next Steps
- Phase 3 dùng `gitExec.ts` + `repoFs.ts` làm adapter Tauri cho port `Exec`/`RepoFs`.
