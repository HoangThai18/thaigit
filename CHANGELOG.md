# Nhật ký thay đổi

Các thay đổi đáng chú ý của Thaigit. Phiên bản theo [SemVer](https://semver.org/lang/vi/).

## Chưa phát hành

- Merge từ repository khác: lấy một nhánh của repo khác (thư mục trên máy hoặc URL) merge vào nhánh của repo đang mở mà không thêm remote; nhớ nguồn đã dùng để lần sau bấm "Merge lại" trong menu Pull; hai repo không chung lịch sử thì hỏi trước khi merge
- Graph như GitKraken: node commit là ảnh đại diện thật của tác giả (GitHub / Gravatar, cache trên máy, tắt được); bảng chỉ còn Nhánh / Tag, Graph, Commit — tác giả và thời gian xem ở panel bên phải, bật lại cột Tác giả / Thời gian / SHA bằng chuột phải lên tiêu đề cột
- Tab như GitKraken / Chrome: thanh tab luôn hiện với nút + (tab mới, chọn repo) và × (đóng); "Đóng repository" đưa tab về màn hình chọn repo; tab "Có gì mới" đọc nhật ký thay đổi, tự mở sau khi cập nhật
- Đăng nhập GitHub (OAuth Device Flow, như GitKraken): nhập mã trên github.com là xong, không cần tự tạo token; fetch / pull / push / clone repo HTTPS trên github.com dùng tài khoản GitHub (host khác và SSH giữ nguyên cách cũ); token mỗi tài khoản cất riêng trong Keychain
- Nhiều tài khoản GitHub cùng lúc (cá nhân, công ty…): mỗi lệnh git chọn token theo owner của repo (owner tự gán → chính tài khoản → tổ chức → tài khoản mặc định); "Tài khoản GitHub cho repo này" trong menu Repository, ghi tên / email commit của tài khoản vào repo sau khi xác nhận; ô commit nhắc khi email khác tài khoản của repo; hộp Clone chọn tài khoản để xem repo; bị GitHub từ chối thì gợi ý đăng nhập lại hoặc dùng tài khoản khác cho owner đó
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
