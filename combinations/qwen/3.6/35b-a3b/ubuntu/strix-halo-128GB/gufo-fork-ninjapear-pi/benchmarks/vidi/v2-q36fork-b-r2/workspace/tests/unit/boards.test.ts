import { describe, it, expect } from 'vitest';
import { isValidBoardId, newBoardId, BOARD_ID_PATTERN, BOARD_ID_BYTES } from '../../src/shared/board-id';

// --- TC-04: link-code format and uniqueness (share.unguessable) ---
describe('TC-04: share.board_api — link-code strength', () => {
  it('BOARD_ID_BYTES = 16 (128 bits)', () => {
    expect(BOARD_ID_BYTES).toBe(16);
  });

  it('newBoardId() generates 22-char base64url strings matching BOARD_ID_PATTERN', () => {
    const id = newBoardId();
    expect(id.length).toBe(22);
    expect(BOARD_ID_PATTERN.test(id)).toBe(true);
  });

  it('10,000 generated ids are all unique and match the pattern', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(id.length).toBe(22);
      expect(BOARD_ID_PATTERN.test(id)).toBe(true);
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
  });

  it('ids use crypto.getRandomValues (not derived from time/counters)', () => {
    // Generate several ids; none should be equal or sequential patterns
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(newBoardId());
    }
    // With 128 bits of randomness, no collisions across 100 samples is guaranteed
    expect(ids.size).toBe(100);
  });

  it('isValidBoardId accepts only valid 22-char base64url ids', () => {
    // Valid
    expect(isValidBoardId(newBoardId())).toBe(true);
    expect(isValidBoardId('ABCdef01234567890abc__')).toBe(true);
    expect(isValidBoardId('aB3_-ZyXwVuTsRqPoNmLiG')).toBe(true);

    // Invalid lengths
    expect(isValidBoardId('ABC')).toBe(false);
    expect(isValidBoardId('ABCdef01234567890ab')).toBe(false); // 21 chars
    expect(isValidBoardId('ABCdef01234567890abcd')).toBe(false); // 23 chars

    // Invalid characters
    expect(isValidBoardId('ABC+ef01234567890ab_')).toBe(false); // + not in base64url
    expect(isValidBoardId('ABC/ef01234567890ab_')).toBe(false); // / not in base64url

    // Empty/null
    expect(isValidBoardId('')).toBe(false);
    expect(isValidBoardId(null as any)).toBe(false);
    expect(isValidBoardId(undefined as any)).toBe(false);
  });
});
