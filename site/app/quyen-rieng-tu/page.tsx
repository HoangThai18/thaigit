import type { Metadata } from 'next';
import { LINKS } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Quyền riêng tư',
  description: 'Thaigit gửi gì, khi nào và tới đâu: tự cập nhật, AI viết commit (sắp có), thống kê ẩn danh có đồng ý, trang web này.',
  alternates: { canonical: '/quyen-rieng-tu/' },
};

export default function PrivacyPage() {
  return (
    <article className="prose container">
      <h1>Quyền riêng tư</h1>
      <p className="updated">Cập nhật ngày 02/10/2026</p>

      <h2>Tóm tắt</h2>
      <p>
        Thaigit chạy git ngay trên máy của bạn. Code, tên repo, đường dẫn và lịch sử commit không rời khỏi máy — trừ khi bạn tự
        bấm dùng tính năng AI (sắp có) và đã đồng ý.
      </p>

      <h2>Tự cập nhật</h2>
      <p>
        App hỏi GitHub Releases (lúc mở và mỗi 6 giờ) để biết có bản mới không, rồi tải file cài đặt từ GitHub. Yêu cầu này không
        kèm mã định danh hay thông tin nào về máy hoặc repo của bạn; GitHub thấy địa chỉ IP như mọi lượt tải. Có thể tắt trong
        Cài đặt của app.
      </p>

      <h2>AI viết commit (sắp có)</h2>
      <ul>
        <li>Chỉ chạy khi bạn bấm nút AI và đã đồng ý ở lần đầu; tắt được bất cứ lúc nào.</li>
        <li>
          App gửi phần thay đổi đã chọn, đã lọc trước (tự bỏ <code>.env</code>, khoá bí mật, lockfile, file nhị phân) tới máy chủ
          của Thaigit.
        </li>
        <li>Model Hermes chạy ngay trên máy chủ đó — không gửi cho bên thứ ba nào.</li>
        <li>Máy chủ không lưu nội dung code hay message; chỉ giữ số liệu kỹ thuật (số yêu cầu, thời gian xử lý) trong 30 ngày.</li>
      </ul>

      <h2>Thống kê ẩn danh (sắp có, chỉ khi bạn đồng ý)</h2>
      <p>
        Nếu bạn bật, app gửi tối đa mỗi ngày một lần: mã cài đặt ngẫu nhiên, hệ điều hành và phiên bản app — để biết có bao nhiêu
        người đang dùng. Không gửi tên repo, đường dẫn, code hay email. Dữ liệu giữ 90 ngày.
      </p>

      <h2>Trang web này</h2>
      <p>
        Trang git.thaipro.store là trang tĩnh: không dùng cookie, không có mã theo dõi hay quảng cáo. Khi mở trang, trình duyệt
        hỏi GitHub để hiện số phiên bản mới nhất; nhà cung cấp hosting có thể ghi nhật ký truy cập thông thường (địa chỉ IP, thời
        gian).
      </p>

      <h2>Liên hệ</h2>
      <p>
        Câu hỏi về quyền riêng tư: mở issue trên <a href={LINKS.issues}>GitHub</a>.
      </p>
    </article>
  );
}
