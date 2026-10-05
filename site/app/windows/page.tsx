import type { Metadata } from 'next';
import { PlatformPage, type PlatformContent } from '@/components/PlatformPage';
import { FAQ } from '@/lib/content';
import { LINKS } from '@/lib/site';
import { pageMetadata } from '@/lib/seo';

const TITLE = 'Thaigit cho Windows — Git GUI miễn phí cho Windows 10 / 11';
const DESCRIPTION =
  'Git client miễn phí, giao diện tiếng Việt cho Windows 10 / 11: graph lịch sử nhiều màu, kéo & thả để merge / rebase / push, stage từng dòng, giải conflict, rebase tương tác, nút hoàn tác. Tự cập nhật.';

export const metadata: Metadata = pageMetadata({ title: TITLE, description: DESCRIPTION, path: '/windows/' });

const WINDOWS_FAQ = new Set([
  'Thaigit có miễn phí không?',
  'Có bản Windows chưa?',
  'Cập nhật Thaigit thế nào?',
  'Code của tôi có bị gửi đi đâu không?',
]);

const CONTENT: PlatformContent = {
  os: 'win',
  path: '/windows/',
  crumb: 'Windows',
  h1: 'Thaigit cho Windows — Git GUI miễn phí, giao diện tiếng Việt',
  lead: 'Git client trực quan cho Windows 10 / 11: xem graph lịch sử nhiều màu, kéo & thả nhánh để merge, rebase hay push, stage từng dòng, giải conflict ngay trong app và hoàn tác thao tác lỡ tay. Miễn phí, không quảng cáo, không cần tài khoản.',
  requirements: 'Windows 10 / 11 · 64-bit',
  operatingSystem: 'Windows 10, Windows 11',
  downloadUrl: LINKS.downloadWindows,
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
  install: [
    'Cài Git for Windows nếu máy chưa có (git-scm.com/download/win).',
    'Tải và mở Thaigit-Windows-setup.exe để cài — không cần quyền quản trị.',
    'Bản cài chưa ký số nên lần đầu Windows SmartScreen có thể cảnh báo: bấm More info → Run anyway.',
    'Từ đó app tự cập nhật; chọn kênh Ổn định hoặc Beta trong Cài đặt.',
  ],
  faq: FAQ.filter((item) => WINDOWS_FAQ.has(item.q)),
};

export default function WindowsPage() {
  return <PlatformPage content={CONTENT} />;
}
