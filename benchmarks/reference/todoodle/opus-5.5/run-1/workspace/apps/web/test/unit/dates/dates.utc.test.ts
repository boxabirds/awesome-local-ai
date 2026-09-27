// Story 8, dates.local_date_logic in UTC. TZ is set before any date is made (each zone has its own file).
const previousTz = process.env.TZ;
process.env.TZ = 'UTC';

import { CHIP_WEEKDAY_MAX_OFFSET, DUE_DATE_MAX_YEAR, DUE_DATE_MIN_YEAR } from '@todoodle/shared/limits';
import {
  SHORTCUT_KEYS,
  addDays,
  chipLabel,
  classify,
  clearDateFormattersForTests,
  dayOffset,
  formatFullDate,
  formatShortcutDate,
  isCalendarDate,
  localDateOf,
  nextWeek,
  shortcutDates,
  thisWeekend,
  weekdayOf,
} from '@todoodle/shared/dates';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

// Later files in this worker get the zone they started with.
afterAll(() => {
  if (previousTz === undefined) delete process.env.TZ;
  else process.env.TZ = previousTz;
});

const NOW = new Date('2026-09-25T12:00:00Z');
const TODAY = localDateOf(NOW);

afterEach(() => clearDateFormattersForTests());

describe('TC-01..TC-09 classification and chips (UTC, 2026-09-25T12:00Z)', () => {
  it('the viewer date is 2026-09-25', () => {
    expect(TODAY).toBe('2026-09-25');
  });

  it('TC-01 no date: NoDate, not in Today', () => {
    expect(classify(null, TODAY)).toBe('none');
  });

  it.each([
    ['TC-02', '2026-09-20', 'overdue', '5 days overdue', 'overdue', true],
    ['TC-03', '2026-09-24', 'overdue', 'Yesterday', 'overdue', true],
    ['TC-04', '2026-09-25', 'today', 'Today', 'today', false],
    ['TC-05', '2026-09-26', 'future', 'Tomorrow', 'tomorrow', false],
    ['TC-06', '2026-09-27', 'future', 'Sunday', 'neutral', false],
    ['TC-07', '2026-10-01', 'future', 'Thursday', 'neutral', false],
    ['TC-08', '2026-10-02', 'future', '2 Oct', 'neutral', false],
    ['TC-09', '2027-01-04', 'future', '4 Jan 2027', 'neutral', false],
  ] as const)('%s due %s: %s, %j (%s tone, icon %s)', (_tc, due, cls, text, tone, icon) => {
    expect(classify(due, TODAY)).toBe(cls);
    const label = chipLabel(due, TODAY, 'en-GB');
    expect(label.text).toBe(text);
    expect(label.tone).toBe(tone);
    expect(label.showWarningIcon).toBe(icon);
  });

  it('the weekday boundary is CHIP_WEEKDAY_MAX_OFFSET (6): +6 is a weekday, +7 a short date', () => {
    expect(CHIP_WEEKDAY_MAX_OFFSET).toBe(6);
    expect(chipLabel(addDays(TODAY, 2), TODAY, 'en-GB').text).toBe('Sunday');
    expect(chipLabel(addDays(TODAY, 6), TODAY, 'en-GB').text).toBe('Thursday');
    expect(chipLabel(addDays(TODAY, 7), TODAY, 'en-GB').text).toBe('2 Oct');
  });

  it('a short date in the past of another year never happens: overdue always wins', () => {
    expect(chipLabel('2025-12-31', TODAY, 'en-GB').text).toBe('268 days overdue');
  });
});

describe('TC-21..TC-29 isCalendarDate', () => {
  it.each([
    ['TC-21 leap day', '2028-02-29', true],
    ['TC-22 not a leap year', '2027-02-29', false],
    ['TC-23 month 13', '2026-13-01', false],
    ['TC-24 30-day month', '2026-09-31', false],
    ['TC-25 not zero padded', '2026-9-5', false],
    ['TC-26 with a time', '2026-09-25T00:00', false],
    ['TC-27 empty', '', false],
    ['TC-28 before DUE_DATE_MIN_YEAR', '1969-12-31', false],
    ['TC-28 after DUE_DATE_MAX_YEAR', '10000-01-01', false],
    ['TC-29 min bound', '1970-01-01', true],
    ['TC-29 max bound', '9999-12-31', true],
    ['day 00', '2026-09-00', false],
    ['month 00', '2026-00-10', false],
    ['spaces', ' 2026-09-25', false],
  ])('%s: %j -> %s', (_label, value, expected) => {
    expect(isCalendarDate(value)).toBe(expected);
  });

  it.each([20260925, null, undefined, {}, ['2026-09-25']])('non-strings (%j) are never dates', (value) => {
    expect(isCalendarDate(value)).toBe(false);
  });

  it('the bounds are the named settings', () => {
    expect(DUE_DATE_MIN_YEAR).toBe(1970);
    expect(DUE_DATE_MAX_YEAR).toBe(9999);
  });
});

