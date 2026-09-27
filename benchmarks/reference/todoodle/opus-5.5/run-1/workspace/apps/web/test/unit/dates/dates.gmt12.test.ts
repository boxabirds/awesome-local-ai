// Story 8, TC-11: a viewer at UTC-12 (Etc/GMT+12). TZ is set before any date is made.
const previousTz = process.env.TZ;
process.env.TZ = 'Etc/GMT+12';

import { chipLabel, classify, localDateOf } from '@todoodle/shared/dates';
import { afterAll, describe, expect, it } from 'vitest';

// Later files in this worker get the zone they started with.
afterAll(() => {
  if (previousTz === undefined) delete process.env.TZ;
  else process.env.TZ = previousTz;
});

describe('TC-11 Etc/GMT+12 (UTC-12)', () => {
  it('2026-09-25T11:30Z is still the 24th locally: a task due the 25th is tomorrow (not in Today)', () => {
    const today = localDateOf(new Date('2026-09-25T11:30:00Z'));
    expect(today).toBe('2026-09-24');
    expect(classify('2026-09-25', today)).toBe('future');
    expect(chipLabel('2026-09-25', today, 'en-GB').text).toBe('Tomorrow');
  });
});
