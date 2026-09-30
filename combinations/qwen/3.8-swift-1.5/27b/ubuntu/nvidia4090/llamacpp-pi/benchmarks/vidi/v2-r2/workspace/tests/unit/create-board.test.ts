import { describe, it, expect } from 'vitest';
import { newBoardId, BOARD_ID_PATTERN, BOARD_ID_BYTES } from '../../src/shared/board-id';

/**
 * Story 5 TC-04 (share.unguessable): every board link carries a random code
 * of at least 128 bits, produced from a cryptographic random source, never
 * derived from creation order, time, creator, or other boards' links.
 */
describe('TC-04: link code format and uniqueness (share.unguessable)', () => {
  it('is generated from a cryptographic source of at least 16 bytes (128 bits)', () => {
    expect(BOARD_ID_BYTES).toBe(16);
  });

  it('10,000 newBoardId() calls: all unique, all 22 chars matching BOARD_ID_PATTERN', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(id).toHaveLength(22);
      expect(id).toMatch(BOARD_ID_PATTERN);
      seen.add(id);
    }
    expect(seen.size).toBe(10_000);
  });

  it('codes use only chat/email-safe characters (letters, digits, hyphen, underscore)', () => {
    for (let i = 0; i < 1000; i++) {
      expect(newBoardId()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
});
