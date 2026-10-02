import { describe, it, expect } from 'vitest';
import { isValidBoardId, newBoardId, BOARD_ID_PATTERN } from '../../src/shared/board-id';

describe('TC-01: isValidBoardId', () => {
  it('returns true for a valid 22-char base64url string', () => {
    expect(isValidBoardId('abcdefghijklmnopqrstuv')).toBe(true);
    expect(isValidBoardId('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.slice(0, 22))).toBe(true);
    expect(isValidBoardId('a1B2c3D4e5F6g7H8i9J0k_')).toBe(true);
  });

  it('returns false for 21 chars (boundary below)', () => {
    expect(isValidBoardId('abcdefghijklmnopqrstu')).toBe(false);
  });

  it('returns false for 23 chars (boundary above)', () => {
    expect(isValidBoardId('abcdefghijklmnopqrstuvw')).toBe(false);
  });

  it('returns false for string with + character', () => {
    expect(isValidBoardId('abcdefghijklmnopqrst+v')).toBe(false);
  });

  it('returns false for path traversal attempt', () => {
    expect(isValidBoardId('../x')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isValidBoardId('')).toBe(false);
  });
});

describe('TC-02: newBoardId', () => {
  it('generates 10,000 unique valid board ids', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(BOARD_ID_PATTERN.test(id)).toBe(true);
      expect(id.length).toBe(22);
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
  });
});
