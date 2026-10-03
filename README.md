<p align="center">
  <img src="brand/thaigit-icon-macos.png" width="128" alt="Biểu tượng Thaigit">
</p>

<h1 align="center">Thaigit</h1>

<p align="center">
  <b>Git client miễn phí, trực quan như GitKraken — giao diện kính cho macOS, sắp có bản Windows.</b>
</p>

![Thaigit: graph commit nhiều màu, sidebar nhánh và panel commit](docs/screenshots/overview.png)

Thaigit giúp làm việc với git bằng chuột: nhìn lịch sử dạng graph nhiều màu, kéo nhánh thả lên nhánh để merge / rebase / push, stage từng dòng, giải conflict bằng vài cú bấm. Mọi thao tác gọi thẳng `git` trên máy, nên kết quả giống hệt dùng terminal — chỉ dễ nhìn và dễ bấm hơn.

| Bản | Nền tảng | Trạng thái |
| --- | --- | --- |
| Thaigit cho macOS (Swift, native) | macOS 14 trở lên | **Dùng được** — build từ mã nguồn, tự cập nhật qua GitHub Releases |
| Thaigit đa nền tảng (Tauri 2) | Windows 10/11 + macOS | **Đang phát triển** — xem [kế hoạch](plans/261002-1543-tauri-cross-platform-hermes-ai-stats/plan.md) |

## Tính năng nổi bật

### Kéo & thả như GitKraken

![Thả nhánh feature/giao-dien lên main: chọn merge hoặc rebase](docs/screenshots/drag.png)

| Kéo | Thả lên | Kết quả |
| --- | --- | --- |
| Nhãn nhánh trên graph hoặc nhánh ở sidebar | Nhánh khác | Merge, rebase hoặc fast-forward |
| Nhánh local | Nhánh remote / tên remote ở sidebar | Push |
| Tag | Remote | Push tag |
| File ở mục *Chưa stage* | Mục *Đã stage* (và ngược lại) | Stage / bỏ stage |

Thả xong luôn có hộp thoại hỏi lại — không có gì chạy ngầm ngoài ý muốn.

### Stage từng dòng, không cần `git add -p`

![Chọn 3 dòng trong diff rồi bấm Stage dòng](docs/screenshots/diff-lines.png)

Bấm vào dòng để chọn (Shift+bấm để chọn liên tiếp), rồi **Stage dòng** / **Huỷ dòng**. Cũng làm được theo cả hunk hoặc cả file. Patch giữ nguyên từng byte (CRLF, BOM); file không phải UTF-8 (Latin-1, CP1258…) chỉ stage / huỷ được cả file để không làm hỏng ký tự.

### Diff tách đôi và diff ảnh

<table>
  <tr>
    <td><img src="docs/screenshots/diff-split.png" alt="Diff tách đôi trước | sau"></td>
    <td><img src="docs/screenshots/image-diff.png" alt="Diff ảnh: trước và sau"></td>
  </tr>
</table>

Tô sáng đúng phần chữ thay đổi trong dòng. File ảnh hiện trước / sau cạnh nhau.

### Giải conflict bằng vài cú bấm

![Trình giải xung đột: giữ Current, Incoming hoặc cả hai cho từng khối](docs/screenshots/conflict.png)

Banner báo đang merge / rebase / cherry-pick kèm nút Tiếp tục / Huỷ. Với mỗi khối xung đột chọn giữ bản hiện tại, bản kia hoặc cả hai, xem trước rồi **Lưu & đánh dấu đã giải quyết**. File không phải UTF-8 thì chọn nguyên bản một bên hoặc mở bằng trình soạn thảo.

### ⌘B — tìm & chuyển nhánh tức thì

![Hộp chuyển nhánh nhanh với danh sách nhánh gần đây](docs/screenshots/switch.png)

### Repo lớn vẫn mượt

![Repo 30.000 commit, gần 1.100 nhánh và tag](docs/screenshots/large.png)

