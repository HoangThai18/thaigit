# Nhật ký thay đổi

Các thay đổi đáng chú ý của Thaigit. Phiên bản theo [SemVer](https://semver.org/lang/vi/).

## 1.1.1 — 2026-10-03

- Thông báo lỗi dễ hiểu hơn: khi một thao tác không thành công, Thaigit chỉ hiện một câu tiếng Việt nói rõ chuyện gì xảy ra và nên làm gì (đăng nhập lại, kiểm tra mạng, commit hoặc stash trước…) thay vì nguyên văn lỗi của git hay của hệ thống; chi tiết kỹ thuật vẫn xem được trong Nhật ký lệnh git

## 1.1.0 — 2026-10-03

- Merge từ repository khác: lấy một nhánh của repo khác (thư mục trên máy hoặc URL) merge vào nhánh của repo đang mở mà không thêm remote; nhớ nguồn đã dùng để lần sau bấm "Merge lại" trong menu Pull; hai repo không chung lịch sử thì hỏi trước khi merge
- Graph như GitKraken: node commit là ảnh đại diện thật của tác giả (GitHub / Gravatar, cache trên máy, tắt được); bảng chỉ còn Nhánh / Tag, Graph, Commit — tác giả và thời gian xem ở panel bên phải, bật lại cột Tác giả / Thời gian / SHA bằng chuột phải lên tiêu đề cột
- Tab như GitKraken: thanh tab tự vẽ ở hàng trên cùng cạnh 3 nút đỏ/vàng/xanh, tab Trang chủ cố định ở đầu, nút ✨ Có gì mới ở cuối, + mở tab mới (chọn repo), × đóng, kéo để đổi chỗ, ⌘1…⌘9 / ⌃Tab để chuyển; mỗi tab giữ repo riêng và được mở lại khi khởi động app; hàng công cụ của repo nằm dưới thanh tab; "Đóng repository" đưa tab về màn hình chọn repo; tab "Có gì mới" đọc nhật ký thay đổi, tự mở sau khi cập nhật
- Đăng nhập GitHub (OAuth Device Flow, như GitKraken): nhập mã trên github.com là xong, không cần tự tạo token; fetch / pull / push / clone repo HTTPS trên github.com dùng tài khoản GitHub (host khác và SSH giữ nguyên cách cũ); token mỗi tài khoản cất riêng trong Keychain
- Nhiều tài khoản GitHub cùng lúc (cá nhân, công ty…): mỗi lệnh git chọn token theo owner của repo (owner tự gán → chính tài khoản → tổ chức → tài khoản mặc định); "Tài khoản GitHub cho repo này" trong menu Repository, ghi tên / email commit của tài khoản vào repo sau khi xác nhận; ô commit nhắc khi email khác tài khoản của repo; hộp Clone chọn tài khoản để xem repo; bị GitHub từ chối thì gợi ý đăng nhập lại hoặc dùng tài khoản khác cho owner đó
- Interactive rebase: chuột phải vào commit → "Interactive rebase … từ đây", kéo để đổi thứ tự, chọn pick / reword / squash / fixup / drop, sửa lời commit ngay trong bảng; tự cất thay đổi chưa commit rồi trả lại
- Blame: chuột phải vào file → "Blame — ai sửa từng dòng", mỗi dòng kèm tác giả, thời gian, commit; theo dấu code chuyển từ file khác
- So sánh: giữ ⌘ và bấm 2 commit trên graph, hoặc chuột phải vào nhánh → "So sánh với …" để xem nhánh đó có gì mới so với nhánh hiện tại; panel bên phải liệt kê commit nằm giữa và các file khác nhau, bấm file để xem diff
- AI viết commit message (nút ✨): Apple Intelligence chạy trên máy, theo phong cách các commit gần đây, có Hoàn tác
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
- Revert như GitKraken: hỏi "Revert & commit" hay "Revert, chưa commit" — chọn cách sau thì thay đổi đảo ngược chỉ được stage, ô commit điền sẵn message, xem lại rồi commit (hoặc "Hoàn tác"); commit merge được revert so với cha thứ nhất

## 1.0.0 — 2026-10-02

Bản đầu tiên của Thaigit cho macOS.

- Graph lịch sử nhiều màu, nhãn nhánh / tag, dòng WIP cho thay đổi chưa commit
- Kéo & thả như GitKraken: thả nhánh lên nhánh để merge, rebase, fast-forward hoặc push
- Stage / bỏ stage / huỷ theo file, hunk hoặc từng dòng, giữ nguyên từng byte (CRLF, BOM); file không phải UTF-8 chỉ thao tác cả file
- Diff gộp tự xuống dòng, diff tách đôi, diff ảnh
- Giải conflict từng khối; banner merge / rebase / cherry-pick với Tiếp tục / Huỷ
- ⌘B tìm & chuyển nhánh; hoàn tác ngay trên thông báo
- Giao diện kính (Liquid Glass) sáng / tối
- Tự cập nhật qua GitHub Releases, kiểm chữ ký Ed25519
- An toàn khi mở repo lạ: không chạy lệnh `core.fsmonitor` hay `textconv` do repo tự đặt
