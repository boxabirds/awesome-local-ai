// Story 8, TC-33..TC-35: DST in America/New_York (23 h and 25 h days). TZ is set before any date is made.
const previousTz = process.env.TZ;
process.env.TZ = 'America/New_York';

import { addDays, localDateOf, msUntilNextLocalMidnight } from '@todoodle/shared/dates';
import { afterAll, describe, expect, it } from 'vitest';

// Later files in this worker get the zone they started with.
afterAll(() => {
  if (previousTz === undefined) delete process.env.TZ;
  else process.env.TZ = previousTz;
});

const HOUR = 3_600_000;

describe('DST in America/New_York', () => {
  it('TC-33 localDateOf on the spring-forward day', () => {
    expect(localDateOf(new Date('2026-03-08T07:30:00Z'))).toBe('2026-03-08');
  });

  it('TC-34 23:00 on the day before the 23 h day: one hour to midnight', () => {
    expect(msUntilNextLocalMidnight(new Date(2026, 2, 7, 23, 0, 0))).toBe(HOUR);
  });

  it('TC-35 00:30 on the 25 h day (fall back): 24.5 hours to midnight', () => {
    expect(msUntilNextLocalMidnight(new Date(2026, 10, 1, 0, 30, 0))).toBe(24.5 * HOUR);
  });

  it('calendar arithmetic ignores DST: the day after the 23 h day is the next date', () => {
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
  });
});
