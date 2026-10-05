// A quota or analytics "day" is a Vietnam-time day (UTC+7, no daylight saving).

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** "YYYY-MM-DD" in Vietnam time. */
export function vnDay(now: number): string {
  return new Date(now + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** `days` before `day` ("YYYY-MM-DD"). */
export function dayMinus(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);
}

/** Next midnight in Vietnam time (ISO, UTC) — when the quota resets. */
export function nextVnMidnight(now: number): string {
  const startOfVnDay = Date.parse(`${vnDay(now)}T00:00:00Z`) - VN_OFFSET_MS;
  return new Date(startOfVnDay + DAY_MS).toISOString();
}
