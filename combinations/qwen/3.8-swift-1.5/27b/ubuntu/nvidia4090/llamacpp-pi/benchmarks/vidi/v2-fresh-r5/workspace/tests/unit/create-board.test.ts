/**
 * Story 5 unit tests: share.board_api link-code strength (share.unguessable).
 *
 * TC-04: 10,000 `newBoardId()` → all unique, all 22 chars matching
 * BOARD_ID_PATTERN, produced from 16 random bytes (128 bits).
 */
import { describe, it, expect } from 'vitest';
import {
  BOARD_ID_BYTES,
  BOARD_ID_PATTERN,
  newBoardId,
} from '../../src/shared/board-id';

describe('TC-04: board link codes cannot be guessed (share.unguessable)', () => {
  it('board ids are 16 random bytes (128 bits)', () => {
    // 16 bytes → 128 bits of randomness; 22 base64url chars carry 132 bits,
    // so every code encodes at least 128 bits of entropy.
    expect(BOARD_ID_BYTES).toBe(16);
  });

  it('10,000 newBoardId() calls: all unique, all 22 chars matching BOARD_ID_PATTERN', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(id).toHaveLength(22);
      expect(id).toMatch(BOARD_ID_PATTERN);
      expect(seen.has(id), `duplicate id at ${i}: ${id}`).toBe(false);
      seen.add(id);
    }
    expect(seen.size).toBe(10_000);
  });
});
