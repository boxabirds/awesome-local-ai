import { describe, it, expect } from 'vitest';
import { newBoardId, BOARD_ID_PATTERN, BOARD_ID_BYTES } from '../../src/shared/board-id';

describe('TC-04: board id format and uniqueness', () => {
  it('generates 10,000 unique 22-char ids matching BOARD_ID_PATTERN', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      // All 22 chars
      expect(id.length).toBe(22);
      // Matches the base64url pattern (no padding)
      expect(id).toMatch(BOARD_ID_PATTERN);
      // All unique
      expect(ids.has(id)).toBe(false);
      ids.add(id);
    }
    expect(ids.size).toBe(10_000);
  });

  it('uses 16 random bytes (128 bits)', () => {
    expect(BOARD_ID_BYTES).toBe(16);
  });
});
