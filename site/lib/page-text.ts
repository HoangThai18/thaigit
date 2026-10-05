import type { Lang } from './i18n';

interface PageText {
  guides: {
    metaTitle: string;
    metaDescription: string;
    kicker: string;
    h1: string;
    lead: string;
    chips: (count: number) => string[];
  };
  changelog: {
    metaTitle: string;
    metaDescription: string;
    h1: string;
    lead: string;
    note: string | null;
  };
  privacy: {
    metaTitle: string;
    metaDescription: string;
    h1: string;
    updated: string;
    sections: { heading: string; text: string }[];
    contact: (author: string) => string;
    contactHeading: string;
  };
}

const vi: PageText = {
  guides: {
    metaTitle: 'Hướng dẫn Git cho người mới — dễ hiểu, có hình',
    metaDescription:
      'Các bài hướng dẫn Git bằng tiếng Việt: giải conflict, stage từng dòng, hoàn tác commit, merge và rebase, git stash, cherry-pick, .gitignore, SSH — kèm lệnh và cách làm trực quan bằng Thaigit.',
    kicker: 'Hướng dẫn',
    h1: 'Hướng dẫn Git cho người mới',
    lead: 'Những việc hay gặp khi làm việc với Git, giải thích ngắn gọn bằng tiếng Việt. Mỗi bài có lệnh git để làm trên Terminal và cách làm bằng vài cú bấm trong Thaigit.',
    chips: (count) => [`${count} bài viết`, 'Có hình minh hoạ', 'Lệnh & cách bấm chuột'],
  },
  changelog: {
    metaTitle: 'Nhật ký thay đổi — Thaigit có gì mới',
    metaDescription:
      'Toàn bộ tính năng mới và sửa lỗi của Thaigit qua từng phiên bản, cho cả macOS và Windows.',
    h1: 'Nhật ký thay đổi',
    lead: 'Những gì mới trong từng phiên bản Thaigit. App tự cập nhật, bạn không cần tải lại.',
    note: null,
  },
  privacy: {
    metaTitle: 'Quyền riêng tư',
    metaDescription:
      'Thaigit gửi gì, khi nào và tới đâu: tự cập nhật, thống kê ẩn danh có đồng ý, trang web này.',
    h1: 'Quyền riêng tư',
    updated: 'Cập nhật ngày 05/10/2026',
    sections: [
      {
        heading: 'Tóm tắt',
        text: 'Thaigit chạy git ngay trên máy của bạn. Code, tên repo, đường dẫn và lịch sử commit không rời khỏi máy.',
      },
      {
        heading: 'Tự cập nhật',
        text: 'App hỏi GitHub Releases (lúc mở và mỗi 6 giờ) để biết có bản mới không, rồi tải file cài đặt từ GitHub. Yêu cầu này không kèm mã định danh hay thông tin nào về máy hoặc repo của bạn; GitHub thấy địa chỉ IP như mọi lượt tải. Bản Windows chọn được kênh Beta hoặc Ổn định trong Cài đặt.',
      },
      {
        heading: 'Thống kê ẩn danh (mặc định tắt)',
        text: 'Nếu bạn bật (bản Windows: màn hình chính hoặc Cài đặt → Quyền riêng tư), app gửi tối đa mỗi ngày một lần: một mã ngẫu nhiên, hệ điều hành, kiến trúc máy và phiên bản app — để biết có bao nhiêu người đang dùng bản nào. Không gửi tên repo, đường dẫn, code hay email; máy chủ không lưu IP và chỉ lưu mã dạng băm. Dữ liệu theo từng máy giữ 90 ngày, sau đó chỉ còn số đếm theo ngày. Tắt là xoá mã.',
      },
      {
        heading: 'Trang web này',
        text: 'Trang git.thaipro.store là trang tĩnh: không dùng cookie, không có mã theo dõi hay quảng cáo. Khi mở trang, trình duyệt hỏi GitHub để hiện số phiên bản mới nhất; nhà cung cấp hosting có thể ghi nhật ký truy cập thông thường (địa chỉ IP, thời gian). Lựa chọn giao diện sáng / tối được lưu ngay trong trình duyệt của bạn, không gửi đi đâu.',
      },
    ],
    contactHeading: 'Liên hệ',
    contact: (author) => `Câu hỏi về quyền riêng tư: gửi email cho ${author}.`,
  },
};

const en: PageText = {
  guides: {
    metaTitle: 'Git guides for beginners — clear and illustrated',
    metaDescription:
      'Git guides in plain English: resolve conflicts, stage line by line, undo a commit, merge vs rebase, git stash, cherry-pick, .gitignore, SSH keys — with the commands and the point-and-click way in Thaigit.',
    kicker: 'Guides',
    h1: 'Git guides for beginners',
    lead: 'The things you run into most often with Git, explained briefly. Each guide shows the git commands for the terminal and the few-clicks way in Thaigit.',
    chips: (count) => [`${count} guides`, 'Illustrated', 'Commands & point-and-click'],
  },
  changelog: {
    metaTitle: 'Changelog — what’s new in Thaigit',
    metaDescription: 'Every new feature and fix in Thaigit, version by version, for macOS and Windows.',
    h1: 'Changelog',
    lead: 'What is new in each version of Thaigit. The app updates itself, no need to download again.',
    note: 'Release notes are written in Vietnamese.',
  },
  privacy: {
    metaTitle: 'Privacy',
    metaDescription:
      'What Thaigit sends, when and where: self-updating, opt-in anonymous statistics, and this website.',
    h1: 'Privacy',
    updated: 'Updated October 5, 2026',
    sections: [
      {
        heading: 'In short',
        text: 'Thaigit runs git right on your machine. Your code, repository names, paths and commit history never leave it.',
      },
      {
        heading: 'Self-updating',
        text: 'The app asks GitHub Releases (on launch and every 6 hours) whether a new version exists, then downloads the installer from GitHub. The request carries no identifier or information about your machine or repositories; GitHub sees your IP address like for any download. On Windows you can pick the Beta or Stable channel in Settings.',
      },
      {
        heading: 'Anonymous statistics (off by default)',
        text: 'If you turn it on (Windows: the home screen or Settings → Privacy), the app sends at most once a day: a random ID, the operating system, the architecture and the app version — to learn how many people use which version. It sends no repository names, paths, code or emails; the server does not store IPs and keeps only a hashed ID. Per-device data is kept for 90 days, after which only daily counts remain. Turning it off deletes the ID.',
      },
      {
        heading: 'This website',
        text: 'git.thaipro.store is a static site: no cookies, no tracking scripts or ads. When you open it, your browser asks GitHub for the latest version number; the hosting provider may keep ordinary access logs (IP address, time). Your light / dark and language choices are stored only in your own browser and are not sent anywhere.',
      },
    ],
    contactHeading: 'Contact',
    contact: (author) => `Privacy questions: email ${author}.`,
  },
};

export const PAGE_TEXT: Record<Lang, PageText> = { vi, en };
