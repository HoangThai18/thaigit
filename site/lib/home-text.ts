import type { Lang } from './i18n';
import type { ShotName } from './shots';

interface HomeText {
  hero: {
    eyebrow: string;
    titleLine: string;
    titleGradient: string;
    lead: string;
    checks: string[];
    badges: { drag: string; switch: string; stage: string };
    stats: { value: string; label: string; warm?: boolean }[];
  };
  features: { kicker: string; title: string; text: string };
  look: { kicker: string; title: string };
  gallery: { shot: ShotName; caption: string }[];
  download: {
    kicker: string;
    title: string;
    text: string;
    fit: string;
    macMeta: string;
    macSteps: { first: string; second: string; third: string };
    winMeta: string;
    winButton: string;
    winSteps: { git: string; install: string; smartScreen: string };
    gitForWindows: string;
    moreInfo: string;
    runAnyway: string;
    openAnyway: string;
  };
  changelog: { kicker: string; title: string; latest: string; more: (n: number) => string; all: string };
  guides: { kicker: string; title: string; text: string };
  faq: { kicker: string; title: string };
  english: { title: string; text: string } | null;
  finalCta: { title: string; text: string };
  platforms: { mac: string; windows: string };
}

const vi: HomeText = {
  hero: {
    eyebrow: 'Miễn phí · Không cần tài khoản',
    titleLine: 'Git trực quan, làm bằng chuột.',
    titleGradient: 'Miễn phí, nhẹ, dễ dùng.',
    lead: 'Thaigit giúp bạn làm việc với Git bằng chuột: graph lịch sử nhiều màu, kéo nhánh thả lên nhánh để merge, stage từng dòng, giải conflict trong vài cú bấm — không cần nhớ lệnh.',
    checks: ['macOS 11+ · Windows 10 / 11', 'Tự cập nhật', 'Giao diện tiếng Việt', 'Sáng / tối'],
    badges: { drag: 'Kéo & thả để merge', switch: 'Tìm & chuyển nhánh', stage: 'Stage từng dòng' },
    stats: [
      { value: '≈ 1 giây', label: 'mở repo 30.000 commit' },
      { value: 'Từng dòng', label: 'stage, bỏ stage, huỷ' },
      { value: '1 cú kéo', label: 'merge, rebase, push' },
      { value: '0 đồng', label: 'miễn phí, không quảng cáo', warm: true },
    ],
  },
  features: {
    kicker: 'Tính năng',
    title: 'Mọi việc với Git, gọn trong một cửa sổ',
    text: 'Thaigit gọi thẳng git trên máy bạn nên kết quả giống hệt dùng terminal — chỉ dễ nhìn và dễ bấm hơn.',
  },
  look: { kicker: 'Giao diện', title: 'Đẹp ở cả giao diện sáng lẫn tối' },
  gallery: [
    { shot: 'diff-split', caption: 'Diff tách đôi: trước | sau' },
    { shot: 'image-diff', caption: 'Diff ảnh' },
    { shot: 'welcome', caption: 'Mở, clone hoặc tạo repository' },
  ],
  download: {
    kicker: 'Tải về',
    title: 'Tải Thaigit',
    text: 'Miễn phí, không cần tài khoản. Các bản sau tự cập nhật.',
    fit: 'Phù hợp với máy bạn',
    macMeta: 'macOS 11 trở lên · Mac chip Apple (M1 trở lên)',
    macSteps: {
      first: 'Tải và mở file Thaigit-macOS.dmg.',
      second: 'Kéo Thaigit.app vào thư mục Applications.',
      third: 'Lần đầu mở, nếu macOS chặn: Cài đặt hệ thống → Quyền riêng tư & Bảo mật →',
    },
    winMeta: 'Windows 10 / 11 · 64-bit',
    winButton: 'Tải cho Windows',
    winSteps: {
      git: 'Cần có Git: cài',
      install: 'Mở file Thaigit-Windows-setup.exe để cài (không cần quyền quản trị).',
      smartScreen: 'Bản cài chưa ký số nên lần đầu Windows SmartScreen có thể cảnh báo: bấm',
    },
    gitForWindows: 'Git for Windows',
    moreInfo: 'More info',
    runAnyway: 'Run anyway',
    openAnyway: 'Vẫn mở',
  },
  changelog: {
    kicker: 'Có gì mới',
    title: 'Nhật ký thay đổi',
    latest: 'Bản mới nhất',
    more: (n) => `Xem thêm ${n} thay đổi`,
    all: 'Xem toàn bộ nhật ký thay đổi →',
  },
  guides: {
    kicker: 'Hướng dẫn',
    title: 'Học Git không còn khó',
    text: 'Giải thích ngắn gọn bằng tiếng Việt, có lệnh git và cách làm bằng vài cú bấm.',
  },
  faq: { kicker: 'Hỏi đáp', title: 'Câu hỏi thường gặp' },
  english: {
    title: 'In English',
    text: 'Thaigit is a free, visual Git GUI with a Liquid Glass look: a colorful commit graph, drag-and-drop to merge, rebase or push, line-by-line staging and a friendly conflict resolver. The native macOS app updates itself from GitHub Releases. The Windows app (Tauri 2, Windows 10/11) also updates itself. The macOS UI is Vietnamese; Windows offers Vietnamese and English.',
  },
  finalCta: {
    title: 'Làm việc với Git nhẹ nhàng hơn từ hôm nay',
    text: 'Tải Thaigit miễn phí cho macOS và Windows.',
  },
  platforms: { mac: 'macOS', windows: 'Windows' },
};