Repo thử 30.000 commit, gần 1.100 nhánh / tag: graph hiện trong khoảng 1 giây, tải thêm khi cuộn, sidebar gom nhánh theo thư mục.

### Hoàn tác mọi thao tác dễ sai

Commit, huỷ thay đổi, merge, reset, xoá nhánh, xoá stash… đều có nút **Hoàn tác** ngay trên thông báo.

### Tự cập nhật — khởi động lại là có bản mới

Thaigit tự hỏi GitHub Releases mỗi 6 giờ, tải bản mới ngầm và **kiểm chữ ký Ed25519** trước khi cài. Khi xong, góc cửa sổ hiện thẻ *"Thaigit x.y.z đã sẵn sàng"* — bấm **Khởi động lại** (hoặc cứ thoát app, lần mở sau đã là bản mới). Kiểm tra tay: menu **Thaigit → Kiểm tra cập nhật…**; tắt / bật trong Cài đặt.

### Giao diện kính, sáng & tối

![Giao diện tối](docs/screenshots/overview-dark.png)

<table>
  <tr>
    <td><img src="docs/screenshots/welcome.png" alt="Màn hình chào: mở, clone, tạo repository"></td>
  </tr>
</table>

Liquid Glass trên macOS 26 (bản cũ hơn dùng vật liệu mờ), màu lấy từ logo: thân xanh, nhánh cam đỏ của git.

## Tất cả tính năng (bản macOS)

**Graph lịch sử**
- Graph nhiều làn, mỗi làn một màu; nhãn nhánh / tag ở cột trái (💻 local, ☁️ remote).
- Node commit là ảnh đại diện của tác giả như GitKraken (GitHub / Gravatar theo email, chưa có ảnh thì chữ viết tắt). Bảng gọn chỉ còn Nhánh / Tag │ Graph │ Commit — tên tác giả và thời gian xem ở panel bên phải; chuột phải lên tiêu đề cột để bật lại cột Tác giả / Thời gian / SHA hoặc tắt ảnh đại diện.
- Dòng `// WIP` trên cùng là thay đổi chưa commit — bấm vào để stage và commit.
- Tìm commit theo nội dung, tác giả, SHA. Tải dần khi cuộn (2.000 commit mỗi lần).

