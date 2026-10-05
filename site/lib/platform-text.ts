import type { HomeFaq } from './content';
import type { Lang } from './i18n';
import type { ShotName } from './shots';

export interface PlatformFeature {
  title: string;
  text: string;
  shot?: ShotName;
}

export interface PlatformText {
  metaTitle: string;
  metaDescription: string;
  h1: string;
  lead: string;
  requirements: string;
  operatingSystem: string;
  install: string[];
  installCode?: string;
  features: PlatformFeature[] | 'home';
  faqIds: HomeFaq['id'][];
}

export interface PlatformLabels {
  install: string;
  features: string;
  faq: string;
  learn: string;
}

export const PLATFORM_LABELS: Record<Lang, PlatformLabels> = {
  vi: {
    install: 'Cài đặt',
    features: 'Tính năng chính',
    faq: 'Câu hỏi thường gặp',
    learn: 'Học Git nhanh hơn',
  },
  en: {
    install: 'Install',
    features: 'Key features',
    faq: 'Frequently asked questions',
    learn: 'Learn Git faster',
  },
};

export const PLATFORM_TEXT: Record<'mac' | 'win', Record<Lang, PlatformText>> = {
  mac: {
    vi: {
      metaTitle: 'Thaigit cho macOS — Git client miễn phí, native cho Mac',
      metaDescription:
        'Git GUI miễn phí cho Mac: app native, giao diện Liquid Glass, graph nhiều màu, kéo & thả để merge / rebase / push, stage từng dòng, giải conflict vài cú bấm. macOS 14 trở lên, chip Apple.',
      h1: 'Thaigit cho macOS — Git client miễn phí, native cho Mac',
      lead: 'App native cho Mac, nhẹ và nhanh, giao diện Liquid Glass sáng / tối theo máy. Graph lịch sử nhiều màu, kéo & thả để merge, rebase hay push, stage từng dòng và giải conflict bằng vài cú bấm — miễn phí, không cần tài khoản.',
      requirements: 'macOS 14 Sonoma trở lên · Mac chip Apple (M1 trở lên)',
      operatingSystem: 'macOS 14+',
      install: [
        'Tải file Thaigit-macOS.zip rồi mở để giải nén.',
        'Kéo Thaigit.app vào thư mục Applications.',
        'Lần đầu mở, nếu macOS chặn: Cài đặt hệ thống → Quyền riêng tư & Bảo mật → Vẫn mở. Hoặc chạy lệnh dưới đây trong Terminal.',
        'Từ đó app tự cập nhật, không cần tải lại.',
      ],
      installCode: 'xattr -dr com.apple.quarantine /Applications/Thaigit.app',
      features: 'home',
      faqIds: ['free', 'mac-blocked', 'intel', 'update', 'requirements', 'privacy'],
    },
    en: {
      metaTitle: 'Thaigit for macOS — a free, native Git client for Mac',
      metaDescription:
        'A free Git GUI for Mac: a native app with a Liquid Glass look, colorful graph, drag & drop to merge / rebase / push, line-by-line staging and conflict resolution in a few clicks. macOS 14 or later, Apple silicon.',
      h1: 'Thaigit for macOS — a free, native Git client for Mac',
      lead: 'A native Mac app that is light and fast, with a Liquid Glass look that follows your light / dark setting. A colorful history graph, drag & drop to merge, rebase or push, line-by-line staging and conflict resolution in a few clicks — free, no account needed.',
      requirements: 'macOS 14 Sonoma or later · Apple-silicon Mac (M1 or later)',
      operatingSystem: 'macOS 14+',
      install: [
        'Download Thaigit-macOS.zip and open it to unzip.',
        'Drag Thaigit.app into the Applications folder.',
        'If macOS blocks it the first time: System Settings → Privacy & Security → Open Anyway. Or run the command below in Terminal.',
        'From then on the app updates itself, no need to download again.',
      ],
      installCode: 'xattr -dr com.apple.quarantine /Applications/Thaigit.app',
      features: 'home',
      faqIds: ['free', 'mac-blocked', 'intel', 'update', 'requirements', 'privacy'],
    },
  },
  win: {
    vi: {
      metaTitle: 'Thaigit cho Windows — Git GUI miễn phí cho Windows 10 / 11',
      metaDescription:
        'Git client miễn phí, giao diện tiếng Việt cho Windows 10 / 11: graph lịch sử nhiều màu, kéo & thả để merge / rebase / push, stage từng dòng, giải conflict, rebase tương tác, nút hoàn tác. Tự cập nhật.',
      h1: 'Thaigit cho Windows — Git GUI miễn phí, giao diện tiếng Việt',
      lead: 'Git client trực quan cho Windows 10 / 11: xem graph lịch sử nhiều màu, kéo & thả nhánh để merge, rebase hay push, stage từng dòng, giải conflict ngay trong app và hoàn tác thao tác lỡ tay. Miễn phí, không quảng cáo, không cần tài khoản.',
      requirements: 'Windows 10 / 11 · 64-bit',
      operatingSystem: 'Windows 10, Windows 11',
      install: [
        'Cài Git for Windows nếu máy chưa có (git-scm.com/download/win).',
        'Tải và mở Thaigit-Windows-setup.exe để cài — không cần quyền quản trị.',
        'Bản cài chưa ký số nên lần đầu Windows SmartScreen có thể cảnh báo: bấm More info → Run anyway.',
        'Từ đó app tự cập nhật; chọn kênh Ổn định hoặc Beta trong Cài đặt.',
      ],
      features: [
        {
          title: 'Graph lịch sử nhiều màu, dễ đọc',
          text: 'Mỗi nhánh một màu, nhãn nhánh và tag ngay trên graph. Tìm commit theo nội dung, tác giả hoặc SHA; repo lớn vẫn cuộn mượt.',
        },
        {
          title: 'Kéo nhánh, thả lên nhánh — merge, rebase hay push',
          text: 'Kéo nhãn nhánh rồi thả lên nhánh khác hoặc lên remote. Luôn có hộp thoại hỏi lại trước khi chạy.',
        },
        {
          title: 'Stage từng dòng, commit gọn gàng',
          text: 'Chọn dòng trong diff rồi Stage dòng hoặc Huỷ dòng. Theo file, theo hunk hay từng dòng đều được; amend commit trước bằng một ô chọn.',
        },
        {
          title: 'Giải conflict bằng vài cú bấm',
          text: 'Với mỗi khối xung đột, chọn Giữ Current, Giữ Incoming hoặc cả hai, rồi “Lưu & đánh dấu đã giải quyết”. Banner cho biết đang merge, rebase hay cherry-pick.',
        },
      ],
      faqIds: ['free', 'windows', 'update', 'privacy'],
    },
    en: {
      metaTitle: 'Thaigit for Windows — a free Git GUI for Windows 10 / 11',
      metaDescription:
        'A free Git client for Windows 10 / 11 in Vietnamese and English: colorful history graph, drag & drop to merge / rebase / push, line-by-line staging, conflict resolution, interactive rebase and Undo. Updates itself.',
      h1: 'Thaigit for Windows — a free Git GUI',
      lead: 'A visual Git client for Windows 10 / 11: a colorful history graph, drag a branch onto another to merge, rebase or push, stage single lines, resolve conflicts right in the app and undo slips. Free, no ads, no account needed. The interface comes in Vietnamese and English.',
      requirements: 'Windows 10 / 11 · 64-bit',
      operatingSystem: 'Windows 10, Windows 11',
      install: [
        'Install Git for Windows if you do not have it yet (git-scm.com/download/win).',
        'Download and open Thaigit-Windows-setup.exe to install — no admin rights needed.',
        'The installer is not code-signed yet, so Windows SmartScreen may warn you the first time: click More info → Run anyway.',
        'From then on the app updates itself; pick the Stable or Beta channel in Settings.',
      ],
      features: [
        {
          title: 'A colorful, readable history graph',
          text: 'One color per branch, with branch and tag labels right on the graph. Search commits by message, author or SHA; large repos still scroll smoothly.',
        },
        {
          title: 'Drag a branch onto another — merge, rebase or push',
          text: 'Drag a branch label and drop it on another branch or on a remote. A dialog always asks before anything runs.',
        },
        {
          title: 'Stage line by line, commit cleanly',
          text: 'Select lines in the diff, then Stage lines or Discard lines. Work by file, hunk or single line; amend the previous commit with one checkbox.',
        },
        {
          title: 'Resolve conflicts in a few clicks',
          text: 'For each conflicting block choose Keep Current, Keep Incoming or both, then “Save & mark resolved”. A banner says whether you are merging, rebasing or cherry-picking.',
        },
      ],
      faqIds: ['free', 'windows', 'update', 'privacy'],
    },
  },
};
