const SECOND_MS = 1000;
const MINUTE_S = 60;
const HOUR_S = 60 * MINUTE_S;
const DAY_S = 24 * HOUR_S;
/** Below this many days, show days ('yesterday', '3 days ago'); from here, months. */
const MONTH_DAYS = 30;
/** From this many days on, the time reads 'over a year ago'. */
const YEAR_DAYS = 365;

export const JUST_NOW = 'just now';
export const OVER_A_YEAR = 'over a year ago';

// Created once and reused for every row (js-cache-function-results); numeric:'auto' gives 'yesterday'.
const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** 'just now' under a minute, then minutes, hours, days, months, and 'over a year ago'. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(iso)) / SECOND_MS));
  if (seconds < MINUTE_S) return JUST_NOW;
  if (seconds < HOUR_S) return formatter.format(-Math.floor(seconds / MINUTE_S), 'minute');
  if (seconds < DAY_S) return formatter.format(-Math.floor(seconds / HOUR_S), 'hour');
  const days = Math.floor(seconds / DAY_S);
  if (days < MONTH_DAYS) return formatter.format(-days, 'day');
  if (days < YEAR_DAYS) return formatter.format(-Math.floor(days / MONTH_DAYS), 'month');
  return OVER_A_YEAR;
}
