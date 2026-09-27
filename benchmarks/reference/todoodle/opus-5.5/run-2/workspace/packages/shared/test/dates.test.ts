import { formatCompletedDate, parseTimestamp } from '@todoodle/shared/dates';
import { describe, expect, it, vi } from 'vitest';

const NOW = new Date('2026-09-27T12:00:00.000Z');

describe('TC-U15 formatCompletedDate', () => {
  it('same year: short weekday and date, no year', () => {
    const text = formatCompletedDate('2026-09-26T09:30:00.000Z', 'en-GB', NOW);
    expect(text).toBe(new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date('2026-09-26T09:30:00.000Z')));
    expect(text).toMatch(/Sat/);
    expect(text).not.toMatch(/2026/);
  });

  it('another year: the date with its year', () => {
    const text = formatCompletedDate('2025-03-04T09:30:00.000Z', 'en-GB', NOW);
    expect(text).toMatch(/2025/);
    expect(text).toMatch(/Mar/);
  });

  it('accepts the SQLite timestamp form (UTC)', () => {
    expect(parseTimestamp('2026-09-26 09:30:00')?.toISOString()).toBe('2026-09-26T09:30:00.000Z');
  });

  it('an invalid or missing timestamp is an empty string', () => {
    expect(formatCompletedDate('not a date', 'en-GB', NOW)).toBe('');
    expect(formatCompletedDate('', 'en-GB', NOW)).toBe('');
    expect(formatCompletedDate(null, 'en-GB', NOW)).toBe('');
  });

  it('constructs the formatter once per locale and reuses it', () => {
    const Real = Intl.DateTimeFormat;
    const spy = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (this: unknown, ...args: ConstructorParameters<typeof Real>) {
      return new Real(...args);
    } as typeof Real);
    for (let i = 0; i < 5; i++) formatCompletedDate(`2026-09-2${i}T09:30:00.000Z`, 'fr-FR', NOW);
    expect(spy).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 5; i++) formatCompletedDate(`2026-09-2${i}T09:30:00.000Z`, 'de-DE', NOW);
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});
