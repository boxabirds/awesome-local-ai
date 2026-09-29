import { describe, it, expect } from 'vitest';
import { isValidBoardId, newBoardId, BOARD_ID_PATTERN } from '@shared/board-id';

describe('TC-01: isValidBoardId', () => {
  it('returns true for valid 22-char base64url', () => {
    // A valid 22-char base64url string
    expect(isValidBoardId('abcDEF1234567890123456')).toBe(true);
    expect(isValidBoardId('-_abcdefghijklmnopqrstuvwxyz'.substring(0, 22))).toBe(true);
  });

  it('returns false for 21 chars (boundary)', () => {
    expect(isValidBoardId('abcDEF123456789012345')).toBe(false); // 21 chars
  });

  it('returns false for 23 chars (boundary)', () => {
    expect(isValidBoardId('abcDEF12345678901234567')).toBe(false); // 23 chars
  });

  it('returns false for + character', () => {
    expect(isValidBoardId('abcDEF12345678901234+6')).toBe(false);
  });

  it('returns false for ../x', () => {
    expect(isValidBoardId('../x')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isValidBoardId('')).toBe(false);
  });
});

describe('TC-02: newBoardId', () => {
  it('generates 10,000 ids that all match the pattern with no duplicates', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(BOARD_ID_PATTERN.test(id)).toBe(true);
      ids.add(id);
    }
    expect(ids.size).toBe(10_000);
  });
});
