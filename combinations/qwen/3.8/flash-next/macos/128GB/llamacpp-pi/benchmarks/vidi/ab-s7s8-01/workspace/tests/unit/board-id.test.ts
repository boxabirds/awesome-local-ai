import { describe, expect, test } from 'vitest';
import { BOARD_ID_BYTES, BOARD_ID_PATTERN, isValidBoardId, newBoardId } from '../../src/shared/board-id';

// TC-01: shape validation (boundaries + negatives).
describe('isValidBoardId', () => {
  test('accepts a freshly generated id', () => {
    expect(isValidBoardId(newBoardId())).toBe(true);
  });

  test('accepts any 22-character base64url string, including - and _', () => {
    expect(isValidBoardId('AAAAAAAAAAAAAAAAAAAAAA')).toBe(true);
    expect(isValidBoardId('ab_cd-ef01234567890123')).toBe(true);
  });

  test('rejects wrong lengths (boundary 21 and 23)', () => {
    expect(isValidBoardId('A'.repeat(21))).toBe(false);
    expect(isValidBoardId('A'.repeat(23))).toBe(false);
  });

  test('rejects non-base64url characters and traversal attempts', () => {
    expect(isValidBoardId('A+'.repeat(11).slice(0, 22))).toBe(false); // '+' is base64, not base64url
    expect(isValidBoardId('../../etc/passwd')).toBe(false);
    expect(isValidBoardId('../x')).toBe(false);
    expect(isValidBoardId('')).toBe(false);
    expect(isValidBoardId('A'.repeat(22) + '=')).toBe(false); // padded base64
  });

  test('rejects whitespace and url-unsafe characters', () => {
    expect(isValidBoardId(`${'A'.repeat(21)} `)).toBe(false);
    expect(isValidBoardId(`${'A'.repeat(21)}%`)).toBe(false);
  });
});

// TC-02: 10,000 generated ids — all match the pattern, no duplicates.
describe('newBoardId', () => {
  test('produces 10,000 unique pattern-matching ids', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i += 1) {
      const id = newBoardId();
      expect(id).toMatch(BOARD_ID_PATTERN);
      expect(id.length).toBe(22);
      seen.add(id);
    }
    expect(seen.size).toBe(10_000);
  });

  test('generates exactly BOARD_ID_BYTES random bytes', () => {
    expect(BOARD_ID_BYTES).toBe(16);
    // 16 bytes of base64 = ceil(16/3)*4 = 24 chars with 2 padding chars removed.
    const id = newBoardId();
    const raw = id.replace(/-/g, '+').replace(/_/g, '/');
    expect(() => atob(raw)).not.toThrow();
    expect(atob(raw).length).toBe(BOARD_ID_BYTES);
  });
});