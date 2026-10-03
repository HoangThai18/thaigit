// "Ngày" của quota và thống kê là ngày theo giờ Việt Nam (UTC+7, không có giờ mùa hè).

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** "YYYY-MM-DD" theo giờ Việt Nam. */
export function vnDay(now: number): string {
  return new Date(now + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** Ngày lùi `days` ngày so với `day` ("YYYY-MM-DD"). */
export function dayMinus(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);
}

/** 0:00 giờ Việt Nam kế tiếp (ISO, UTC) — lúc quota được làm mới. */
export function nextVnMidnight(now: number): string {
  const startOfVnDay = Date.parse(`${vnDay(now)}T00:00:00Z`) - VN_OFFSET_MS;
  return new Date(startOfVnDay + DAY_MS).toISOString();
}
