// Daily quota (Vietnam time) per install and feature. Every operation runs in a transaction; a DB error is thrown so the
// route refuses the request (fail closed) instead of granting unlimited use.

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

/** Take one unit if any remain; `false` when exhausted. */
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

/** Give the unit back when a request produced no result (busy, model error, the user cancelled before the first token). */
export function refundQuota(db: Db, day: string, idHash: string, feature: AiFeature): void {
  db.prepare(
    'UPDATE ai_quota SET count = MAX(0, count - 1) WHERE day = ? AND id_hash = ? AND feature = ?',
  ).run(day, idHash, feature);
}

export interface InstallInfo {
  veteran: boolean;
  blocked: boolean;
}

/** Register the install (if new) and report whether it counts as "familiar" (successful on ≥ 2 distinct days) or is blocked. */
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

/** A successful request: increase the count of days used (counted once per day). */
export function recordSuccess(db: Db, idHash: string, day: string): void {
  db.prepare(
    `UPDATE ai_installs SET ok_days = ok_days + 1, last_ok_day = ?
     WHERE id_hash = ? AND (last_ok_day IS NULL OR last_ok_day <> ?)`,
  ).run(day, idHash, day);
}
