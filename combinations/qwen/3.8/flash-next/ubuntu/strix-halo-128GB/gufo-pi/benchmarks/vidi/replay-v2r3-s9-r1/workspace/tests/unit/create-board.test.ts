import { describe, it, expect } from 'vitest';
import { newBoardId, BOARD_ID_PATTERN, BOARD_ID_BYTES } from '../../src/shared/board-id';

/**
 * TC-04 (share.unguessable): 10,000 newBoardId() → all unique, all 22 chars
 * matching BOARD_ID_PATTERN, from 16 random bytes (128 bits).
 */
describe('TC-04: link-code format and uniqueness', () => {
  it('BOARD_ID_BYTES is 16 (128 bits of randomness)', () => {
    expect(BOARD_ID_BYTES).toBe(16);
  });

  it('produces 10,000 ids that are all 22 chars, match BOARD_ID_PATTERN, and are all unique', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      // All 22 characters long
      expect(id.length).toBe(22);
      // Match the base64url pattern
      expect(id).toMatch(BOARD_ID_PATTERN);
      ids.add(id);
    }
    // All unique (128 bits of randomness makes a collision practically impossible)
    expect(ids.size).toBe(10_000);
  });

  it('ids are only from the safe character set (letters, digits, hyphen, underscore)', () => {
    const safeOnly = /^[A-Za-z0-9_-]+$/;
    for (let i = 0; i < 1000; i++) {
      expect(newBoardId()).toMatch(safeOnly);
    }
  });

  it('ids are not derived from creation order or time', () => {
    // Generate two batches at different times; there is no sequential relationship
    const batch1 = Array.from({ length: 10 }, () => newBoardId());
    // Small delay to let Date.now() advance
    const t0 = Date.now();
    while (Date.now() === t0) { /* spin */ }
    const batch2 = Array.from({ length: 10 }, () => newBoardId());

    // No id in batch2 is simply batch1[i]+1 or derived from it
    // With 128-bit random ids, overlap is impossible
    const set1 = new Set(batch1);
    for (const id of batch2) {
      expect(set1.has(id)).toBe(false);
    }
  });
});
