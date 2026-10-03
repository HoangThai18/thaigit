// Dọn dữ liệu theo hạn giữ (chạy lúc khởi động và mỗi 6 giờ, chạy lại nhiều lần vô hại):
//  - ai_quota > 7 ngày, ai_requests > 30 ngày;
//  - daily_active > 90 ngày — trước khi xoá gộp vào daily_counts (chỉ số đếm, không ID) để giữ lâu dài.

import { transaction, type Db } from './db.ts';
import { dayMinus, vnDay } from './time.ts';

export function runRetention(db: Db, now: number): void {
  const today = vnDay(now);
  transaction(db, () => {
    // Gộp mọi ngày đã qua (kể cả chưa tới hạn xoá) để dashboard đọc daily_counts thống nhất.
    db.prepare(
      `INSERT INTO daily_counts (day, platform, app_version, dau)
         SELECT day, platform, app_version, COUNT(*) FROM daily_active WHERE day < ?
         GROUP BY day, platform, app_version
       ON CONFLICT(day, platform, app_version) DO UPDATE SET dau = excluded.dau`,
    ).run(today);
    db.prepare('DELETE FROM daily_active WHERE day < ?').run(dayMinus(today, 90));
    db.prepare('DELETE FROM ai_quota WHERE day < ?').run(dayMinus(today, 7));
    db.prepare('DELETE FROM ai_requests WHERE day < ?').run(dayMinus(today, 30));
  });
}