**Thay đổi & commit**
- Diff gộp hoặc tách đôi, diff ảnh; stage / bỏ stage / huỷ theo file, hunk hoặc từng dòng.
- Commit, amend, ⌘↩ để commit nhanh, "Stage tất cả & commit".
- **AI viết commit message** (nút ✨ cạnh chữ Commit): đọc thay đổi đã stage và các commit gần đây để viết đúng phong cách / ngôn ngữ của repo. Chạy bằng Apple Intelligence ngay trên máy (macOS 26+) — code không rời khỏi máy, không cần tài khoản hay API key. Có nút Hoàn tác.
- **Issues GitHub / Jira** (⌥⌘J, hoặc nút # cạnh chữ Commit): xem issue đang mở của repo trên GitHub và issue Jira giao cho bạn; tạo nhánh từ issue (tên gợi ý như `issue-42-dang-nhap-bi-loi`, `WEB-12-gio-hang`), gắn `#42` / `WEB-12` vào commit message, mở trên web. Jira Cloud kết nối bằng email + API token (token cất trong Keychain, chỉ gửi tới site Jira đã nhập).
- **Sửa file ngay trong app**: mở diff của file chưa stage, bấm *Sửa* — gõ, ⌘S lưu, ⌘Z hoàn tác. Giữ nguyên BOM và kiểu xuống dòng (CRLF / LF) của file, giữ quyền chạy (+x); file bị sửa ở nơi khác sau khi mở thì hỏi trước khi ghi đè. Chỉ nhận file UTF-8 (file khác: mở bằng trình soạn thảo); không theo symlink ra ngoài repo.
- **So sánh** hai commit bất kỳ (giữ ⌘ và bấm 2 commit trên graph) hoặc một nhánh với nhánh hiện tại (chuột phải vào nhánh → *So sánh với …*): panel bên phải liệt kê các commit nằm giữa và các file khác nhau, bấm file để xem diff.
- **Ẩn / solo nhánh trên graph** như GitKraken: rê chuột vào nhánh ở sidebar, bấm con mắt để ẩn (hoặc chuột phải → *Ẩn khỏi graph*); *Chỉ hiện nhánh này (solo)* để graph chỉ còn các nhánh đã chọn và nhánh đang checkout. Ẩn nhánh local thì nhánh remote nó theo dõi cũng ẩn theo; app nhớ riêng cho từng repo; dải báo ở đáy graph có nút *Hiện tất cả*.
- **Blame** (chuột phải vào file → *Blame — ai sửa từng dòng*): mỗi dòng kèm tác giả, thời gian và commit đã sửa nó; theo dấu cả khi đoạn code được chuyển từ file khác sang.

**Nhánh, remote, stash, tag**
- Checkout bằng nhấp đúp; ⌘B để tìm & chuyển nhánh.
- Tạo / đổi tên / xoá nhánh, đặt upstream; fetch / pull (merge, rebase hoặc chỉ fast-forward) / push — bị từ chối thì đề xuất pull hoặc force-with-lease.
- Cherry-pick, revert (hỏi commit ngay hay chỉ stage để xem lại, như GitKraken), reset (soft / mixed / hard), tag, push tag.
- **Interactive rebase** (chuột phải vào commit → *Interactive rebase … từ đây*): kéo để đổi thứ tự, chọn pick / reword / squash / fixup / drop cho từng commit, sửa lời commit ngay trong bảng; thay đổi chưa commit được tự cất và trả lại sau khi rebase.
- **Merge từ repository khác** (menu Pull, menu Repository hoặc chuột phải vào nhánh): lấy nhánh của một repo khác — thư mục trên máy (không cần đăng nhập) hoặc URL — merge vào nhánh của repo đang mở, không thêm remote. App nhớ nguồn đã dùng, lần sau chỉ cần bấm *Merge lại*. Hai repo tạo riêng (không chung commit) thì hỏi trước rồi mới merge với `--allow-unrelated-histories`.
- Stash kèm lời nhắn, apply, pop, xoá; checkout bị chặn vì có thay đổi thì có nút "Stash rồi checkout".
- **Ký commit GPG / SSH** (menu Repository → *Ký commit…*): bật ký cho repo này hoặc mọi repo, chọn khoá SSH trong ~/.ssh hoặc khoá GPG. Panel commit cho biết commit có chữ ký không; bấm *Xác minh* để kiểm (luôn dùng gpg / ssh-keygen thật, không chạy chương trình do repo tự đặt).
- **Git Flow** (menu Repository → *Git Flow*): khởi tạo (dùng chung cấu hình `gitflow.*` với git-flow), bắt đầu feature / release / hotfix, kết thúc bằng chuột phải vào nhánh — merge --no-ff, gắn tag phiên bản, xoá nhánh; mục *GIT FLOW* ở sidebar.
- **Submodule và worktree**: mục *SUBMODULES* (tải về / cập nhật, mở submodule trong tab mới) và *WORKTREES* (thêm worktree cho nhánh mới hoặc có sẵn, mở trong tab mới, xoá) ở sidebar.
- **Git LFS** (menu Repository → *Git LFS*): pull / fetch / prune, theo dõi kiểu file mới (sửa .gitattributes).
- **Pull Request (GitHub)**: mục *PULL REQUESTS* ở sidebar liệt kê PR đang mở (repo riêng tư cần đăng nhập GitHub); nhãn nhánh trên graph có biểu tượng PR. Bấm PR để tới commit mới nhất, nhấp đúp để checkout (PR từ fork được lấy về nhánh `pr/<số>`), chuột phải để mở trên GitHub hoặc xem thay đổi so với nhánh đích. *Tạo Pull Request…* (nút + của mục, hoặc chuột phải vào nhánh): chọn nhánh đích, tiêu đề / mô tả điền sẵn từ các commit, tạo dạng nháp được; nhánh chưa push thì push trước rồi tạo.

**Khác**
- Nhiều repo trong nhiều tab như GitKraken: thanh tab ở hàng trên cùng cạnh 3 nút đỏ/vàng/xanh. Đầu hàng là tab **Trang chủ** (🏠, mở / clone / tạo repo, danh sách repo gần đây), cuối hàng là nút ✨ **Có gì mới**; **+** mở tab mới (màn hình chọn repo gần đây), **×** đóng tab, kéo tab để đổi chỗ, chuột phải để đóng các tab khác. Mỗi tab giữ nguyên repo của nó; mở lại app thì các tab của lần trước được mở lại. *File → Đóng repository* đưa tab về màn hình chọn repo. Hàng công cụ của repo (Fetch, Pull, Push…) nằm ngay dưới thanh tab, cửa sổ hẹp thì chỉ còn biểu tượng.
- Tab **Có gì mới** (nút ✨ cuối thanh tab, hoặc menu *Thaigit → Có gì mới…*) đọc nhật ký thay đổi; tự mở một lần sau mỗi lần cập nhật.
- **Bảng lệnh ⌘P** như GitKraken: gõ để tìm mọi thao tác (fetch, pull, stash, tạo nhánh, tạo PR…), checkout nhánh, so sánh nhánh, chuyển tab, mở repo gần đây; gõ không dấu vẫn ra ("nhanh" → "nhánh"), ↑↓ chọn, ↩ chạy.
- Mở gần đây, clone có tiến trình, tạo repo mới.
- Tự làm mới khi file đổi bên ngoài (sửa trong editor, commit từ terminal…), tự fetch định kỳ.
- **Terminal trong app** (⌃\` hoặc menu Mở → *Terminal trong app*): panel dưới graph, gõ lệnh chạy trong thư mục repo, nhớ `cd`, ↑↓ gọi lại lệnh cũ, Dừng (⌃C). Mỗi lệnh chạy riêng, không tương tác — chương trình cần bàn phím (vim, less, ssh hỏi mật khẩu) thì dùng *Mở trong Terminal*.
- Mở repo trong Terminal / Finder / VS Code (hoặc Cursor, Zed, Sublime), lịch sử một file, nhật ký lệnh git đã chạy.
- An toàn khi mở repo lạ: app không chạy lệnh `core.fsmonitor` hay `diff.*.textconv` do repo tự đặt.

## Cài đặt (macOS)

Yêu cầu: macOS 14 trở lên, `git`, và Xcode hoặc Command Line Tools (`xcode-select --install`).

```bash
./scripts/build-app.sh --install  # build rồi chép vào /Applications/Thaigit.app
./scripts/build-app.sh            # chỉ tạo build/Thaigit.app (bản release)
./scripts/build-app.sh --debug    # bản debug, build nhanh hơn
```

Mở thử một repo: `open -a Thaigit /đường/dẫn/repo`, hoặc kéo thư mục repo thả lên icon app.

Ghi chú:
- Máy chỉ có Command Line Tools thì script tự build bằng SDK macOS 26 (SDK macOS 27 cần plugin macro chỉ có trong Xcode). App vẫn chạy bình thường trên macOS 27.
- App được ký ad-hoc. Bản tải từ trình duyệt sang máy khác bị Gatekeeper chặn lần đầu (chuột phải → Mở, hoặc Cài đặt hệ thống → Quyền riêng tư & Bảo mật → Vẫn mở). Bản tự cập nhật không bị chặn. Phát hành rộng nên ký bằng Apple Developer ID.
- Tự cập nhật chỉ thay app nằm trong thư mục Applications.

### Xác thực khi fetch / push

- **HTTPS**: dùng credential helper của git (thường là Keychain — `git config --global credential.helper osxkeychain`). Git cần mật khẩu / token thì app hiện hộp thoại hỏi.
- **SSH**: dùng khoá trong `~/.ssh` và ssh-agent như terminal; passphrase hoặc câu hỏi xác nhận host hiện thành hộp thoại.

### Đăng nhập GitHub

Menu **Thaigit → Đăng nhập GitHub…** (hoặc Cài đặt → Tài khoản): app hiện một mã, bấm **Mở GitHub để xác nhận** (mã đã được sao chép sẵn), dán mã trên github.com rồi bấm *Authorize*. Không cần tự tạo token; Thaigit không bao giờ thấy mật khẩu GitHub.

- Fetch / pull / push / clone tới repo **HTTPS trên github.com** dùng tài khoản GitHub; host khác (GitLab…) và SSH giữ nguyên cách cũ. Hộp Clone liệt kê repo của từng tài khoản, gõ để lọc theo tên.
- **Nhiều tài khoản** (cá nhân, công ty…): Cài đặt → Tài khoản → *Thêm tài khoản…* (trên trình duyệt, chuyển sang đúng tài khoản GitHub đó trước khi nhập mã). Mỗi lệnh git chọn token theo **owner** trong URL `github.com/<owner>/…`: owner bạn tự gán → owner là chính tài khoản → tổ chức mà tài khoản là thành viên → tài khoản mặc định. URL có username trùng một tài khoản (`https://alice@github.com/…`) thì dùng tài khoản đó. Tài khoản không đọc được token thì owner của nó không mượn token tài khoản khác: lệnh báo lỗi và gợi ý đăng nhập lại đúng tài khoản ấy. Repo bị GitHub từ chối thì thông báo có nút *Dùng tài khoản khác cho &lt;owner&gt;…*.
- **Tài khoản cho repo này** (menu Repository): gán owner của `origin` cho một tài khoản và — sau khi bạn xác nhận — ghi tên / email commit của tài khoản đó vào config local của repo (mặc định: tên GitHub + email `id+login@users.noreply.github.com`, sửa được trong Cài đặt). Ô commit nhắc khi email đang dùng khác tài khoản của repo.
- Quyền xin: `repo`, `workflow` (để push được thay đổi trong `.github/workflows`) và `read:org` (biết tài khoản thuộc tổ chức nào).
- Token mỗi tài khoản nằm riêng trong Keychain (mục `com.phanthai.thaigit.github`, theo login) — không ghi vào cấu hình git, không hiện trong nhật ký lệnh. Token chỉ được đưa (qua biến môi trường và script `~/Library/Application Support/Thaigit/github-credential.sh`) cho lệnh git thật sự chạm remote `https://github.com/…` — fetch / pull / push tới remote đó, clone hay merge từ URL đó — và chỉ token của tài khoản dùng cho remote ấy; `fetch --all` mang token của đúng các tài khoản ứng với các remote github.com của repo. Lệnh tới remote khác (GitLab, thư mục trên máy, SSH) và mọi lệnh local không có token nào. Trong lúc lệnh đó chạy, hook của chính repo (pre-push…) và các chương trình git gọi ra vẫn thấy token của tài khoản dùng cho remote đó.
- Xoá một tài khoản chỉ xoá token của tài khoản đó; muốn vô hiệu hẳn token, thu hồi ở [github.com/settings/applications](https://github.com/settings/applications).

Người duy trì — bản build chưa có Client ID thì mục này hiện *Chưa cấu hình*. Tạo OAuth App một lần:

1. GitHub → Settings → Developer settings → OAuth Apps → **New OAuth App**.
2. Homepage URL `https://git.thaipro.store`; Authorization callback URL `https://git.thaipro.store` (Device Flow không dùng tới).
3. Tick **Enable Device Flow**.
4. Chép **Client ID** vào `ThaigitGitHubClientID` trong `Resources/Info.plist`. Device Flow không cần client secret — đừng đưa secret vào app.

## Phát hành bản mới (cho người duy trì)

```bash
./scripts/release.sh 1.1.0 "Thêm blame, sửa lỗi diff ảnh" --publish
```

Script tăng phiên bản trong `Resources/Info.plist`, build, nén `Thaigit-macOS.zip` (tên cố định để trang chủ luôn trỏ tới bản mới nhất), ký bằng khoá Ed25519 trong Keychain, viết `update.json` rồi đăng cả hai lên GitHub Releases (`gh`). Máy nào đang dùng Thaigit sẽ tự tải về trong vòng 6 giờ (hoặc ngay khi bấm *Kiểm tra cập nhật…*); người dùng chỉ cần khởi động lại. Bỏ `--publish` để chỉ tạo file trong `build/release/`. Nhớ commit `Resources/Info.plist` sau khi phát hành.

- Khoá bí mật nằm trong login Keychain, mục **"Thaigit update signing key"** (tạo bằng `swift scripts/release-tool.swift generate-key`). Hãy sao lưu nó — mất khoá thì các bản đã cài không nhận được bản mới. Phát hành từ máy khác / CI: đặt biến `THAIGIT_UPDATE_PRIVATE_KEY`.
- Khoá công khai đi kèm app (`ThaigitUpdatePublicKey` trong Info.plist). App chỉ cài gói có chữ ký đúng, đúng mã ứng dụng và đúng số phiên bản ghi trong gói.

## Phím tắt

| Phím | Việc |
| --- | --- |
| ⌘O / ⇧⌘O / ⌥⌘N | Mở / clone / tạo repository |
| ⌘T / ⌘W | Tab mới / đóng tab |
| ⌃Tab / ⌃⇧Tab / ⌘1…⌘9 | Sang tab sau / trước / tới tab thứ n (⌘1 là Trang chủ, ⌘9 là tab cuối) |
| ⌘N / ⇧⌘W | Cửa sổ mới / đóng cửa sổ |
| ⌘F | Tìm commit |
| ⌘R | Làm mới |
| ⌥⌘F / ⇧⌘L / ⇧⌘P | Fetch / Pull / Push |
| ⌘B | Tìm & chuyển nhánh |
| ⇧⌘B | Tạo nhánh mới |
| ⇧⌘S / ⌥⇧⌘S | Stash / pop stash mới nhất |
| ⇧⌘A | Stage tất cả |
| ⌘↩ | Commit (khi đang gõ message) |
| ⌘0 / ⇧⌘H | Tới WIP / tới HEAD |
| ⌥⌘I | Ẩn / hiện panel chi tiết |
| ⌥⌘T / ⇧⌘R | Mở trong Terminal / Finder |
| Esc | Đóng diff, quay lại graph |

Bản Windows dùng Ctrl thay cho ⌘.

## Cài đặt trong app (⌘,)

- Số commit tải lên graph, thứ tự commit (theo ngày / topo), hiện nhánh remote và tag, thời gian tương đối.
- Diff: số dòng ngữ cảnh, mặc định hiển thị tách đôi.
- Cập nhật: tự kiểm tra & tải bản mới, kiểm tra ngay.
- Git: đường dẫn `git` riêng, kiểu Pull mặc định, prune khi fetch, chu kỳ tự fetch.
- Tài khoản: thêm / xoá tài khoản GitHub, chọn tài khoản mặc định, sửa tên & email commit, owner đã gán.

## Sắp có (bản Thaigit đa nền tảng)

- **Bản Windows**, chung một code với macOS (Tauri 2 + Svelte 5 + TypeScript).
- **AI viết commit message** bằng model Hermes (Nous Research) chạy trên server của Thaigit — bấm một nút là có, không cần API key. Thêm: giải thích commit, viết mô tả Pull Request.
- **Trang chủ [git.thaipro.store](https://git.thaipro.store)** để giới thiệu và tải app (đã có trong `site/`, sắp đưa lên). Thêm thống kê lượt tải và số người dùng (ẩn danh, chỉ khi bạn đồng ý).
- Giao diện tiếng Anh.

### Quyền riêng tư

- **Tự cập nhật** chỉ tải `update.json` và file zip từ GitHub Releases — không gửi thông tin gì về máy hay repo của bạn (GitHub vẫn thấy địa chỉ IP như mọi lượt tải).
- **Đăng nhập GitHub** (nếu dùng): app nói chuyện thẳng với github.com / api.github.com; token chỉ nằm trong Keychain trên máy bạn, không gửi tới server Thaigit.
- **Ảnh đại diện trên graph**: để tìm ảnh, app gửi mã băm SHA-256 của email người commit tới Gravatar, và với repo nằm trên GitHub thì hỏi API GitHub "tài khoản nào đã commit bằng email này" (GitHub vốn đã có các commit đó). Ảnh được cache trên máy 7 ngày. Tắt trong Cài đặt → Chung → *Ảnh đại diện thật*, hoặc chuột phải lên tiêu đề cột graph → bỏ chọn *Ảnh đại diện thật*: khi đó app dừng ngay hàng đợi và không gửi gì nữa.
- **AI** (sắp có) chỉ chạy khi bạn bấm nút AI và đã đồng ý ở lần đầu. App gửi phần thay đổi đã lọc (tự bỏ `.env`, khoá bí mật, lockfile, file nhị phân) tới server Thaigit, nơi model Hermes chạy ngay trên máy chủ của dự án — không gửi cho bên thứ ba, không lưu nội dung code hay message.
- **Thống kê** (sắp có) chỉ gửi khi bạn đồng ý: mã cài đặt ngẫu nhiên, phiên bản app, hệ điều hành. Không gửi tên repo, đường dẫn, code hay email.

## Phát triển

```bash
# Chạy test (khi chỉ có Command Line Tools cần chỉ đường dẫn plugin của Swift Testing)
SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.sdk swift test \
  -Xswiftc -plugin-path -Xswiftc /Library/Developer/CommandLineTools/usr/lib/swift/host/plugins/testing
```

Cấu trúc (module Swift vẫn mang tên cũ `Nhanh` / `NhanhCore`):

```
Sources/NhanhCore/       Lõi không phụ thuộc giao diện (có test)
  Git/                   Chạy git, đọc output, thao tác repo
  Diff/                  Parse diff, tạo patch để stage từng dòng, parse & giải conflict
  Graph/                 Thuật toán xếp làn cho graph
  Update/                Kiểm tra, tải, kiểm chữ ký và cài bản cập nhật
  GitHub/                Đăng nhập GitHub (Device Flow), token trong Keychain, đưa token cho lệnh git mạng
  Support/               Chạy tiến trình, theo dõi file (FSEvents), nhật ký lệnh
Sources/Nhanh/           Ứng dụng macOS (SwiftUI + AppKit)
Tests/NhanhCoreTests/    Test parser, diff/patch, graph, tự cập nhật, thao tác trên repo thật tạm thời
brand/                   Logo gốc và icon
scripts/                 build-app.sh, release.sh, release-tool.swift, make-icons.py
site/                    Trang chủ git.thaipro.store (Next.js, xuất trang tĩnh)
plans/                   Kế hoạch bản đa nền tảng
```

Bản đa nền tảng (Tauri) đang được làm và sẽ gồm `apps/desktop` (app), `packages/contracts` (chính sách lệnh git, định dạng IPC), `packages/core` (lõi TypeScript, port từ NhanhCore) và `server` (AI proxy, thống kê). Chi tiết trong [kế hoạch](plans/261002-1543-tauri-cross-platform-hermes-ai-stats/plan.md).

Trang chủ (`site/`) cần Node 24 và pnpm: `pnpm install`, rồi `pnpm --filter @thaigit/site dev` để xem thử ở http://localhost:3000. Cách đưa lên git.thaipro.store: [docs/deploy-site.md](docs/deploy-site.md).

## Chưa có

Pull Request của GitLab / Bitbucket.

## English

Thaigit is a free, GitKraken-style Git GUI with a Liquid Glass look. The native macOS app (Swift) is usable today and updates itself from GitHub Releases (Ed25519-signed; just restart to get the new version). A cross-platform Windows + macOS app (Tauri 2) is in progress, with AI commit messages powered by a self-hosted Hermes model (no API key needed, no third party) and opt-in anonymous usage stats. The UI is Vietnamese for now; English is planned.

---

Tác giả: Phan Thái
