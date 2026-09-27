const SECOND_MS = 1_000;
const MINUTE_S = 60;
const HOUR_S = 60 * MINUTE_S;
const DAY_S = 24 * HOUR_S;
/** Below this many days, whole days ("3 days ago"); from here, months. */
const MONTH_THRESHOLD_DAYS = 30;
const DAYS_PER_MONTH = 30;
/** From this many days on, just "over a year ago". */
const YEAR_DAYS = 365;

export const JUST_NOW = 'just now';
export const OVER_A_YEAR_AGO = 'over a year ago';

/** Created once per module: Intl formatters are expensive to build. */
const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** "just now", "5 minutes ago", "yesterday", "3 months ago", "over a year ago". */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(iso)) / SECOND_MS));
  if (seconds < MINUTE_S) return JUST_NOW;
  if (seconds < HOUR_S) return formatter.format(-Math.floor(seconds / MINUTE_S), 'minute');
  if (seconds < DAY_S) return formatter.format(-Math.floor(seconds / HOUR_S), 'hour');
  const days = Math.floor(seconds / DAY_S);
  if (days < MONTH_THRESHOLD_DAYS) return formatter.format(-days, 'day');
  if (days < YEAR_DAYS) return formatter.format(-Math.floor(days / DAYS_PER_MONTH), 'month');
  return OVER_A_YEAR_AGO;
}
