import type { Lang } from './i18n';
import type { ShotName } from './shots';

export interface Feature {
  id: string;
  tag: string;
  title: string;
  text: string;
  points: string[];
  shot: ShotName;
}

export const FEATURES: Record<Lang, Feature[]> = {
  vi: [
    {
      id: 'keo-tha',
      tag: 'Kéo & thả',
      title: 'Kéo nhánh, thả lên nhánh — xong merge, rebase hay push',
      text: 'Kéo nhãn nhánh trên graph hoặc ở sidebar rồi thả lên nhánh khác. Luôn có hộp thoại hỏi lại, không có gì chạy ngầm ngoài ý muốn.',
      points: [
        'Nhánh → nhánh: merge, rebase hoặc fast-forward',
        'Nhánh → remote: push; tag → remote: push tag',
        'Kéo file giữa “Chưa stage” và “Đã stage”',
      ],
      shot: 'drag',
    },
    {
      id: 'stage-tung-dong',
      tag: 'Commit sạch',
      title: 'Stage từng dòng, không cần nhớ git add -p',
      text: 'Bấm vào dòng để chọn, Shift+bấm để chọn liên tiếp, rồi Stage dòng hoặc Huỷ dòng. Diff tự xuống dòng và tô sáng đúng phần chữ thay đổi.',
      points: [
        'Theo file, theo hunk hoặc từng dòng',
        'Commit, amend, ⌘↩ để commit nhanh',
        'Giữ nguyên byte: CRLF, file không phải UTF-8',
      ],
      shot: 'diff-lines',
    },
    {
      id: 'conflict',
      tag: 'Xung đột',
      title: 'Giải conflict bằng vài cú bấm',
      text: 'Với mỗi khối xung đột, chọn giữ bản hiện tại, bản kia hoặc cả hai; xem trước rồi “Lưu & đánh dấu đã giải quyết”. Banner luôn cho biết đang merge, rebase hay cherry-pick.',
      points: [
        'Nút Tiếp tục / Bỏ qua / Huỷ ngay trên banner',
        'Mở bằng trình soạn thảo quen thuộc khi cần',
        'Chọn nhanh “Dùng toàn bộ Current / Incoming”',
      ],
      shot: 'conflict',
    },
    {
      id: 'chuyen-nhanh',
      tag: '⌘B',
      title: 'Tìm & chuyển nhánh trong một giây',
      text: 'Nhấn ⌘B, gõ vài chữ, ↑↓ để chọn, Enter để checkout. Đang có thay đổi chưa commit? Gitlane đề xuất “Stash rồi checkout”.',
      points: [
        '15 nhánh dùng gần đây ngay trên thanh công cụ',
        'Nhấp đúp nhánh ở sidebar để checkout',
        'Đặt upstream, đổi tên, xoá nhánh bằng menu chuột phải',
      ],
      shot: 'switch',
    },
    {
      id: 'repo-lon',
      tag: 'Nhanh',
      title: 'Repo lớn vẫn mượt',
      text: 'Repo thử 30.000 commit, gần 1.100 nhánh và tag: graph hiện trong khoảng 1 giây, tải thêm khi cuộn, nhánh gom theo thư mục ở sidebar.',
      points: [
        'Tự làm mới khi file đổi bên ngoài',
        'Tự fetch định kỳ, không làm phiền',
        'Tìm commit theo nội dung, tác giả, SHA',
      ],
      shot: 'large',
    },
  ],
  en: [
    {
      id: 'drag-drop',
      tag: 'Drag & drop',
      title: 'Drag a branch onto another — merge, rebase or push is done',
      text: 'Drag a branch label on the graph or in the sidebar and drop it on another branch. A dialog always asks first, so nothing runs behind your back.',
      points: [
        'Branch → branch: merge, rebase or fast-forward',
        'Branch → remote: push; tag → remote: push the tag',
        'Drag files between “Unstaged” and “Staged”',
      ],
      shot: 'drag',
    },
    {
      id: 'stage-lines',
      tag: 'Clean commits',
      title: 'Stage line by line, no need to remember git add -p',
      text: 'Click a line to select it, Shift+click to select a range, then Stage lines or Discard lines. The diff wraps long lines and highlights exactly the part that changed.',
      points: [
        'By file, by hunk or by single line',
        'Commit, amend, and ⌘↩ for a quick commit',
        'Byte-exact: CRLF and non-UTF-8 files stay intact',
      ],
      shot: 'diff-lines',
    },
    {
      id: 'conflict',
      tag: 'Conflicts',
      title: 'Resolve conflicts in a few clicks',
      text: 'For each conflicting block keep the current side, the other side, or both; preview the result and “Save & mark resolved”. A banner always says whether you are merging, rebasing or cherry-picking.',
      points: [
        'Continue / Skip / Abort right on the banner',
        'Open in your usual editor when you need to',
        'Quick “Use all Current / Incoming”',
      ],
      shot: 'conflict',
    },
    {
      id: 'switch-branch',
      tag: '⌘B',
      title: 'Find and switch branches in a second',
      text: 'Press ⌘B, type a few letters, ↑↓ to choose, Enter to checkout. Uncommitted changes? Gitlane offers “Stash and checkout”.',
      points: [
        'The 15 most recent branches sit right on the toolbar',
        'Double-click a branch in the sidebar to check it out',
        'Set upstream, rename and delete from the right-click menu',
      ],
      shot: 'switch',
    },
    {
      id: 'big-repos',
      tag: 'Fast',
      title: 'Big repos stay smooth',
      text: 'A test repo with 30,000 commits and nearly 1,100 branches and tags: the graph shows in about a second, loads more as you scroll, and branches are grouped by folder in the sidebar.',
      points: [
        'Refreshes itself when files change outside the app',
        'Fetches periodically without getting in the way',
        'Search commits by message, author or SHA',
      ],
      shot: 'large',
    },
  ],
};

