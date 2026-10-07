import type { Lang } from './i18n';

export const SITE = {
  name: 'Thaigit',
  url: 'https://git.thaipro.store',
  author: 'Phan Thái',
  repo: 'HoangThai18/thaigit',
} as const;

export const SITE_TEXT: Record<Lang, { title: string; description: string; keywords: string[] }> = {
  vi: {
    title: 'Thaigit — Git client trực quan, miễn phí cho macOS & Windows',
    description:
      'Thaigit là Git GUI miễn phí, trực quan: graph lịch sử nhiều màu, kéo & thả để merge, rebase, push, stage từng dòng, giải conflict vài cú bấm. Tải cho macOS và Windows.',
    keywords: [
      'Thaigit',
      'git client',
      'git gui',
      'phần mềm git',
      'git miễn phí',
      'git gui miễn phí',
      'git cho macOS',
      'git cho Windows',
      'stage từng dòng',
      'giải conflict git',
      'git tiếng Việt',
    ],
  },
  en: {
    title: 'Thaigit — a free, visual Git client for macOS & Windows',
    description:
      'Thaigit is a free, visual Git GUI: a colorful commit graph, drag & drop to merge, rebase and push, line-by-line staging, and conflict resolution in a few clicks. Download for macOS and Windows.',
    keywords: [
      'Thaigit',
      'git client',
      'git gui',
      'free git client',
      'git gui for mac',
      'git gui for windows',
      'visual git',
      'stage lines',
      'resolve git conflicts',
      'git drag and drop',
    ],
  },
};

export const LINKS = {
  downloadMac: `${SITE.url}/download/mac`,
  latestReleaseApi: `https://api.github.com/repos/${SITE.repo}/releases/tags/desktop-stable`,
  downloadWindows: `${SITE.url}/download/win`,
  gitForWindows: 'https://git-scm.com/download/win',
} as const;