describe('TC-30..TC-32 calendar arithmetic', () => {
  it('TC-30 addDays crosses the year boundary', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('TC-31 addDays reaches a leap day', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
  });

  it('TC-32 nextWeek from Fri / Mon / Sun', () => {
    expect(nextWeek('2026-09-25')).toBe('2026-09-28');
    expect(nextWeek('2026-09-28')).toBe('2026-10-05');
    expect(nextWeek('2026-09-27')).toBe('2026-09-28');
  });

  it('dayOffset and weekdayOf', () => {
    expect(dayOffset('2026-09-20', '2026-09-25')).toBe(-5);
    expect(dayOffset('2027-01-04', '2026-12-31')).toBe(4);
    expect(weekdayOf('2026-09-27')).toBe(0);
    expect(weekdayOf('2026-09-26')).toBe(6);
  });
});

describe('TC-101..TC-107 shortcuts for every weekday of 2026-09-21..27', () => {
  it.each([
    ['TC-101 Monday (next week is +7)', '2026-09-21', '2026-09-26', '2026-09-28', '2026-09-22'],
    ['TC-102 Tuesday', '2026-09-22', '2026-09-26', '2026-09-28', '2026-09-23'],
    ['TC-103 Wednesday', '2026-09-23', '2026-09-26', '2026-09-28', '2026-09-24'],
    ['TC-104 Thursday', '2026-09-24', '2026-09-26', '2026-09-28', '2026-09-25'],
    ['TC-105 Friday (weekend = tomorrow)', '2026-09-25', '2026-09-26', '2026-09-28', '2026-09-26'],
    ['TC-106 Saturday (weekend is today)', '2026-09-26', '2026-09-26', '2026-09-28', '2026-09-27'],
    ['TC-107 Sunday (weekend is today; next week = tomorrow)', '2026-09-27', '2026-09-27', '2026-09-28', '2026-09-28'],
  ])('%s', (_label, today, weekend, monday, tomorrow) => {
    expect(thisWeekend(today)).toBe(weekend);
    expect(nextWeek(today)).toBe(monday);
    expect(shortcutDates(today)).toEqual({ today, tomorrow, weekend, nextWeek: monday });
  });

  it('SHORTCUT_KEYS: T, M, W, N and 0 (frozen)', () => {
    expect(SHORTCUT_KEYS).toEqual({ t: 'today', m: 'tomorrow', w: 'weekend', n: 'nextWeek', '0': 'none' });
    expect(Object.isFrozen(SHORTCUT_KEYS)).toBe(true);
  });
});

describe('TC-108 formatShortcutDate (en-GB)', () => {
  it('Fri 2026-12-25: labels without a year', () => {
    const dates = shortcutDates('2026-12-25');
    expect(dates).toEqual({ today: '2026-12-25', tomorrow: '2026-12-26', weekend: '2026-12-26', nextWeek: '2026-12-28' });
    expect(formatShortcutDate(dates.weekend, 'en-GB')).toBe('Sat 26 Dec');
    expect(formatShortcutDate(dates.nextWeek, 'en-GB')).toBe('Mon 28 Dec');
  });

  it('Thu 2026-12-31: tomorrow is 2027-01-01', () => {
    const dates = shortcutDates('2026-12-31');
    expect(dates.tomorrow).toBe('2027-01-01');
    expect(formatShortcutDate(dates.tomorrow, 'en-GB')).toBe('Fri 1 Jan');
  });

  it("the PRD's labels: 'Fri 25 Sep' (three-letter September)", () => {
    expect(formatShortcutDate('2026-09-25', 'en-GB')).toBe('Fri 25 Sep');
    expect(formatShortcutDate('2026-09-26', 'en-GB')).toBe('Sat 26 Sep');
    expect(formatFullDate('2026-09-26', 'en-GB')).toBe('Saturday 26 September');
  });

  it('caches one formatter per locale and options', () => {
    const Real = Intl.DateTimeFormat;
    let constructed = 0;
    const Counting = function (this: unknown, ...args: ConstructorParameters<typeof Intl.DateTimeFormat>) {
      constructed++;
      return new Real(...args);
    } as unknown as typeof Intl.DateTimeFormat;
    Intl.DateTimeFormat = Counting;
    try {
      for (let i = 0; i < 5; i++) formatShortcutDate('2026-09-25', 'en-GB');
      expect(constructed).toBe(1);
    } finally {
      Intl.DateTimeFormat = Real;
    }
  });
});

describe('TC-109 overdue labels', () => {
  it.each([
    [-1, 'Yesterday', 'Overdue: due Thursday 24 September'],
    [-2, '2 days overdue', 'Overdue: due Wednesday 23 September'],
    [-30, '30 days overdue', 'Overdue: due Wednesday 26 August'],
  ])('offset %i: %j with the icon and %j', (offset, text, srLabel) => {
    const label = chipLabel(addDays(TODAY, offset), TODAY, 'en-GB');
    expect(label).toEqual({ text, tone: 'overdue', srLabel, showWarningIcon: true });
  });

  it("offset 0 says 'Due Today' with no icon", () => {
    expect(chipLabel(TODAY, TODAY, 'en-GB')).toEqual({ text: 'Today', tone: 'today', srLabel: 'Due Today', showWarningIcon: false });
  });
});
