# Kiểm thử bản Windows (beta) trước khi phát hành

CI đã tự kiểm trên `windows-latest` và `macos-15` mỗi lần push: kiểu (TS + Svelte), test TS (core, contracts, app, máy chủ — git thật), clippy, test Rust, build debug và **kiểm thử khói** (mở app thật, chờ giao diện gọi `app_ready`, thoát mã 0 — `scripts/smoke-app.mjs`). Những mục dưới đây cần máy Windows thật vì CI không làm được (GCM, trình cài NSIS, WebView2 trên máy người dùng, chuột thật).

Đánh dấu từng mục; lỗi ghi vào issue kèm phiên bản (*Thêm → Kiểm tra cập nhật…* hiện số phiên bản).

## 1. Cài đặt và cập nhật

- [ ] Tải `Thaigit-Windows-setup.exe` từ trang chủ → SmartScreen cảnh báo (chưa ký) → *More info → Run anyway* → cài cho người dùng hiện tại, không hỏi quyền admin.
- [ ] Mở từ Start menu; gỡ cài đặt từ *Settings → Apps* sạch sẽ.
- [ ] Có bản mới trên kênh Beta → thanh cập nhật hiện trong ≤ 20 giây sau khi mở → *Cập nhật ngay* → tải, kiểm chữ ký, cài (NSIS passive) → app tự mở lại đúng phiên bản mới.
- [ ] Đang có lệnh git chạy (vd. push lớn) thì cài cập nhật phải đợi lệnh xong.
- [ ] Cài đặt → Kênh cập nhật: đổi Beta ↔ Ổn định, khởi động lại vẫn giữ lựa chọn.
- [ ] Chế độ an toàn: tắt app bằng Task Manager ngay khi vừa mở 3 lần liên tiếp (trước khi giao diện lên) → lần thứ 4 hiện hộp thoại "chế độ an toàn".

## 2. Đăng nhập remote

- [ ] HTTPS tới GitHub với Git Credential Manager (mặc định của Git for Windows): fetch / pull / push, cửa sổ đăng nhập của GCM hiện ra và lần sau không hỏi lại.
- [ ] Remote HTTPS không có GCM (`git config --global --unset credential.helper`): app tự hỏi tên đăng nhập / mật khẩu trong hộp thoại của Thaigit (askpass), Huỷ được.
- [ ] SSH có passphrase: hỏi passphrase trong app; khoá không passphrase chạy thẳng.
- [ ] Sai mật khẩu / token hết hạn: chỉ hiện câu "Remote từ chối đăng nhập…", không hiện stderr.

## 3. Thao tác git hằng ngày

- [ ] Clone (HTTPS và SSH) vào thư mục có dấu tiếng Việt và dấu cách; Huỷ giữa chừng dọn thư mục dở.
- [ ] Tạo repo mới (nhánh `main`).
- [ ] Stage / bỏ stage / huỷ cả file, từng hunk, từng dòng — kể cả file CRLF và file có BOM; kéo file giữa "Chưa stage" và "Đã stage".
- [ ] Diff gộp / tách đôi; diff ảnh PNG / JPG.
- [ ] Commit, amend, hoàn tác commit; merge / rebase có xung đột → giải trong app → tiếp tục; huỷ thao tác dở.
- [ ] Kéo nhánh ở sidebar hoặc nhãn trên graph thả lên nhánh khác → menu Merge / Rebase; thả lên remote → Push.
- [ ] Stash / pop, tag, cherry-pick, revert (cả "chưa commit"), reset.
- [ ] Tìm commit (Ctrl+F) với chữ không dấu.
- [ ] Mở Terminal / trình soạn thảo / thư mục từ menu Thêm và menu chuột phải file.
- [ ] Repo 30 000 commit: mở < 1 giây, cuộn mượt.
- [ ] Repo có hook / `core.fsmonitor`: hiện hộp "Tin tưởng repo này?" trước khi chạy bất cứ gì.

## 4. AI viết commit (cần máy chủ đã dựng — `docs/deploy-server.md`)

- [ ] Lần đầu bấm *✨ Viết bằng AI*: hộp đồng ý hiện trước khi có bất kỳ request nào; *Xem dữ liệu sẽ gửi* liệt kê đúng file; `.env`, khoá SSH, lockfile chỉ có tên.
- [ ] Chữ hiện dần; Dừng giữa chừng trả ô soạn về như cũ; Tạo lại; Hoàn tác.
- [ ] Hết lượt / máy chủ tắt AI (`touch …/ai-disabled`) / máy chủ tắt hẳn: chỉ hiện câu tiếng Việt, app vẫn dùng bình thường.
- [ ] Giải thích commit, mô tả PR: markdown hiện đúng, link chỉ là chữ, Sao chép được.
- [ ] Cài đặt → AI → *Tắt AI*: lần sau phải đồng ý lại.

## 5. Quyền riêng tư

- [ ] Mở lần đầu: thẻ "Giúp Thaigit tốt hơn?" — chọn *Không, cảm ơn* thì không có request nào tới `/v1/telemetry/ping` (kiểm bằng Fiddler / trang admin không tăng DAU).
- [ ] Bật thống kê → trang admin có thêm 1 máy trong ngày; mở lại app cùng ngày không tăng.
- [ ] Nhật ký lệnh git (menu Thêm) không chứa token / mật khẩu.

## 6. Giao diện

- [ ] Sáng / tối / theo hệ thống; tắt hiệu ứng kính; màn hình 125 % / 150 % (chữ nét, không vỡ bố cục).
- [ ] Cửa sổ hẹp (≈ 900 px): thanh công cụ chỉ còn biểu tượng, ô soạn commit không tràn.
- [ ] Bàn phím: Ctrl+Shift+L (pull), Ctrl+Shift+P (push), Ctrl+Alt+F (fetch), Ctrl+Shift+B (nhánh mới), Ctrl+F (tìm), Ctrl+, (cài đặt), Ctrl+Shift+G (AI), Esc đóng diff / hộp thoại.

## Đã biết (chưa làm trong beta)

- Đăng nhập GitHub ngay trong app (OAuth Device Flow) cần Client ID của GitHub OAuth App — bản Swift cũng đang để trống. Trên Windows, Git Credential Manager đã lo đăng nhập GitHub.
- Mỗi repo một cửa sổ (Ctrl+T mở cửa sổ mới) chưa có; hiện đóng repo để về màn hình chính rồi mở repo khác.
- Bản cài chưa ký số (SmartScreen cảnh báo) cho tới khi có chứng chỉ ký mã Windows.
