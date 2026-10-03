import type { ShotName } from './shots';

export interface Feature {
  id: string;
  tag: string;
  title: string;
  text: string;
  points: string[];
  shot: ShotName;
}

/** Tính năng chính — ảnh + chữ xen kẽ. */
export const FEATURES: Feature[] = [
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
    text: 'Nhấn ⌘B, gõ vài chữ, ↑↓ để chọn, Enter để checkout. Đang có thay đổi chưa commit? Thaigit đề xuất “Stash rồi checkout”.',
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
];

export interface SmallFeature {
  title: string;
  text: string;
  icon: 'split' | 'undo' | 'refresh' | 'moon' | 'shield' | 'keyboard';
  colors: [string, string];
}

export const SMALL_FEATURES: SmallFeature[] = [
  {
    title: 'Diff tách đôi & diff ảnh',
    text: 'Xem trước | sau cạnh nhau; file ảnh hiện hai phiên bản để so.',
    icon: 'split',
    colors: ['#4b9bf0', '#1f6fd1'],
  },
  {
    title: 'Hoàn tác mọi thao tác dễ sai',
    text: 'Commit, huỷ thay đổi, merge, reset, xoá nhánh, xoá stash… đều có nút Hoàn tác.',
    icon: 'undo',
    colors: ['#f7764f', '#e2412a'],
  },
  {
    title: 'Tự cập nhật',
    text: 'Bản mới tải ngầm, kiểm chữ ký; khởi động lại là có tính năng mới.',
    icon: 'refresh',
    colors: ['#2fc37a', '#14945a'],
  },
  {
    title: 'Giao diện kính sáng / tối',
    text: 'Liquid Glass trên macOS 26, màu lấy từ logo; tự theo chế độ của máy.',
    icon: 'moon',
    colors: ['#a17bf7', '#7447e0'],
  },
  {
    title: 'An toàn khi mở repo lạ',
    text: 'Không chạy lệnh core.fsmonitor hay textconv mà repo tự đặt trong cấu hình.',
    icon: 'shield',
    colors: ['#21b8cf', '#0b8fa5'],
  },
  {
    title: 'Phím tắt cho mọi việc',
    text: 'Fetch, pull, push, stash, stage tất cả, tới HEAD… không cần rời bàn phím.',
    icon: 'keyboard',
    colors: ['#f7b53b', '#dd8a0c'],
  },
];

export interface FaqItem {
  q: string;
  a: string[];
}

export const FAQ: FaqItem[] = [
  {
    q: 'Thaigit có miễn phí không?',
    a: ['Có. Thaigit miễn phí, không quảng cáo, không cần tài khoản, không giới hạn repo riêng tư.'],
  },
  {
    q: 'Thaigit khác các Git client khác ở điểm nào?',
    a: [
      'Thaigit tập trung vào cách làm trực quan — graph nhiều màu, kéo & thả để merge / rebase / push — mà vẫn miễn phí, nhẹ (app native) và có giao diện tiếng Việt. Các thao tác thường ngày cần ít bước và luôn có nút hoàn tác.',
    ],
  },
  {
    q: 'Code của tôi có bị gửi đi đâu không?',
    a: [
      'Không. Thaigit chạy git ngay trên máy bạn. App chỉ hỏi GitHub Releases để kiểm tra bản cập nhật và không gửi thông tin gì về máy hay repo của bạn.',
    ],
  },
  {
    q: 'Vì sao macOS báo không mở được Thaigit?',
    a: [
      'Thaigit chưa được ký bằng Apple Developer ID nên lần đầu macOS có thể chặn. Vào Cài đặt hệ thống → Quyền riêng tư & Bảo mật → bấm “Vẫn mở”.',
      'Hoặc chạy trong Terminal: xattr -dr com.apple.quarantine /Applications/Thaigit.app',
    ],
  },
  {
    q: 'Thaigit có chạy trên Mac Intel không?',
    a: [
      'Bản tải sẵn được build cho Mac chip Apple (M1 trở lên). Mac Intel có thể build từ mã nguồn bằng Xcode hoặc Command Line Tools. Bản đa nền tảng sắp tới hỗ trợ cả hai.',
    ],
  },
  {
    q: 'Có bản Windows chưa?',
    a: [
      'Có. Thaigit cho Windows 10 / 11 (xây dựng trên Tauri 2): graph, stage từng dòng, commit, fetch / pull / push, merge, rebase, cherry-pick, giải conflict trong app; tự cập nhật.',
      'Cần cài Git for Windows trước. Bản cài chưa ký số nên lần đầu SmartScreen có thể cảnh báo — bấm “More info” → “Run anyway”.',
    ],
  },
  {
    q: 'Cập nhật Thaigit thế nào?',
    a: [
      'Tự động: app kiểm tra mỗi 6 giờ, tải bản mới ngầm và kiểm chữ ký. Bạn chỉ cần khởi động lại — hoặc cứ thoát app, lần mở sau đã là bản mới.',
    ],
  },
  {
    q: 'Tôi cần cài gì thêm không?',
    a: [
      'Chỉ cần git. Trên macOS, git có sẵn khi cài Command Line Tools: chạy xcode-select --install trong Terminal.',
    ],
  },
];
