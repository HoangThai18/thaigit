/** Cấu hình chung của trang chủ. */
export const SITE = {
  name: 'Thaigit',
  url: 'https://git.thaipro.store',
  title: 'Thaigit — Git client trực quan, miễn phí cho macOS & Windows',
  description:
    'Thaigit là Git GUI miễn phí, trực quan: graph lịch sử nhiều màu, kéo & thả để merge, rebase, push, stage từng dòng, giải conflict vài cú bấm. Tải cho macOS và Windows (bản thử).',
  author: 'Phan Thái',
  repo: 'HoangThai18/thaigit',
} as const;

export const LINKS = {
  github: `https://github.com/${SITE.repo}`,
  releases: `https://github.com/${SITE.repo}/releases`,
  issues: `https://github.com/${SITE.repo}/issues`,
  changelog: `https://github.com/${SITE.repo}/blob/main/CHANGELOG.md`,
  /** Tên file cố định (scripts/release.sh) → luôn là bản macOS mới nhất. Sau này đổi sang /download/mac để đếm lượt tải. */
  downloadMac: `https://github.com/${SITE.repo}/releases/latest/download/Thaigit-macOS.zip`,
  latestReleaseApi: `https://api.github.com/repos/${SITE.repo}/releases/latest`,
  /** Release cố định `desktop-beta` (workflow release-desktop.yml): luôn là bản Windows mới nhất của kênh beta. */
  downloadWindows: `https://github.com/${SITE.repo}/releases/download/desktop-beta/Thaigit-Windows-setup.exe`,
  changelogWindows: `https://github.com/${SITE.repo}/blob/main/apps/desktop/CHANGELOG.md`,
  gitForWindows: 'https://git-scm.com/download/win',
} as const;
