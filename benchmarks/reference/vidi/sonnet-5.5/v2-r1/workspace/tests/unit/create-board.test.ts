import { describe, expect, it } from 'vitest';
import { BOARD_ID_BYTES, BOARD_ID_PATTERN, newBoardId } from '../../src/shared/board-id';
import { BOARD_CHECK_RETRY_BASE_MS, CREATE_BUDGET_MS, LINK_COPIED_MS } from '../../src/shared/config';
import { retryDelayMs } from '../../src/client/pages/state';
import { RECONNECT_MAX_BACKOFF_MS } from '../../src/shared/config';

describe('link codes (share.unguessable)', () => {
  it('TC-04: 10,000 ids are unique, 22 characters and match the pattern', () => {
    expect(BOARD_ID_BYTES * 8).toBeGreaterThanOrEqual(128);
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(id).toHaveLength(22);
      expect(BOARD_ID_PATTERN.test(id)).toBe(true);
      ids.add(id);
    }
    expect(ids.size).toBe(10_000);
  });

  it('named settings have the specified values', () => {
    expect(CREATE_BUDGET_MS).toBe(2000);
    expect(LINK_COPIED_MS).toBe(2000);
    expect(BOARD_CHECK_RETRY_BASE_MS).toBe(1000);
  });

  it('retry delay doubles from the base and is capped', () => {
    expect(retryDelayMs(1)).toBe(BOARD_CHECK_RETRY_BASE_MS);
    expect(retryDelayMs(2)).toBe(2 * BOARD_CHECK_RETRY_BASE_MS);
    expect(retryDelayMs(20)).toBe(RECONNECT_MAX_BACKOFF_MS);
  });
});