const en: HomeText = {
  hero: {
    eyebrow: 'Free · No account needed',
    titleLine: 'Visual Git, driven by your mouse.',
    titleGradient: 'Free, light, easy to use.',
    lead: 'Thaigit lets you work with Git using the mouse: a colorful history graph, drag one branch onto another to merge, stage single lines, resolve conflicts in a few clicks — no commands to memorize.',
    checks: ['macOS 11+ · Windows 10 / 11', 'Self-updating', 'Vietnamese & English UI', 'Light / dark'],
    badges: { drag: 'Drag & drop to merge', switch: 'Find & switch branches', stage: 'Stage line by line' },
    stats: [
      { value: '≈ 1 second', label: 'to open a 30,000-commit repo' },
      { value: 'Line by line', label: 'stage, unstage, discard' },
      { value: '1 drag', label: 'merge, rebase, push' },
      { value: '$0', label: 'free, no ads', warm: true },
    ],
  },
  features: {
    kicker: 'Features',
    title: 'Everything Git, in a single window',
    text: 'Thaigit calls the real git on your machine, so results are identical to the terminal — just easier to see and to click.',
  },
  look: { kicker: 'Look & feel', title: 'Beautiful in both light and dark' },
  gallery: [
    { shot: 'diff-split', caption: 'Split diff: before | after' },
    { shot: 'image-diff', caption: 'Image diff' },
    { shot: 'welcome', caption: 'Open, clone or create a repository' },
  ],
  download: {
    kicker: 'Download',
    title: 'Get Thaigit',
    text: 'Free, no account needed. Later versions update themselves.',
    fit: 'Matches your machine',
    macMeta: 'macOS 11 or later · Apple-silicon Mac (M1 or later)',
    macSteps: {
      first: 'Download and open the Thaigit-macOS.dmg file.',
      second: 'Drag Thaigit.app into the Applications folder.',
      third: 'If macOS blocks it the first time: System Settings → Privacy & Security →',
    },
    winMeta: 'Windows 10 / 11 · 64-bit',
    winButton: 'Download for Windows',
    winSteps: {
      git: 'Git is required: install',
      install: 'Open Thaigit-Windows-setup.exe to install (no admin rights needed).',
      smartScreen:
        'The installer is not code-signed yet, so Windows SmartScreen may warn you the first time: click',
    },
    gitForWindows: 'Git for Windows',
    moreInfo: 'More info',
    runAnyway: 'Run anyway',
    openAnyway: 'Open Anyway',
  },
  changelog: {
    kicker: 'What’s new',
    title: 'Changelog',
    latest: 'Latest version',
    more: (n) => `Show ${n} more changes`,
    all: 'See the full changelog →',
  },
  guides: {
    kicker: 'Guides',
    title: 'Git made approachable',
    text: 'Short, clear explanations with the git commands and the few-clicks way in Thaigit.',
  },
  faq: { kicker: 'FAQ', title: 'Frequently asked questions' },
  english: null,
  finalCta: {
    title: 'Make Git a little easier, starting today',
    text: 'Download Thaigit free for macOS and Windows.',
  },
  platforms: { mac: 'macOS', windows: 'Windows' },
};

export const HOME: Record<Lang, HomeText> = { vi, en };
