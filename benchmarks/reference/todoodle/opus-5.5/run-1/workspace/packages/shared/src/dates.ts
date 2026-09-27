// Dates with the browser's built-in Intl (no date library in the main bundle). Story 6 created this file for
// completion dates; story 8 adds calendar-date due dates: validation, UTC calendar arithmetic, the picker's
// shortcuts, classification and the relative chip labels. Pure: no I/O.

import {
  CHIP_WEEKDAY_MAX_OFFSET,
  DAYS_PER_WEEK,
  DUE_DATE_MAX_YEAR,
  DUE_DATE_MIN_YEAR,
  MS_PER_DAY,
  WEEKDAY_MONDAY,
  WEEKDAY_SATURDAY,
  WEEKDAY_SUNDAY,
} from './limits.ts';

const formatters = new Map<string, Intl.DateTimeFormat>();

/** One cached Intl.DateTimeFormat per locale and options (constructing them is costly). */
function formatter(locale: string | undefined, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale ?? ''}|${JSON.stringify(options)}`;
  let cached = formatters.get(key);
  if (!cached) {
    cached = new Intl.DateTimeFormat(locale, options);
    formatters.set(key, cached);
  }
  return cached;
}

const SAME_YEAR: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' };
const OTHER_YEAR: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };

/**
 * A completed task's date: 'Sat, 26 Sep' this year, '26 Sep 2025' in another year (locale order applies).
 * An unparseable value gives ''. `now` decides which year is "this year".
 */
export function formatCompletedDate(iso: string, locale?: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const options = date.getFullYear() === now.getFullYear() ? SAME_YEAR : OTHER_YEAR;
  return formatter(locale, options).format(date);
}

/** Test hook: forget the cached formatters. */
export function clearDateFormattersForTests(): void {
  formatters.clear();
}

// ---------------------------------------------------------------- story 8: due dates

/** A calendar date 'YYYY-MM-DD': no time, no zone. Validate with isCalendarDate / localDateSchema first. */
export type LocalDate = string;

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date in 'YYYY-MM-DD' form (zero padded), year within DUE_DATE_MIN_YEAR..DUE_DATE_MAX_YEAR. */
export function isCalendarDate(value: unknown): value is LocalDate {
  if (typeof value !== 'string') return false;
  const match = CALENDAR_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < DUE_DATE_MIN_YEAR || year > DUE_DATE_MAX_YEAR) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  // Date.UTC maps years 0-99 to 1900-1999; the bounds above already exclude them.
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/** The calendar date of an instant in the runtime's local time zone (the viewer's own date). */
export function localDateOf(instant: Date): LocalDate {
  return `${pad(instant.getFullYear(), 4)}-${pad(instant.getMonth() + 1, 2)}-${pad(instant.getDate(), 2)}`;
}

/** Midnight UTC of a calendar date: calendar arithmetic runs in UTC, so a DST change never shifts a day. */
function utcMidnight(date: LocalDate): number {
  return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
}

function fromUtc(ms: number): LocalDate {
  const date = new Date(ms);
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)}`;
}

