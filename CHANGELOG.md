# Nhật ký thay đổi

Các thay đổi đáng chú ý của Thaigit. Phiên bản theo [SemVer](https://semver.org/lang/vi/).

## Chưa phát hành

- Khoá SSH riêng của Thaigit (Cài đặt → SSH): tạo khoá Ed25519 hoặc nhập khoá có sẵn, khoá bí mật chỉ nằm trong Keychain của máy (như 1Password) — lệnh git tới remote SSH tự dùng khoá qua một ssh-agent tạm, không cần cấu hình ~/.ssh; thêm khoá lên GitHub một bước, mở trang GitLab để dán, nút kiểm tra kết nối
- Kết nối GitLab (Cài đặt → Tài khoản): đăng nhập gitlab.com hoặc dán personal access token cho cả GitLab tự host của công ty — fetch / pull / push repo HTTPS không phải nhập mật khẩu, token chỉ nằm trong Keychain và tự làm mới khi hết hạn; thêm khoá SSH lên GitLab một bước
- Đăng nhập GitLab.com bằng mã dùng được ngay (bản cài có sẵn OAuth App Thaigit trên GitLab)

## 1.2.0 — 2026-10-05

- Dòng thời gian: Thaigit tự lưu thư mục làm việc mỗi khi file thay đổi (kể cả file chưa commit) để bạn quay lại được khi code bị hỏng — rất hợp khi code cùng AI (Cursor, Claude Code…). Mở bằng nút "Dòng thời gian" ở panel thay đổi hoặc ⌘P; chọn một mốc để xem khác gì so với bây giờ, khôi phục một file hoặc tất cả, luôn hỏi trước và có Hoàn tác
- Mốc chỉ nằm trên máy (trong thư mục .git của repo), không bao giờ được push, không đụng tới phần đã stage, nhánh hay stash; mỗi worktree một dòng thời gian riêng. Mặc định giữ 7 ngày / 300 mốc, chỉnh ở Cài đặt → Git → Dòng thời gian; tắt riêng cho một repo ngay trong panel
- Cảnh báo trước khi commit: panel thay đổi báo khi bạn (hoặc AI) xoá / bỏ qua test, đổi dependency, sửa CI / Docker, thêm file lớn hơn 1 MB, hoặc có file trông như chứa mật khẩu / khoá bí mật — chỉ hiện tên file, không chặn commit
- Giao diện tiếng Anh: chọn ở Cài đặt → Chung → Ngôn ngữ / Language, Thaigit khởi động lại và mở lại các tab đang mở; đủ chuỗi cho mọi màn hình kể cả Dòng thời gian và cảnh báo trước khi commit, số nhiều ("1 file" / "5 files") dịch đúng
- Duyệt thay đổi liên tục: stage, bỏ stage hay huỷ file đang xem thì Thaigit mở luôn file kế tiếp trong danh sách thay vì nhảy sang chỗ khác; nút ↑ / ↓ (kèm "2/5") ở đầu diff và ⇧⌥⌘↑ / ⇧⌥⌘↓ để chuyển file, ⌥⌘↑ / ⌥⌘↓ để nhảy giữa các hunk
- Commit & Push một bước: nút mũi tên cạnh nút Commit hoặc ⌘⇧↩
- Message commit đang gõ dở được giữ riêng cho từng repo — đóng app, đóng tab rồi mở lại vẫn còn
- Push bị từ chối vì remote có commit mới: nút "Pull rồi Push" làm cả hai trong một bước; menu Pull có thêm "Đồng bộ (pull rồi push)"
- Câu chữ giao diện dùng đúng thuật ngữ git quen thuộc (detached HEAD, hard reset, upstream, shallow clone, annotated tag, message, parent…) thay cho các chữ dịch gượng như "HEAD tách rời", "Reset cứng", "lời nhắn"
- Chữ chú giải trên thanh công cụ và thông báo gọi đúng tên lệnh: "Fetch từ mọi remote", "Pull commit mới…", "Push commit của nhánh hiện tại…", "Stash mọi thay đổi chưa commit", "Pop stash mới nhất", "Fetch đầy đủ từ remote", "Chỉ đổi file mode", "Amend thay đổi đã stage…" thay cho "lấy thông tin mới", "đẩy commit", "cất tạm", "lấy lại stash", "gộp thay đổi…"
- Bản tiếng Anh dùng đúng thuật ngữ git (fetch / pull / push / stash / pop / amend / working tree / Git executable) thay cho các cụm diễn giải như "Get the latest information…", "Bring new commits…", "Put all uncommitted changes aside", "Fold the staged changes…"
- Kiểu tài liệu mà app khai báo và dòng bản quyền trong cửa sổ Giới thiệu / Finder đổi sang tiếng Anh ("Folder", "Thaigit — Git client for macOS and Windows") thay vì tiếng Việt
- Câu "chưa có upstream trên remote" dịch thành "no upstream" (trước là "no matching branch on the remote") đúng thuật ngữ git
- Nhiều nhánh / tag cùng một commit: nhãn ưu tiên nhánh đang đứng rồi main / master / develop; bấm viên "+N" để chọn nhánh bị gom lại (Checkout, Merge, Push…)
- Cạnh tên nhánh trên thanh công cụ luôn có số file chưa commit (bấm để về WIP), rê chuột vào tên nhánh để biết nhánh đang theo dõi trên remote
- Rê chuột vào chấm avatar hoặc message trên graph để xem tên người commit và thời gian
- Cùng một thông báo lỗi (vd. bấm checkout hai lần) chỉ hiện một lần
- Nhấp đúp lên một nhãn nhánh trên graph checkout đúng nhánh đó (trước đây lấy nhánh đầu dòng)
- Panel thay đổi: danh sách đang trống (Chưa stage / Đã stage) thu nhỏ để danh sách kia hiện được nhiều file hơn; dải "Nên xem lại trước khi commit" có nút ẩn
- Đầu diff: nút không còn bị cắt chữ, rê chuột vào đường dẫn để xem đủ
- Checkout khi còn thay đổi chưa commit: như GitKraken, Thaigit tự stash, chuyển nhánh rồi mang thay đổi sang nhánh mới — không còn báo lỗi đỏ; nếu thay đổi xung đột với nhánh mới thì bản gốc vẫn giữ trong stash
- Rê chuột vào viên "+N" trên graph hiện ngay danh sách nhánh / tag bị gom
- Đang xem một commit mà còn file chưa commit: đầu panel chi tiết nhắc "N file chưa commit" kèm nút Stage tất cả / Xem & commit
- Diff tô màu cú pháp (từ khoá, chuỗi, comment, số) cho JS / TS, PHP, Swift, Python, Go, Rust, Java / Kotlin, C / C++, C#, CSS, JSON, YAML, shell, SQL, HTML…
- Nút "Bỏ qua khoảng trắng" ở đầu diff (git diff -w) — khi bật chỉ stage / bỏ stage được cả file
- Đầu diff gọn hơn: nút Sửa / Huỷ chỉ còn biểu tượng để tên file hiện đủ
- Nút Undo trên thanh công cụ (như GitKraken): hoàn tác thao tác git gần nhất — commit, checkout, pull, huỷ thay đổi… Nút tự tắt khi repo đã đổi khác sau thao tác đó để không đè lên việc mới
- Danh sách file thay đổi xem được dạng cây thư mục (nút cạnh "Stage tất cả", như Path / Tree của GitKraken): gập / mở thư mục, stage hoặc bỏ stage cả thư mục một lần bấm
- Hàng nút trên thanh công cụ gọn và dễ nhìn hơn: nền sáng, mỗi thao tác một màu biểu tượng (Fetch xanh dương, Pull xanh ngọc, Push xanh lá, Branch tím, Stash / Pop cam), cả giao diện sáng lẫn tối
- Nút Cài đặt và Profile ở góc phải thanh công cụ: avatar tên / email đang dùng để commit, bấm để đổi tên & email Git, chọn tài khoản GitHub / GitLab cho repo hoặc mở Cài đặt
- Trang chủ có nút Cài đặt và Tài khoản GitHub / GitLab ngay dưới Mở / Clone / Tạo repository
- Đăng nhập GitHub bằng mã dùng được ngay: bản cài có sẵn OAuth App Thaigit, không còn báo *Chưa cấu hình*

## 1.1.1 — 2026-10-03

- Thông báo lỗi dễ hiểu hơn: khi một thao tác không thành công, Thaigit chỉ hiện một câu tiếng Việt nói rõ chuyện gì xảy ra và nên làm gì (đăng nhập lại, kiểm tra mạng, commit hoặc stash trước…) thay vì nguyên văn lỗi của git hay của hệ thống; chi tiết kỹ thuật vẫn xem được trong Nhật ký lệnh git

## 1.1.0 — 2026-10-03

- Merge từ repository khác: lấy một nhánh của repo khác (thư mục trên máy hoặc URL) merge vào nhánh của repo đang mở mà không thêm remote; nhớ nguồn đã dùng để lần sau bấm "Merge lại" trong menu Pull; hai repo không chung lịch sử thì hỏi trước khi merge
- Graph mới: node commit là ảnh đại diện thật của tác giả (GitHub / Gravatar, cache trên máy, tắt được); bảng chỉ còn Nhánh / Tag, Graph, Commit — tác giả và thời gian xem ở panel bên phải, bật lại cột Tác giả / Thời gian / SHA bằng chuột phải lên tiêu đề cột
- Nhiều tab: thanh tab tự vẽ ở hàng trên cùng cạnh 3 nút đỏ/vàng/xanh, tab Trang chủ cố định ở đầu, nút ✨ Có gì mới ở cuối, + mở tab mới (chọn repo), × đóng, kéo để đổi chỗ, ⌘1…⌘9 / ⌃Tab để chuyển; mỗi tab giữ repo riêng và được mở lại khi khởi động app; hàng công cụ của repo nằm dưới thanh tab; "Đóng repository" đưa tab về màn hình chọn repo; tab "Có gì mới" đọc nhật ký thay đổi, tự mở sau khi cập nhật
- Đăng nhập GitHub (OAuth Device Flow): nhập mã trên github.com là xong, không cần tự tạo token; fetch / pull / push / clone repo HTTPS trên github.com dùng tài khoản GitHub (host khác và SSH giữ nguyên cách cũ); token mỗi tài khoản cất riêng trong Keychain
- Nhiều tài khoản GitHub cùng lúc (cá nhân, công ty…): mỗi lệnh git chọn token theo owner của repo (owner tự gán → chính tài khoản → tổ chức → tài khoản mặc định); "Tài khoản GitHub cho repo này" trong menu Repository, ghi tên / email commit của tài khoản vào repo sau khi xác nhận; ô commit nhắc khi email khác tài khoản của repo; hộp Clone chọn tài khoản để xem repo; bị GitHub từ chối thì gợi ý đăng nhập lại hoặc dùng tài khoản khác cho owner đó
- Interactive rebase: chuột phải vào commit → "Interactive rebase … từ đây", kéo để đổi thứ tự, chọn pick / reword / squash / fixup / drop, sửa lời commit ngay trong bảng; tự cất thay đổi chưa commit rồi trả lại
- Blame: chuột phải vào file → "Blame — ai sửa từng dòng", mỗi dòng kèm tác giả, thời gian, commit; theo dấu code chuyển từ file khác
- So sánh: giữ ⌘ và bấm 2 commit trên graph, hoặc chuột phải vào nhánh → "So sánh với …" để xem nhánh đó có gì mới so với nhánh hiện tại; panel bên phải liệt kê commit nằm giữa và các file khác nhau, bấm file để xem diff
- Issues GitHub / Jira (⌥⌘J): tạo nhánh từ issue, gắn #số / mã Jira vào commit message, mở trên web; kết nối Jira Cloud bằng API token (Keychain)
- Ký commit GPG / SSH: hộp "Ký commit…" (repo này hoặc mọi repo, chọn khoá), panel commit hiện commit có ký không và nút "Xác minh" (luôn dùng gpg / ssh-keygen thật, bỏ qua gpg.program do repo đặt)
- Git Flow: khởi tạo, bắt đầu / kết thúc feature, release, hotfix (merge --no-ff, tag phiên bản), mục GIT FLOW ở sidebar; báo rõ bước dừng nếu conflict
- Submodule (tải về / cập nhật, mở trong tab mới) và worktree (thêm, mở, xoá) ở sidebar
- Git LFS: pull / fetch / prune, theo dõi kiểu file
- Sửa file ngay trong app: nút "Sửa" trên diff của file chưa stage, ⌘S lưu; giữ BOM, CRLF/LF, quyền +x; hỏi trước khi ghi đè file vừa bị sửa ở nơi khác
- Terminal đơn giản trong app (Control + phím bên trái số 1, hoặc menu Mở → Terminal trong app): chạy lệnh trong thư mục repo, nhớ thư mục sau lệnh cd, lịch sử lệnh, nút Dừng; repo tự làm mới sau mỗi lệnh
- Bảng lệnh ⌘P: tìm và chạy mọi thao tác, checkout / so sánh nhánh, mở Pull Request, chuyển tab, mở repo gần đây; tìm không dấu
- Ẩn / solo nhánh trên graph: nút con mắt khi rê chuột vào nhánh ở sidebar, menu "Ẩn khỏi graph" / "Chỉ hiện nhánh này (solo)", nhớ theo từng repo, dải "Hiện tất cả" ở đáy graph
- Pull Request GitHub: mục PULL REQUESTS ở sidebar (PR đang mở, tự tải lại sau mỗi lần fetch), biểu tượng PR trên nhãn nhánh của graph; checkout nhánh của PR (kể cả PR từ fork), xem thay đổi so với nhánh đích, mở trên GitHub; tạo PR từ nhánh với tiêu đề / mô tả điền sẵn từ commit, tạo dạng nháp, tự push nhánh trước nếu cần
- Revert có hai cách: hỏi "Revert & commit" hay "Revert, chưa commit" — chọn cách sau thì thay đổi đảo ngược chỉ được stage, ô commit điền sẵn message, xem lại rồi commit (hoặc "Hoàn tác"); commit merge được revert so với cha thứ nhất

## 1.0.0 — 2026-10-02

Bản đầu tiên của Thaigit cho macOS.

- Graph lịch sử nhiều màu, nhãn nhánh / tag, dòng WIP cho thay đổi chưa commit
- Kéo & thả: thả nhánh lên nhánh để merge, rebase, fast-forward hoặc push
- Stage / bỏ stage / huỷ theo file, hunk hoặc từng dòng, giữ nguyên từng byte (CRLF, BOM); file không phải UTF-8 chỉ thao tác cả file
- Diff gộp tự xuống dòng, diff tách đôi, diff ảnh
- Giải conflict từng khối; banner merge / rebase / cherry-pick với Tiếp tục / Huỷ
- ⌘B tìm & chuyển nhánh; hoàn tác ngay trên thông báo
- Giao diện kính (Liquid Glass) sáng / tối
- Tự cập nhật qua GitHub Releases, kiểm chữ ký Ed25519
- An toàn khi mở repo lạ: không chạy lệnh `core.fsmonitor` hay `textconv` do repo tự đặt
