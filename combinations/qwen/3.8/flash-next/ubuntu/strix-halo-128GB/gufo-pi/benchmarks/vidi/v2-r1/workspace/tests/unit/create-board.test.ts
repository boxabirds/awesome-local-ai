import { describe, expect, it } from 'vitest';

import { BOARD_ID_BYTES, BOARD_ID_PATTERN, newBoardId } from '../../src/shared/board-id';
import { BOARD_CHECK_RETRY_BASE_MS, CREATE_BUDGET_MS, LINK_COPIED_MS } from '../../src/shared/config';

describe('TC-04: board id format and uniqueness', () => {
  it('BOARD_ID_BYTES is 16 (128 bits of randomness)', () => {
    expect(BOARD_ID_BYTES).toBe(16);
  });

  it('named settings are present', () => {
    expect(CREATE_BUDGET_MS).toBe(2000);
    expect(LINK_COPIED_MS).toBe(2000);
    expect(BOARD_CHECK_RETRY_BASE_MS).toBe(1000);
  });

  it('10,000 generated ids are all unique and all 22 chars matching BOARD_ID_PATTERN', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(id).toMatch(BOARD_ID_PATTERN);
      expect(id.length).toBe(22);
      ids.add(id);
    }
    expect(ids.size).toBe(10_000);
  });
});
