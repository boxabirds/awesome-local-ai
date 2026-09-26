// Date formatting with the browser's built-in Intl (no date library in the main bundle). Story 8 extends this.

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
