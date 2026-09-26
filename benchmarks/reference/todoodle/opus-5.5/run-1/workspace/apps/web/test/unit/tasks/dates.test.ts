import { clearDateFormattersForTests, formatCompletedDate } from '@todoodle/shared/dates';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Story 6, TC-U15: completion dates use cached Intl formatters (no date library).

const NOW = new Date(2026, 8, 26, 12, 0, 0);

describe('TC-U15 formatCompletedDate', () => {
  afterEach(() => clearDateFormattersForTests());

  it('same year: short weekday and date, no year', () => {
    const text = formatCompletedDate(new Date(2026, 8, 25, 9, 30).toISOString(), 'en-GB', NOW);
    expect(text).toBe('Fri 25 Sept');
  });

  it('different year: date with the year', () => {
    const text = formatCompletedDate(new Date(2025, 11, 31, 9, 30).toISOString(), 'en-GB', NOW);
    expect(text).toBe('31 Dec 2025');
  });

  it('en-US uses its own order', () => {
    expect(formatCompletedDate(new Date(2026, 8, 25).toISOString(), 'en-US', NOW)).toBe('Fri, Sep 25');
  });

  it.each(['', 'not a date', '2026-13-45T99:00:00Z'])('invalid %j -> empty string', (value) => {
    expect(formatCompletedDate(value, 'en-GB', NOW)).toBe('');
  });

  it('constructs one formatter per locale and options, then reuses it', () => {
    const Real = Intl.DateTimeFormat;
    const spy = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (this: unknown, ...args: ConstructorParameters<typeof Real>) {
      return new Real(...args);
    } as unknown as typeof Real);
    for (let day = 1; day <= 5; day++) formatCompletedDate(new Date(2026, 8, day).toISOString(), 'en-GB', NOW);
    expect(spy).toHaveBeenCalledTimes(1);
    formatCompletedDate(new Date(2025, 8, 1).toISOString(), 'en-GB', NOW);
    expect(spy).toHaveBeenCalledTimes(2);
    formatCompletedDate(new Date(2026, 8, 1).toISOString(), 'de-DE', NOW);
    expect(spy).toHaveBeenCalledTimes(3);
    formatCompletedDate(new Date(2026, 8, 2).toISOString(), 'de-DE', NOW);
    expect(spy).toHaveBeenCalledTimes(3);
  });
});
