# Nhật ký thay đổi

Các thay đổi đáng chú ý của Thaigit. Phiên bản theo [SemVer](https://semver.org/lang/vi/).

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
