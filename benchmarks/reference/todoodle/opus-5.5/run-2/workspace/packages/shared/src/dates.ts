/*
 * Date formatting with the browser's built-in Intl (no date library in the main bundle).
 * Formatter construction is expensive, so instances are cached per locale and options.
 * Story 8 extends this module.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

/** A cached Intl.DateTimeFormat for this locale and options (constructed once per key). */
export function dateFormatter(locale: string | undefined, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale ?? ''}|${JSON.stringify(options)}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    formatters.set(key, formatter);
  }
  return formatter;
}

const SAME_YEAR: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' };
const OTHER_YEAR: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };

/**
 * Parses a stored timestamp: ISO 8601, or SQLite's `YYYY-MM-DD HH:MM:SS` (UTC). Null when invalid.
 */
export function parseTimestamp(value: string | null | undefined): Date | null {
  if (!value) return null;
  const normalised = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(value) ? `${value.replace(' ', 'T')}Z` : value;
  const date = new Date(normalised);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * A task's completion date: "Sat, 26 Sept" this year, "26 Sept 2025" in another year (wording
 * follows the locale). An invalid or missing timestamp is ''.
 */
export function formatCompletedDate(iso: string | null | undefined, locale?: string, now: Date = new Date()): string {
  const date = parseTimestamp(iso);
  if (!date) return '';
  const options = date.getFullYear() === now.getFullYear() ? SAME_YEAR : OTHER_YEAR;
  return dateFormatter(locale, options).format(date);
}
