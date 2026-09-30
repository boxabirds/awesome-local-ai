import { describe, it, expect } from 'vitest';
import { newBoardId, isValidBoardId, BOARD_ID_PATTERN, BOARD_ID_BYTES } from '../../src/shared/board-id';

/**
 * TC-04 (share.unguessable): link codes are produced from a cryptographic
 * random source of at least 16 bytes (128 bits), are 22 characters long,
 * and 10,000 created boards have distinct codes.
 */
describe('TC-04: link-code format and uniqueness (share.unguessable)', () => {
  it('BOARD_ID_BYTES is at least 16 bytes (128 bits of randomness)', () => {
    expect(BOARD_ID_BYTES).toBeGreaterThanOrEqual(16);
  });

  it('10,000 newBoardId() calls produce unique 22-char codes matching BOARD_ID_PATTERN', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(id.length).toBe(22);
      expect(BOARD_ID_PATTERN.test(id)).toBe(true);
      expect(isValidBoardId(id)).toBe(true);
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
  });
});
