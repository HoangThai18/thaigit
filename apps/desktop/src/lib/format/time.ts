/**
 * Shared Vietnamese date/time formatting (a port of the Swift app's `VietnameseDate` + `CommitTable.format`).
 * `Intl` is deliberately not used: its output depends on the machine's ICU data (older WebViews / Windows
 * may lack the `vi` locale). Timestamps are UNIX SECONDS.
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

/** "just now", "3 hours ago", "in 2 days" (when the machine clock is ahead of a future commit). */
export function formatRelative(seconds: number, nowSeconds: number = Date.now() / 1000): string {
  const delta = nowSeconds - seconds;
  if (Math.abs(delta) < MINUTE) return vi.time.justNow;
  return delta > 0 ? vi.time.ago(unitLabel(delta)) : vi.time.inFuture(unitLabel(-delta));
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/** "25/09/2024 21:13" in the machine's time zone. */
export function formatAbsolute(seconds: number): string {
  const date = new Date(seconds * 1000);
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${pad(date.getFullYear(), 4)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * The graph's "Date" column: relative when recent (under 7 days and not more than a minute in the
 * future) and the user asked for relative dates, absolute otherwise — exactly the Swift rule.
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

/** Hours:minutes:seconds in machine local time (git command log) from epoch milliseconds. */
export function formatClock(milliseconds: number): string {
  const date = new Date(milliseconds);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
