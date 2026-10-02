/**
 * Định dạng ngày giờ tiếng Việt dùng chung (port `VietnameseDate` + `CommitTable.format` của app Swift). Không dùng `Intl`:
 * kết quả không phụ thuộc dữ liệu ICU của máy (WebView cũ/Windows có thể thiếu locale `vi`). Thời điểm là GIÂY UNIX.
 */
import { vi } from '../strings.vi.ts';

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86_400;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

function unitLabel(seconds: number): string {
  if (seconds < HOUR) return vi.time.minutes(Math.floor(seconds / MINUTE));
  if (seconds < DAY) return vi.time.hours(Math.floor(seconds / HOUR));
  if (seconds < WEEK) return vi.time.days(Math.floor(seconds / DAY));
  if (seconds < MONTH) return vi.time.weeks(Math.floor(seconds / WEEK));
  if (seconds < YEAR) return vi.time.months(Math.floor(seconds / MONTH));
  return vi.time.years(Math.floor(seconds / YEAR));
}

/** "vừa xong", "3 giờ trước", "sau 2 ngày" (giờ máy lệch với commit tương lai). */
export function formatRelative(seconds: number, nowSeconds: number = Date.now() / 1000): string {
  const delta = nowSeconds - seconds;
  if (Math.abs(delta) < MINUTE) return vi.time.justNow;
  return delta > 0 ? vi.time.ago(unitLabel(delta)) : vi.time.inFuture(unitLabel(-delta));
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/** "25/09/2024 21:13" theo múi giờ máy. */
export function formatAbsolute(seconds: number): string {
  const date = new Date(seconds * 1000);
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${pad(date.getFullYear(), 4)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Cột "Thời gian" của graph: tương đối khi mới (dưới 7 ngày, không ở tương lai quá 1 phút) và người dùng bật tương đối,
 * còn lại tuyệt đối — đúng luật của bản Swift.
 */
export function formatCommitTime(
  seconds: number,
  options: { relative: boolean; nowSeconds?: number },
): string {
  const now = options.nowSeconds ?? Date.now() / 1000;
  const delta = now - seconds;
  if (options.relative && delta < WEEK && delta > -MINUTE) return formatRelative(seconds, now);
  return formatAbsolute(seconds);
}
