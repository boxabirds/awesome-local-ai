import { describe, it, expect } from 'vitest';
import { newBoardId, BOARD_ID_PATTERN, BOARD_ID_BYTES } from '../../src/shared/board-id';
import { CREATE_BUDGET_MS, LINK_COPIED_MS, BOARD_CHECK_RETRY_BASE_MS } from '../../src/shared/config';

describe('TC-04: board id format and uniqueness (share.unguessable)', () => {
  it('generates 10,000 unique ids all 22 chars matching BOARD_ID_PATTERN', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(id).toHaveLength(22);
      expect(id).toMatch(BOARD_ID_PATTERN);
      ids.add(id);
    }
    expect(ids.size).toBe(10_000);
  });

  it('uses 16 random bytes (128 bits) of entropy', () => {
    // Verify the constant is correct: 16 bytes = 128 bits
    expect(BOARD_ID_BYTES).toBe(16);
  });

  it('named settings are defined correctly', () => {
    expect(CREATE_BUDGET_MS).toBe(2000);
    expect(LINK_COPIED_MS).toBe(2000);
    expect(BOARD_CHECK_RETRY_BASE_MS).toBe(1000);
  });
});
