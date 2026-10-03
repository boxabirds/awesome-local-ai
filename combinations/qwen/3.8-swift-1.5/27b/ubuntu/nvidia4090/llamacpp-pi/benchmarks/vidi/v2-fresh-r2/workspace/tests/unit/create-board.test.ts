/**
 * TC-04 (story 5, share.board_api): link-code format and uniqueness
 * (share.unguessable).
 *
 * Every board link must contain a random code of at least 128 bits of
 * randomness, 22 characters long, from a cryptographic random source of at
 * least 16 bytes — and 10,000 created boards must have distinct codes.
 */
import { describe, it, expect } from 'vitest';
import {
  BOARD_ID_BYTES,
  BOARD_ID_PATTERN,
  newBoardId,
} from '../../src/shared/board-id';

describe('TC-04: link-code strength (share.unguessable)', () => {
  it('ids are 16 random bytes (128 bits) → 22 unpadded base64url characters', () => {
    expect(BOARD_ID_BYTES).toBe(16);
    expect(BOARD_ID_BYTES * 8).toBe(128);
    // 16 bytes of base64url without padding is exactly 22 characters.
    expect(Math.ceil((BOARD_ID_BYTES * 8) / 6)).toBe(22);
    expect(BOARD_ID_PATTERN.source).toBe('^[A-Za-z0-9_-]{22}$');
  });

  it('10,000 newBoardId() calls: all unique, all 22 chars matching BOARD_ID_PATTERN', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(id).toHaveLength(22);
      expect(id).toMatch(BOARD_ID_PATTERN);
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
    expect(seen.size).toBe(10_000);
  });
});
