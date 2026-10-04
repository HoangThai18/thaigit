# Nhật ký thay đổi — Thaigit cho Windows

Bản đa nền tảng (Tauri) của Thaigit. Phiên bản theo [SemVer](https://semver.org/lang/vi/); bản thử có hậu tố `-beta.N`.

## Chưa phát hành

- Dòng thời gian: Thaigit tự lưu thư mục làm việc mỗi khi file thay đổi (kể cả file chưa commit) để bạn quay lại được khi code bị hỏng — rất hợp khi code cùng AI (Cursor, Claude Code…). Mở bằng nút "Dòng thời gian" ở panel thay đổi hoặc menu Thêm; chọn một mốc để xem khác gì so với bây giờ, khôi phục một file hoặc tất cả, luôn hỏi trước và có Hoàn tác
- Mốc chỉ nằm trên máy (trong thư mục .git của repo), không bao giờ được push, không đụng tới phần đã stage, nhánh hay stash; mỗi worktree một dòng thời gian riêng. Mặc định giữ 7 ngày / 300 mốc, chỉnh ở Cài đặt → Dòng thời gian; tắt riêng cho một repo ngay trong panel
- Cảnh báo trước khi commit: panel thay đổi báo khi bạn (hoặc AI) xoá / bỏ qua test, đổi thư viện phụ thuộc, sửa CI / Docker, thêm file lớn hơn 1 MB, hoặc có file trông như chứa mật khẩu / khoá bí mật — chỉ hiện tên file, không chặn commit
- Giao diện tiếng Anh: chọn ở Cài đặt → Giao diện → Ngôn ngữ / Language
- Tài khoản GitHub / GitLab / Bitbucket (Cài đặt → Tài khoản): dán token hoặc đăng nhập bằng mã; token nằm trong Credential Manager của Windows, fetch / pull / push không phải nhập lại
- Nhiều tài khoản trên cùng một máy chủ (cá nhân + công ty): app tự chọn tài khoản theo owner của repo, hoặc bạn tự gán ở menu Thêm → "Tài khoản cho repo này" (kèm đề nghị ghi tên / email commit của tài khoản đó vào repo)
- Hộp Clone liệt kê repo của tài khoản đã đăng nhập, bấm là điền địa chỉ
- Mục PULL REQUESTS ở sidebar: xem Pull Request / Merge Request đang mở, mở trên web, checkout nhánh của PR (cả PR từ fork trên GitHub / GitLab)
- Tạo Pull Request từ nhánh hiện tại (menu Thêm, hoặc nút + ở mục PULL REQUESTS): chọn nhánh đích, tạo dạng nháp
- Remote từ chối đăng nhập: thông báo có nút "Tài khoản…" để đăng nhập hoặc chọn đúng tài khoản
- Duyệt thay đổi liên tục: stage, bỏ stage hay huỷ file đang xem thì Thaigit mở luôn file kế tiếp thay vì quay về graph; nút ↑ / ↓ (kèm "2/5") ở đầu diff và Alt + Shift + ↑ / ↓ để chuyển file, Alt + ↑ / ↓ để nhảy giữa các hunk
- Commit & Push một bước: nút mũi tên cạnh nút Commit hoặc Ctrl + Shift + Enter
- Message commit đang gõ dở được giữ riêng cho từng repo — đóng app, đổi repo rồi quay lại vẫn còn
- Push bị từ chối vì remote có commit mới: nút "Pull rồi Push" làm cả hai trong một bước; menu Pull có thêm "Đồng bộ (pull rồi push)"
- Tìm & chuyển nhánh (Ctrl + B, hoặc từ nút nhánh trên thanh công cụ): gõ vài chữ (không cần dấu) để lọc mọi nhánh local và remote, Enter để checkout
- Lịch sử file: chuột phải một file → "Lịch sử file" để xem mọi commit đã sửa file đó (kể cả trước khi đổi tên), bấm một commit để xem thay đổi của riêng file ấy
- Blame: chuột phải một file → "Blame" để xem ai sửa từng dòng, commit nào, khi nào; dòng chưa commit được đánh dấu riêng, bấm vào cột trái để nhảy tới commit trên graph
- Rebase tương tác: chuột phải một commit trên graph → "Rebase tương tác từ đây…" để đổi thứ tự, sửa message (reword), gộp commit (squash / fixup) hay bỏ commit (drop) với các commit phía sau nó. Kéo tay nắm hoặc Alt + ↑ / ↓ để đổi chỗ, phím P / R / S / F / D để chọn nhanh. Thay đổi chưa commit được tự cất rồi trả lại; gặp xung đột thì dừng lại như rebase thường; xong có nút Hoàn tác
- Quản lý remote ở sidebar: nút + để thêm remote (fetch luôn nếu muốn), chuột phải một remote để fetch riêng remote đó, sửa địa chỉ, đổi tên, sao chép địa chỉ hoặc xoá (có Hoàn tác)

## 2.0.0 — 2026-10-03

Bản chính thức đầu tiên cho Windows 10 / 11.

- Màn Cài đặt (Ctrl+,): giao diện, lịch sử, đồng bộ, diff, quyền riêng tư, kênh cập nhật Beta / Ổn định
- Thống kê ẩn danh mặc định tắt — chỉ gửi khi bạn bật
- Clone và Tạo repo mới ngay ở màn hình chính
- Diff tách đôi (cũ | mới), xem ảnh cũ / mới cạnh nhau
- Kéo-thả: nhánh lên nhánh để merge / rebase, lên remote để push; file giữa "Chưa stage" và "Đã stage"
- Tìm commit trên graph (Ctrl+F), gõ không dấu vẫn ra
- Mở Terminal, trình soạn thảo, thư mục repo từ menu
- Chế độ an toàn: app không mở lên được vài lần liên tiếp thì tự kiểm bản sửa lỗi
- Repo clone chỉ một nhánh hoặc thiếu lịch sử (thường gặp khi clone từ GitLab / IDE): app báo và có nút "Lấy đầy đủ từ remote" để main cùng các nhánh khác hiện ra
- Mở thêm cửa sổ (Ctrl+T) để làm việc với nhiều repo cùng lúc

## 2.0.0-beta.1 — 2026-10-03

Bản thử đầu tiên cho Windows.

- Graph commit nhiều màu (hàng chục nghìn commit vẫn mượt), sidebar nhánh / remote / tag / stash, panel chi tiết commit
- Stage / bỏ stage / huỷ theo file, theo hunk hoặc từng dòng; xem diff ở vùng giữa (tô phần khác trong dòng, diff rất lớn hỏi trước)
- Commit, amend, "Stage tất cả & commit", Hoàn tác commit
- Fetch / Pull (merge, rebase, chỉ fast-forward) / Push trên thanh công cụ, tiến độ và nút Huỷ; push nhánh mới hỏi remote; bị từ chối thì gợi ý Pull trước / Force push (--force-with-lease); tự fetch nền
- Đổi nhánh nhanh, tạo nhánh, stash / pop; "Stash rồi checkout" khi thay đổi chặn việc đổi nhánh
- Menu chuột phải cho commit, nhánh, tag, stash, file: merge, rebase, cherry-pick, revert (commit ngay hoặc chưa commit), reset soft / mixed / hard, xoá / đổi tên nhánh, tag, xoá trên remote, .gitignore
- Thanh "Đang merge / rebase…" với Tiếp tục / Bỏ qua / Huỷ; giải xung đột từng đoạn ngay trong app (Current / Incoming / cả hai)
- Hầu hết thao tác có "Hoàn tác"; huỷ thay đổi luôn hỏi trước
- Nhật ký lệnh git (menu Thêm)
- Tự cập nhật: kiểm bản mới lúc mở app và mỗi 6 giờ, bản cài có chữ ký số kiểm trước khi cài

Lưu ý: bản cài chưa ký Authenticode nên lần đầu Windows SmartScreen sẽ cảnh báo — bấm "More info" → "Run anyway".
