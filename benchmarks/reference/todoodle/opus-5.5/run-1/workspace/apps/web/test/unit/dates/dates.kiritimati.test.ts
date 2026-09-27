// Story 8, TC-10: a viewer at UTC+14. TZ is set before any date is made.
const previousTz = process.env.TZ;
process.env.TZ = 'Pacific/Kiritimati';

import { chipLabel, classify, localDateOf, msUntilNextLocalMidnight } from '@todoodle/shared/dates';
import { afterAll, describe, expect, it } from 'vitest';

// Later files in this worker get the zone they started with.
afterAll(() => {
  if (previousTz === undefined) delete process.env.TZ;
  else process.env.TZ = previousTz;
});

describe('TC-10 Pacific/Kiritimati (UTC+14)', () => {
  it('2026-09-25T10:30Z is already the 26th locally: a task due the 25th is overdue, "Yesterday" with the icon', () => {
    const today = localDateOf(new Date('2026-09-25T10:30:00Z'));
    expect(today).toBe('2026-09-26');
    expect(classify('2026-09-25', today)).toBe('overdue');
    const label = chipLabel('2026-09-25', today, 'en-GB');
    expect(label.text).toBe('Yesterday');
    expect(label.showWarningIcon).toBe(true);
  });

  it('local midnight is 10:00Z', () => {
    expect(msUntilNextLocalMidnight(new Date('2026-09-25T09:00:00Z'))).toBe(3_600_000);
  });
});
