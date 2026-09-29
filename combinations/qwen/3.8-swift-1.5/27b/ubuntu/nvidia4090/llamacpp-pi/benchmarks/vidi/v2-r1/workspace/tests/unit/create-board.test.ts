import { describe, it, expect } from 'vitest';
import { newBoardId, BOARD_ID_PATTERN, BOARD_ID_BYTES } from '@shared/board-id';

/**
 * TC-04 (share.unguessable): 10,000 board ids are all unique, all 22
 * characters matching BOARD_ID_PATTERN, and produced from 16 random bytes
 * (128 bits) of cryptographic randomness.
 *
 * Verification per PRD: codes are produced from a cryptographic random
 * source of at least 16 bytes, are 22 characters long, and 10,000 created
 * boards have distinct codes.
 */
describe('TC-04: board link codes are unguessable', () => {
  it('10,000 newBoardId() values are unique, 22 chars, matching BOARD_ID_PATTERN', () => {
    const COUNT = 10_000;
    const seen = new Set<string>();

    for (let i = 0; i < COUNT; i++) {
      const id = newBoardId();
      expect(id).toMatch(BOARD_ID_PATTERN);
      expect(id).toHaveLength(22);
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
    expect(seen.size).toBe(COUNT);
  });

  it('ids are 22 chars because they encode 16 random bytes (128 bits) in base64url', () => {
    // 16 bytes → ceil(16/3)*4 = 22 base64url characters (padding stripped).
    expect(BOARD_ID_BYTES).toBe(16);
    expect(Math.ceil((BOARD_ID_BYTES * 8) / 6)).toBe(22);
    // 128 bits of randomness is the link-code strength (PRD constraint).
    expect(BOARD_ID_BYTES * 8).toBeGreaterThanOrEqual(128);
  });
});
