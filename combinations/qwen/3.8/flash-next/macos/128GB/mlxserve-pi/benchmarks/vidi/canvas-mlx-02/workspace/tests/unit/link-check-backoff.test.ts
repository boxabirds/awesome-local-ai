// The waits a link that has not been answered is given. The shape is the one the
// socket already uses for a board that is slow to come back: each wait longer than
// the one before, and a ceiling, so that checking a link never becomes its own
// storm against the server the link is waiting for.
import { describe, it, expect } from 'vitest';
import { checkRetryDelayMs } from '../../src/client/pages/BoardPage.tsx';
import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../src/shared/config.ts';

describe('the waits between checks of a link', () => {
  it('TC-31: each wait is longer than the one before it, by doubling', () => {
    const waits = [1, 2, 3, 4].map((attempt) => checkRetryDelayMs(attempt));
    expect(waits).toEqual([1000, 2000, 4000, 8000]);
  });

  it('TC-31: the waits stop growing at the ceiling the socket already uses', () => {
    const many = [5, 6, 7, 12, 40].map((attempt) => checkRetryDelayMs(attempt));
    expect(many).toEqual(many.map(() => RECONNECT_MAX_BACKOFF_MS));
    // The doubling reaches the ceiling rather than jumping past it and coming back.
    expect(checkRetryDelayMs(4)).toBeLessThan(RECONNECT_MAX_BACKOFF_MS);
    expect(checkRetryDelayMs(5)).toBe(RECONNECT_MAX_BACKOFF_MS);
  });

  it('the waits are the ones the config says, not numbers a test invented', () => {
    expect(checkRetryDelayMs(1)).toBe(BOARD_CHECK_RETRY_BASE_MS);
    for (const attempt of [1, 2, 3, 4, 5, 6]) {
      expect(checkRetryDelayMs(attempt)).toBeLessThanOrEqual(RECONNECT_MAX_BACKOFF_MS);
      expect(checkRetryDelayMs(attempt)).toBeGreaterThan(0);
    }
  });

  it('an attempt that has not happened yet is not given a wait of nothing', () => {
    // A wait of zero would be a retry loop with no pause in it.
    expect(checkRetryDelayMs(0)).toBe(BOARD_CHECK_RETRY_BASE_MS);
    expect(checkRetryDelayMs(-3)).toBe(BOARD_CHECK_RETRY_BASE_MS);
  });
});