/** The date `days` calendar days after `date` (negative: before). */
export function addDays(date: LocalDate, days: number): LocalDate {
  return fromUtc(utcMidnight(date) + days * MS_PER_DAY);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(date: LocalDate): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  return new Date(utcMidnight(date)).getUTCDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

/** 'Next week': the next Monday. On a Monday that is a week later; on a Sunday it is tomorrow. */
export function nextWeek(today: LocalDate): LocalDate {
  const ahead = (WEEKDAY_MONDAY - weekdayOf(today) + DAYS_PER_WEEK) % DAYS_PER_WEEK;
  return addDays(today, ahead === 0 ? DAYS_PER_WEEK : ahead);
}

/** 'This weekend': the coming Saturday, or today on a Saturday or Sunday (the weekend is already underway). */
export function thisWeekend(today: LocalDate): LocalDate {
  const weekday = weekdayOf(today);
  if (weekday === WEEKDAY_SATURDAY || weekday === WEEKDAY_SUNDAY) return today;
  return addDays(today, WEEKDAY_SATURDAY - weekday);
}

/** The picker's shortcuts, in display order. 'none' is No date. */
export type ShortcutId = 'today' | 'tomorrow' | 'weekend' | 'nextWeek' | 'none';

/** The date each dated shortcut resolves to from `today`. */
export function shortcutDates(today: LocalDate): Record<Exclude<ShortcutId, 'none'>, LocalDate> {
  return { today, tomorrow: addDays(today, 1), weekend: thisWeekend(today), nextWeek: nextWeek(today) };
}

/** The picker's keys: T Today, M Tomorrow, W This weekend, N Next week, 0 No date. */
export const SHORTCUT_KEYS: Readonly<Record<string, ShortcutId>> = Object.freeze({
  t: 'today',
  m: 'tomorrow',
  w: 'weekend',
  n: 'nextWeek',
  '0': 'none',
});

/** Whole calendar days from `today` to `due` (negative when due is in the past). */
export function dayOffset(due: LocalDate, today: LocalDate): number {
  return Math.round((utcMidnight(due) - utcMidnight(today)) / MS_PER_DAY);
}

export type DateClass = 'none' | 'overdue' | 'today' | 'future';

/** Where a due date stands for a viewer whose local date is `today`. */
export function classify(due: LocalDate | null, today: LocalDate): DateClass {
  if (due === null) return 'none';
  return due < today ? 'overdue' : due === today ? 'today' : 'future';
}

export type ChipTone = 'overdue' | 'today' | 'tomorrow' | 'neutral';
export type ChipLabel = { text: string; tone: ChipTone; srLabel: string; showWarningIcon: boolean };

// Formatted as a UTC instant at the date's midnight, so the runtime's zone never moves the day.
const WEEKDAY_LONG: Intl.DateTimeFormatOptions = { weekday: 'long', timeZone: 'UTC' };
const SHORT_DATE: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', timeZone: 'UTC' };
const SHORT_DATE_YEAR: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' };
const SHORTCUT_DATE: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' };
const FULL_DATE: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' };

/**
 * Formats a calendar date. Recent ICU spells September 'Sept' in en-GB short months; the PRD's labels use the
 * three-letter 'Sep', so a four-letter 'Sept' month part is shortened.
 */
function formatDate(date: LocalDate, locale: string | undefined, options: Intl.DateTimeFormatOptions): string {
  return formatter(locale, options)
    .formatToParts(new Date(utcMidnight(date)))
    .map((part) => (part.type === 'month' && part.value === 'Sept' ? 'Sep' : part.value))
    .join('');
}

/** A shortcut's date: 'Sat 26 Sep' (en-GB). */
export function formatShortcutDate(date: LocalDate, locale?: string): string {
  return formatDate(date, locale, SHORTCUT_DATE);
}

/** The full spoken form: 'Saturday 26 September' (en-GB). Accessible names use it. */
export function formatFullDate(date: LocalDate, locale?: string): string {
  return formatDate(date, locale, FULL_DATE);
}

/**
 * A dated task's chip, relative to the viewer's `today` (prd.date_chip, prd.overdue_accessible): 'Today',
 * 'Tomorrow', the weekday name for 2..CHIP_WEEKDAY_MAX_OFFSET days ahead, 'Yesterday' / 'N days overdue' with a
 * warning icon when overdue, otherwise a short date with the year only when it differs from today's year. The
 * screen-reader label says 'Overdue: due <full date>' for overdue dates and 'Due <text>' otherwise.
 */
export function chipLabel(due: LocalDate, today: LocalDate, locale?: string): ChipLabel {
  const offset = dayOffset(due, today);
  if (offset < 0) {
    const text = offset === -1 ? 'Yesterday' : `${-offset} days overdue`;
    return { text, tone: 'overdue', srLabel: `Overdue: due ${formatFullDate(due, locale)}`, showWarningIcon: true };
  }
  let text: string;
  let tone: ChipTone = 'neutral';
  if (offset === 0) {
    text = 'Today';
    tone = 'today';
  } else if (offset === 1) {
    text = 'Tomorrow';
    tone = 'tomorrow';
  } else if (offset <= CHIP_WEEKDAY_MAX_OFFSET) {
    text = formatDate(due, locale, WEEKDAY_LONG);
  } else {
    text = formatDate(due, locale, due.slice(0, 4) === today.slice(0, 4) ? SHORT_DATE : SHORT_DATE_YEAR);
  }
  return { text, tone, srLabel: `Due ${text}`, showWarningIcon: false };
}

/** Milliseconds from `now` to the next local midnight (correct across DST: a 23 h or 25 h day). */
export function msUntilNextLocalMidnight(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next.getTime() - now.getTime();
}