export interface SmallFeature {
  title: string;
  text: string;
  icon: 'split' | 'undo' | 'refresh' | 'moon' | 'shield' | 'keyboard';
  colors: [string, string];
}

const SMALL_COLORS: Record<SmallFeature['icon'], [string, string]> = {
  split: ['#4b9bf0', '#1f6fd1'],
  undo: ['#f7764f', '#e2412a'],
  refresh: ['#2fc37a', '#14945a'],
  moon: ['#a17bf7', '#7447e0'],
  shield: ['#21b8cf', '#0b8fa5'],
  keyboard: ['#f7b53b', '#dd8a0c'],
};

const small = (icon: SmallFeature['icon'], title: string, text: string): SmallFeature => ({
  icon,
  title,
  text,
  colors: SMALL_COLORS[icon],
});

export const SMALL_FEATURES: Record<Lang, SmallFeature[]> = {
  vi: [
    small(
      'split',
      'Diff tách đôi & diff ảnh',
      'Xem trước | sau cạnh nhau; file ảnh hiện hai phiên bản để so.',
    ),
    small(
      'undo',
      'Hoàn tác mọi thao tác dễ sai',
      'Commit, huỷ thay đổi, merge, reset, xoá nhánh, xoá stash… đều có nút Hoàn tác.',
    ),
    small('refresh', 'Tự cập nhật', 'Bản mới tải ngầm, kiểm chữ ký; khởi động lại là có tính năng mới.'),
    small('moon', 'Giao diện kính sáng / tối', 'Sáng / tối theo cài đặt của máy, màu lấy từ logo.'),
    small(
      'shield',
      'An toàn khi mở repo lạ',
      'Không chạy lệnh core.fsmonitor hay textconv mà repo tự đặt trong cấu hình.',
    ),
    small(
      'keyboard',
      'Phím tắt cho mọi việc',
      'Fetch, pull, push, stash, stage tất cả, tới HEAD… không cần rời bàn phím.',
    ),
  ],
  en: [
    small(
      'split',
      'Split diff & image diff',
      'See before | after side by side; image files show both versions to compare.',
    ),
    small(
      'undo',
      'Undo the risky stuff',
      'Commit, discard, merge, reset, delete a branch, drop a stash… every one has an Undo button.',
    ),
    small(
      'refresh',
      'Self-updating',
      'New versions download quietly and are signature-checked; restart to get them.',
    ),
    small(
      'moon',
      'Light / dark glass look',
      'Liquid Glass on macOS 26, colors taken from the logo; follows your system setting.',
    ),
    small(
      'shield',
      'Safe on unfamiliar repos',
      'Never runs core.fsmonitor or textconv commands that a repo sets in its own config.',
    ),
    small(
      'keyboard',
      'Shortcuts for everything',
      'Fetch, pull, push, stash, stage all, jump to HEAD… without leaving the keyboard.',
    ),
  ],
};

export interface FaqItem {
  q: string;
  a: string[];
}

export interface HomeFaq extends FaqItem {
  id: 'free' | 'different' | 'privacy' | 'mac-blocked' | 'intel' | 'windows' | 'update' | 'requirements';
}

