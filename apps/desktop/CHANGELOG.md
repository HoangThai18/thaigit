# Nhật ký thay đổi — Thaigit cho Windows

Bản đa nền tảng (Tauri) của Thaigit. Phiên bản theo [SemVer](https://semver.org/lang/vi/); bản thử có hậu tố `-beta.N`.

## 2.0.0-beta.1 — 2026-10-03

Bản thử đầu tiên cho Windows.

- Graph commit như GitKraken (hàng chục nghìn commit vẫn mượt), sidebar nhánh / remote / tag / stash, panel chi tiết commit
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
