/** Cấu hình chung của trang chủ. */
export const SITE = {
  name: 'Thaigit',
  url: 'https://git.thaipro.store',
  title: 'Thaigit — Git client trực quan, miễn phí cho macOS & Windows',
  description:
    'Thaigit là Git GUI miễn phí, trực quan: graph lịch sử nhiều màu, kéo & thả để merge, rebase, push, stage từng dòng, giải conflict vài cú bấm. Tải cho macOS và Windows.',
  author: 'Phan Thái',
  repo: 'HoangThai18/thaigit',
} as const;

export const LINKS = {
  /** Qua máy chủ Thaigit để đếm lượt tải (không lưu IP) rồi chuyển tới file cố định trên GitHub Releases: bản macOS mới nhất. */
  downloadMac: `${SITE.url}/download/mac`,
  latestReleaseApi: `https://api.github.com/repos/${SITE.repo}/releases/latest`,
  /** Như trên, tới release cố định `desktop-stable` (workflow release-desktop.yml): bản Windows chính thức mới nhất. */
  downloadWindows: `${SITE.url}/download/win`,
  gitForWindows: 'https://git-scm.com/download/win',
} as const;
