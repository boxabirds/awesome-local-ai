// TC-01, TC-02: board id validation and generation.

import { describe, it, expect } from 'vitest';
import { isValidBoardId, newBoardId, BOARD_ID_PATTERN } from '../../src/shared/board-id';

describe('isValidBoardId (TC-01)', () => {
  it('accepts a valid 22-char base64url string', () => {
    // Generate one and check it validates
    const id = newBoardId();
    expect(isValidBoardId(id)).toBe(true);

    // Also check specific known-valid strings
    expect(isValidBoardId('a'.repeat(22))).toBe(true);
    expect(isValidBoardId('A'.repeat(22))).toBe(true);
    expect(isValidBoardId('0'.repeat(22))).toBe(true);
    expect(isValidBoardId('-'.repeat(22))).toBe(true);
    expect(isValidBoardId('_'.repeat(22))).toBe(true);
    expect(isValidBoardId('aB3-_x'.repeat(3) + 'abcd')).toBe(true); // 22 chars
  });

  it('rejects 21-char string (boundary)', () => {
    expect(isValidBoardId('a'.repeat(21))).toBe(false);
  });

  it('rejects 23-char string (boundary)', () => {
    expect(isValidBoardId('a'.repeat(23))).toBe(false);
  });

  it("rejects '+' character (not base64url)", () => {
    expect(isValidBoardId('a'.repeat(21) + '+')).toBe(false);
  });

  it("rejects '=' padding (not in base64url without padding)", () => {
    expect(isValidBoardId('a'.repeat(21) + '=')).toBe(false);
  });

  it("rejects '../x' (path traversal)", () => {
    expect(isValidBoardId('../x')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidBoardId('')).toBe(false);
  });

  it('rejects string with slash', () => {
    expect(isValidBoardId('a'.repeat(10) + '/' + 'a'.repeat(11))).toBe(false);
  });
});

describe('newBoardId (TC-02)', () => {
  it('generates 10,000 ids that all match the pattern with no duplicates', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(BOARD_ID_PATTERN.test(id)).toBe(true);
      expect(id.length).toBe(22);
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
    expect(seen.size).toBe(10_000);
  });
});
