# Nhật ký thay đổi — Thaigit cho Windows

Bản đa nền tảng (Tauri) của Thaigit. Phiên bản theo [SemVer](https://semver.org/lang/vi/); bản thử có hậu tố `-beta.N`.

## Chưa phát hành

- AI viết commit message (nút ✨ Viết bằng AI, Ctrl+Shift+G): chữ hiện dần, Dừng / Tạo lại / Hoàn tác, chọn ngôn ngữ, độ dài, Conventional Commits; hỏi đồng ý và cho xem đúng dữ liệu sẽ gửi trước lần đầu, tự bỏ file nhạy cảm và đoạn trông như mật khẩu / token
- Giải thích commit và viết mô tả Pull Request bằng AI
- Màn Cài đặt (Ctrl+,): giao diện, lịch sử, đồng bộ, diff, AI, quyền riêng tư, kênh cập nhật Beta / Ổn định
- Thống kê ẩn danh mặc định tắt — chỉ gửi khi bạn bật
- Clone và Tạo repo mới ngay ở màn hình chính
- Diff tách đôi (cũ | mới), xem ảnh cũ / mới cạnh nhau
- Kéo-thả: nhánh lên nhánh để merge / rebase, lên remote để push; file giữa "Chưa stage" và "Đã stage"
- Tìm commit trên graph (Ctrl+F), gõ không dấu vẫn ra
- Mở Terminal, trình soạn thảo, thư mục repo từ menu
- Chế độ an toàn: app không mở lên được vài lần liên tiếp thì tự kiểm bản sửa lỗi

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
