# Đưa trang chủ lên git.thaipro.store

Trang chủ nằm trong `site/` (Next.js, xuất ra HTML tĩnh ở `site/out`), nên host ở đâu cũng được. Cách khuyên dùng là **GitHub Pages**: miễn phí, tự build mỗi khi push.

## Chạy thử trên máy

```bash
pnpm install
pnpm --filter @thaigit/site dev     # http://localhost:3000 — sửa là thấy ngay
pnpm --filter @thaigit/site build   # xuất trang tĩnh ra site/out
pnpm --filter @thaigit/site start   # xem đúng bản sẽ đăng: http://localhost:3000
```

## Cách 1 — GitHub Pages (khuyên dùng)

Workflow `.github/workflows/site.yml` build rồi đăng trang mỗi khi `main` có thay đổi trong `site/` hoặc `CHANGELOG.md`. Muốn đăng lại bằng tay: tab **Actions → Trang chủ → Run workflow**.

Cài đặt một lần:

1. Trên GitHub, vào repo → **Settings → Pages** → *Build and deployment* → *Source*: chọn **GitHub Actions**.
2. Cùng trang đó, ô *Custom domain*: nhập `git.thaipro.store` rồi bấm **Save**. Pages đăng bằng Actions không đọc file `CNAME`, nên tên miền phải đặt ở đây. File `site/public/CNAME` chỉ có tác dụng khi đổi sang host khác.
3. Ở nơi quản lý DNS của `thaipro.store`, thêm bản ghi:

   | Loại  | Tên   | Giá trị                 |
   | ----- | ----- | ----------------------- |
   | CNAME | `git` | `hoangthai18.github.io` |

   Dùng Cloudflare thì để **DNS only** (đám mây xám), ít nhất cho tới khi GitHub cấp xong chứng chỉ HTTPS.
4. Đợi DNS cập nhật (vài phút đến vài giờ). Quay lại **Settings → Pages** và bật **Enforce HTTPS** khi ô này bấm được.
5. (Nên làm) Xác minh tên miền để không ai chiếm được subdomain: ảnh đại diện GitHub → **Settings → Pages → Add a domain** → `thaipro.store`, rồi thêm bản ghi TXT mà GitHub đưa ra.

Kiểm tra: `dig +short git.thaipro.store` phải ra `hoangthai18.github.io.` và vài IP của GitHub; sau đó mở https://git.thaipro.store.

> Trang được build cho gốc tên miền. Trước khi gắn tên miền, địa chỉ tạm `hoangthai18.github.io/thaigit/` sẽ thiếu CSS và ảnh — đó là chuyện bình thường.

## Cách 2 — VPS (cùng máy chạy Hermes)

DNS: bản ghi **A** `git` → IP của VPS. Build trên máy rồi chép lên:

```bash
pnpm --filter @thaigit/site build
rsync -av --delete site/out/ user@vps:/var/www/git.thaipro.store/
```

Caddy tự lấy chứng chỉ HTTPS:

```caddy
git.thaipro.store {
	root * /var/www/git.thaipro.store
	encode zstd gzip
	header /_next/static/* Cache-Control "public, max-age=31536000, immutable"
	file_server
	handle_errors 404 {
		rewrite * /404.html
		file_server
	}
}
```

## Cách 3 — Host tĩnh khác

Firebase Hosting, Cloudflare Pages, Vercel, Netlify…: lệnh build là `pnpm --filter @thaigit/site build`, thư mục đăng là `site/out`, rồi gắn tên miền trong trang quản lý của host đó. Với Firebase, đặt `"public": "site/out"` và `"trailingSlash": true` trong `firebase.json`, sau đó chạy `npx firebase-tools deploy --only hosting`.

## Sau khi trang chạy

- **Google Search Console**: thêm `https://git.thaipro.store`, xác minh bằng bản ghi TXT, rồi gửi `https://git.thaipro.store/sitemap.xml`.
- **Phát hành bản mới không cần build lại trang.** Nút tải luôn trỏ tới `releases/latest/download/Thaigit-macOS.zip`. Phiên bản, dung lượng và SHA-256 hiện trên trang được trình duyệt lấy thẳng từ GitHub API.
- **Hai ngôn ngữ, hai giao diện**: tiếng Việt ở gốc (`/`), English dưới `/en/`. Nút trên thanh đầu trang đổi ngôn ngữ (sang đúng trang tương ứng) và đổi sáng / tối; mặc định theo hệ điều hành, lựa chọn nhớ trong trình duyệt. Mỗi ngôn ngữ là một layout gốc riêng (`site/app/(vi)`, `site/app/en`) nên thẻ `<html lang>` và `hreflang` đúng ngay trong HTML dựng sẵn.
- **Sửa nội dung** (mỗi file có đủ hai ngôn ngữ):
  - `site/lib/content.ts`: tính năng, câu hỏi thường gặp.
  - `site/lib/home-text.ts`: chữ trang chủ; `site/lib/page-text.ts`: danh sách bài, nhật ký, quyền riêng tư; `site/lib/platform-text.ts`: trang macOS / Windows.
  - `site/lib/ui.ts`: chữ dùng chung (thanh trên, chân trang, nút).
  - `site/lib/guides.ts` (thông tin bài), `guides.vi.ts` và `guides.en.ts` (nội dung): thêm bài hướng dẫn mới thì thêm một mục ở cả ba file và một dòng trong `GUIDE_SLUGS` ở `site/lib/i18n.ts`.
  - `site/lib/site.ts`: tên miền, các link.
  - `CHANGELOG.md`: mục "Có gì mới", đọc lúc build (chỉ có tiếng Việt).
- **Ảnh giao diện**: chụp lại vào `docs/screenshots/`, rồi chạy `python3 site/scripts/make-shots.py` (cần Pillow).
- **Ảnh khi chia sẻ link (Open Graph)**: `site/public/og/vi.png` và `site/public/og/en.png`, cỡ 1200×630, dựng từ `site/scripts/og-image.html` (thêm `#en` vào địa chỉ để ra bản English).
