// Quota theo ngày (giờ VN) cho từng cài đặt và tính năng. Mọi thao tác trong transaction; lỗi DB → ném ra để route từ
// chối (fail closed) chứ không cho dùng không giới hạn.

import type { AiFeature } from '@thaigit/contracts';
import { transaction, type Db } from '../db.ts';

export function usedToday(db: Db, day: string, idHash: string): Record<AiFeature, number> {
  const rows = db
    .prepare('SELECT feature, count FROM ai_quota WHERE day = ? AND id_hash = ?')
    .all(day, idHash) as { feature: string; count: number }[];
  const used: Record<AiFeature, number> = { commit: 0, explain: 0, pr: 0 };
  for (const row of rows) {
    if (row.feature in used) used[row.feature as AiFeature] = row.count;
  }
  return used;
}

/** Lấy một lượt nếu còn; `false` khi đã hết. */
export function consumeQuota(
  db: Db,
  day: string,
  idHash: string,
  feature: AiFeature,
  limit: number,
): boolean {
  return transaction(db, () => {
    const row = db
      .prepare('SELECT count FROM ai_quota WHERE day = ? AND id_hash = ? AND feature = ?')
      .get(day, idHash, feature) as { count: number } | undefined;
    const count = row?.count ?? 0;
    if (count >= limit) return false;
    db.prepare(
      `INSERT INTO ai_quota (day, id_hash, feature, count) VALUES (?, ?, ?, 1)
       ON CONFLICT(day, id_hash, feature) DO UPDATE SET count = count + 1`,
    ).run(day, idHash, feature);
    return true;
  });
}

/** Trả lại lượt khi request không ra được kết quả (bận, model lỗi, người dùng huỷ trước chữ đầu). */
export function refundQuota(db: Db, day: string, idHash: string, feature: AiFeature): void {
  db.prepare(
    'UPDATE ai_quota SET count = MAX(0, count - 1) WHERE day = ? AND id_hash = ? AND feature = ?',
  ).run(day, idHash, feature);
}

export interface InstallInfo {
  veteran: boolean;
  blocked: boolean;
}

/** Ghi nhận cài đặt (nếu chưa có) và cho biết có phải "người quen" (thành công ở ≥ 2 ngày khác nhau) / bị chặn. */
export function installInfo(db: Db, idHash: string, day: string): InstallInfo {
  db.prepare('INSERT OR IGNORE INTO ai_installs (id_hash, created_day, ok_days) VALUES (?, ?, 0)').run(
    idHash,
    day,
  );
  const row = db.prepare('SELECT ok_days FROM ai_installs WHERE id_hash = ?').get(idHash) as
    { ok_days: number } | undefined;
  const blocked = db.prepare('SELECT 1 FROM ai_blocked WHERE id_hash = ?').get(idHash) !== undefined;
  return { veteran: (row?.ok_days ?? 0) >= 2, blocked };
}

/** Một request thành công: tăng số ngày dùng được (mỗi ngày tính một lần). */
export function recordSuccess(db: Db, idHash: string, day: string): void {
  db.prepare(
    `UPDATE ai_installs SET ok_days = ok_days + 1, last_ok_day = ?
     WHERE id_hash = ? AND (last_ok_day IS NULL OR last_ok_day <> ?)`,
  ).run(day, idHash, day);
}
