import type { Metadata } from 'next';
import { PlatformPage, type PlatformContent } from '@/components/PlatformPage';
import { FAQ, FEATURES } from '@/lib/content';
import { LINKS } from '@/lib/site';
import { pageMetadata } from '@/lib/seo';

const TITLE = 'Thaigit cho macOS — Git client miễn phí, native cho Mac';
const DESCRIPTION =
  'Git GUI miễn phí cho Mac: app native, giao diện Liquid Glass, graph nhiều màu, kéo & thả để merge / rebase / push, stage từng dòng, giải conflict vài cú bấm. macOS 14 trở lên, chip Apple.';

export const metadata: Metadata = pageMetadata({ title: TITLE, description: DESCRIPTION, path: '/mac/' });

const MAC_FAQ = new Set([
  'Thaigit có miễn phí không?',
  'Vì sao macOS báo không mở được Thaigit?',
  'Thaigit có chạy trên Mac Intel không?',
  'Cập nhật Thaigit thế nào?',
  'Tôi cần cài gì thêm không?',
  'Code của tôi có bị gửi đi đâu không?',
]);

const CONTENT: PlatformContent = {
  os: 'mac',
  path: '/mac/',
  crumb: 'macOS',
  h1: 'Thaigit cho macOS — Git client miễn phí, native cho Mac',
  lead: 'App native cho Mac, nhẹ và nhanh, giao diện Liquid Glass sáng / tối theo máy. Graph lịch sử nhiều màu, kéo & thả để merge, rebase hay push, stage từng dòng và giải conflict bằng vài cú bấm — miễn phí, không cần tài khoản.',
  requirements: 'macOS 14 Sonoma trở lên · Mac chip Apple (M1 trở lên)',
  operatingSystem: 'macOS 14+',
  downloadUrl: LINKS.downloadMac,
  features: FEATURES.map((feature) => ({ title: feature.title, text: feature.text, shot: feature.shot })),
  install: [
    'Tải file Thaigit-macOS.zip rồi mở để giải nén.',
    'Kéo Thaigit.app vào thư mục Applications.',
    'Lần đầu mở, nếu macOS chặn: Cài đặt hệ thống → Quyền riêng tư & Bảo mật → Vẫn mở. Hoặc chạy lệnh dưới đây trong Terminal.',
    'Từ đó app tự cập nhật, không cần tải lại.',
  ],
  installCode: 'xattr -dr com.apple.quarantine /Applications/Thaigit.app',
  faq: FAQ.filter((item) => MAC_FAQ.has(item.q)),
};

export default function MacPage() {
  return <PlatformPage content={CONTENT} />;
}
