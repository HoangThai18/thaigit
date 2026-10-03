import type { Metadata } from 'next';
import { LINKS } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Quyền riêng tư',
  description:
    'Thaigit gửi gì, khi nào và tới đâu: tự cập nhật, AI viết commit, thống kê ẩn danh có đồng ý, trang web này.',
  alternates: { canonical: '/quyen-rieng-tu/' },
};

export default function PrivacyPage() {
  return (
    <article className="prose container">
      <h1>Quyền riêng tư</h1>
      <p className="updated">Cập nhật ngày 03/10/2026</p>

      <h2>Tóm tắt</h2>
      <p>
        Thaigit chạy git ngay trên máy của bạn. Code, tên repo, đường dẫn và lịch sử commit không rời khỏi máy
        — trừ khi bạn tự bấm dùng tính năng AI của bản Windows và đã đồng ý.
      </p>

      <h2>Tự cập nhật</h2>
      <p>
        App hỏi GitHub Releases (lúc mở và mỗi 6 giờ) để biết có bản mới không, rồi tải file cài đặt từ
        GitHub. Yêu cầu này không kèm mã định danh hay thông tin nào về máy hoặc repo của bạn; GitHub thấy địa
        chỉ IP như mọi lượt tải. Bản Windows chọn được kênh Beta hoặc Ổn định trong Cài đặt.
      </p>

      <h2>AI viết commit</h2>
      <p>
        Bản macOS dùng Apple Intelligence ngay trên máy — code không rời khỏi máy. Bản Windows dùng model
        Hermes trên máy chủ của Thaigit:
      </p>
      <ul>
        <li>
          Chỉ chạy khi bạn bấm nút AI và đã đồng ý ở lần đầu (xem được đúng dữ liệu sẽ gửi); tắt được bất cứ
          lúc nào.
        </li>
        <li>
          App gửi phần thay đổi đã chọn, đã lọc trước (tự bỏ <code>.env</code>, khoá bí mật, lockfile, file
          sinh tự động, file nhị phân và mọi đoạn trông như mật khẩu hay token), tên nhánh và tiêu đề 10
          commit gần nhất tới máy chủ của Thaigit, kèm một mã cài đặt ngẫu nhiên để tính lượt dùng mỗi ngày.
        </li>
        <li>Model Hermes chạy ngay trên máy chủ đó — không gửi cho bên thứ ba nào.</li>
        <li>
          Máy chủ không lưu nội dung code hay message, không lưu địa chỉ IP; chỉ giữ số liệu kỹ thuật (số
          token, thời gian xử lý, mã lỗi) trong 30 ngày. Mã cài đặt chỉ lưu dạng băm.
        </li>
      </ul>

      <h2>Thống kê ẩn danh (mặc định tắt)</h2>
      <p>
        Nếu bạn bật (bản Windows: màn hình chính hoặc Cài đặt → Quyền riêng tư), app gửi tối đa mỗi ngày một
        lần: một mã ngẫu nhiên (khác mã dùng cho AI), hệ điều hành, kiến trúc máy và phiên bản app — để biết
        có bao nhiêu người đang dùng bản nào. Không gửi tên repo, đường dẫn, code hay email; máy chủ không lưu
        IP và chỉ lưu mã dạng băm. Dữ liệu theo từng máy giữ 90 ngày, sau đó chỉ còn số đếm theo ngày. Tắt là
        xoá mã.
      </p>

      <h2>Trang web này</h2>
      <p>
        Trang git.thaipro.store là trang tĩnh: không dùng cookie, không có mã theo dõi hay quảng cáo. Khi mở
        trang, trình duyệt hỏi GitHub để hiện số phiên bản mới nhất; nhà cung cấp hosting có thể ghi nhật ký
        truy cập thông thường (địa chỉ IP, thời gian).
      </p>

      <h2>Liên hệ</h2>
      <p>
        Câu hỏi về quyền riêng tư: mở issue trên <a href={LINKS.issues}>GitHub</a>.
      </p>
    </article>
  );
}