export const FAQ: Record<Lang, HomeFaq[]> = {
  vi: [
    {
      id: 'free',
      q: 'Gitlane có miễn phí không?',
      a: ['Có. Gitlane miễn phí, không quảng cáo, không cần tài khoản, không giới hạn repo riêng tư.'],
    },
    {
      id: 'different',
      q: 'Gitlane khác các Git client khác ở điểm nào?',
      a: [
        'Gitlane tập trung vào cách làm trực quan — graph nhiều màu, kéo & thả để merge / rebase / push — mà vẫn miễn phí, nhẹ (app native) và có giao diện tiếng Việt. Các thao tác thường ngày cần ít bước và luôn có nút hoàn tác.',
      ],
    },
    {
      id: 'privacy',
      q: 'Code của tôi có bị gửi đi đâu không?',
      a: [
        'Không. Gitlane chạy git ngay trên máy bạn. App chỉ hỏi GitHub Releases để kiểm tra bản cập nhật và không gửi thông tin gì về máy hay repo của bạn.',
      ],
    },
    {
      id: 'mac-blocked',
      q: 'Vì sao macOS báo không mở được Gitlane?',
      a: [
        'Gitlane chưa được ký bằng Apple Developer ID nên lần đầu macOS có thể chặn file dmg tải bằng trình duyệt. Cách nhanh nhất là cài bằng Terminal (không bị chặn): curl -fsSL https://git.thaipro.store/install.sh | sh',
        'Nếu đã tải dmg: vào Cài đặt hệ thống → Quyền riêng tư & Bảo mật → bấm “Vẫn mở”, hoặc chạy xattr -dr com.apple.quarantine /Applications/Gitlane.app',
      ],
    },
    {
      id: 'intel',
      q: 'Gitlane có chạy trên Mac Intel không?',
      a: [
        'Bản tải sẵn được build cho Mac chip Apple (M1 trở lên). Mac Intel có thể build từ mã nguồn bằng Xcode hoặc Command Line Tools. Bản đa nền tảng sắp tới hỗ trợ cả hai.',
      ],
    },
    {
      id: 'windows',
      q: 'Có bản Windows chưa?',
      a: [
        'Có. Gitlane cho Windows 10 / 11 (xây dựng trên Tauri 2): graph, stage từng dòng, commit, fetch / pull / push, merge, rebase, cherry-pick, giải conflict trong app; tự cập nhật.',
        'Cần cài Git for Windows trước. Bản cài chưa ký số nên lần đầu SmartScreen có thể cảnh báo — bấm “More info” → “Run anyway”.',
      ],
    },
    {
      id: 'update',
      q: 'Cập nhật Gitlane thế nào?',
      a: [
        'Tự động: khi app đang mở, cứ mỗi giờ và mỗi lần bạn quay lại cửa sổ app, Gitlane kiểm tra bản mới. Có bản mới thì hiện thông báo — bấm Cài đặt là app tải, kiểm chữ ký rồi mở lại ở bản mới.',
      ],
    },
    {
      id: 'requirements',
      q: 'Tôi cần cài gì thêm không?',
      a: [
        'Chỉ cần git. Trên macOS, git có sẵn khi cài Command Line Tools: chạy xcode-select --install trong Terminal.',
      ],
    },
  ],
  en: [
    {
      id: 'free',
      q: 'Is Gitlane free?',
      a: ['Yes. Gitlane is free, with no ads, no account needed and no limit on private repositories.'],
    },
    {
      id: 'different',
      q: 'How is Gitlane different from other Git clients?',
      a: [
        'Gitlane is built around doing things visually — a colorful graph, drag & drop to merge / rebase / push — while staying free, light (a native app) and with a Vietnamese interface (Vietnamese and English on Windows). Everyday actions take few steps and always come with an Undo button.',
      ],
    },
    {
      id: 'privacy',
      q: 'Does my code get sent anywhere?',
      a: [
        'No. Gitlane runs git right on your machine. The app only asks GitHub Releases whether an update exists and sends nothing about your computer or your repositories.',
      ],
    },
    {
      id: 'mac-blocked',
      q: 'Why does macOS say it can’t open Gitlane?',
      a: [
        'Gitlane is not yet signed with an Apple Developer ID, so macOS may block a dmg downloaded in the browser. The quickest fix is to install from Terminal (no warning): curl -fsSL https://git.thaipro.store/install.sh | sh',
        'If you already downloaded the dmg: open System Settings → Privacy & Security and click “Open Anyway”, or run xattr -dr com.apple.quarantine /Applications/Gitlane.app',
      ],
    },
    {
      id: 'intel',
      q: 'Does Gitlane run on Intel Macs?',
      a: [
        'The ready-made download is built for Apple-silicon Macs (M1 or later). On an Intel Mac you can build from source with Xcode or the Command Line Tools. The upcoming cross-platform build will support both.',
      ],
    },
    {
      id: 'windows',
      q: 'Is there a Windows version?',
      a: [
        'Yes. Gitlane for Windows 10 / 11 (built on Tauri 2) has the graph, line-by-line staging, commit, fetch / pull / push, merge, rebase, cherry-pick and in-app conflict resolution, and it updates itself.',
        'Git for Windows must be installed first. The installer is not code-signed yet, so SmartScreen may warn you the first time — click “More info” → “Run anyway”.',
      ],
    },
    {
      id: 'update',
      q: 'How do I update Gitlane?',
      a: [
        'Automatically: while the app is open it checks every hour and whenever you come back to its window. When a new version is out you get a notification — click Install and the app downloads it, verifies the signature and reopens on the new version.',
      ],
    },
    {
      id: 'requirements',
      q: 'Do I need to install anything else?',
      a: [
        'Only git. On macOS git comes with the Command Line Tools: run xcode-select --install in Terminal.',
      ],
    },
  ],
};
