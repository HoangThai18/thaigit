// Retention cleanup (runs at startup and every 6 hours; running it repeatedly is harmless):
//  - ai_quota older than 7 days, ai_requests older than 30 days;
//  - daily_active older than 90 days — before deleting, roll them up into daily_counts (counters only, no ids) so they
//    can be kept long term.

import { transaction, type Db } from './db.ts';
import { dayMinus, vnDay } from './time.ts';

export function runRetention(db: Db, now: number): void {
  const today = vnDay(now);
  transaction(db, () => {
    // Roll up every past day (even one not yet due for deletion) so the dashboard reads daily_counts consistently.
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
