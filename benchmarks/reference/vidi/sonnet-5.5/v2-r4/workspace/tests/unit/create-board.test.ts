import { describe, expect, it } from 'vitest';
import { BOARD_ID_BYTES, BOARD_ID_PATTERN, newBoardId } from '../../src/shared/board-id';
import { BOARD_CHECK_RETRY_BASE_MS, CREATE_BUDGET_MS, LINK_COPIED_MS } from '../../src/shared/config';

describe('link codes (TC-04, share.unguessable)', () => {
  it('10,000 ids are unique, 22 characters and match BOARD_ID_PATTERN', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(id).toHaveLength(22);
      expect(BOARD_ID_PATTERN.test(id)).toBe(true);
      seen.add(id);
    }
    expect(seen.size).toBe(10_000);
  });

  it('is built from at least 16 random bytes (128 bits)', () => {
    expect(BOARD_ID_BYTES).toBeGreaterThanOrEqual(16);
    // 22 base64url characters carry 132 bits, enough for 16 bytes.
    expect(Math.floor((22 * 6) / 8)).toBeGreaterThanOrEqual(BOARD_ID_BYTES);
  });
});

describe('story 5 settings', () => {
  it('are the specified values', () => {
    expect(CREATE_BUDGET_MS).toBe(2000);
    expect(LINK_COPIED_MS).toBe(2000);
    expect(BOARD_CHECK_RETRY_BASE_MS).toBe(1000);
  });
});
