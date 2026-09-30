import { describe, it, expect } from 'vitest';
import { isValidBoardId, newBoardId, BOARD_ID_PATTERN } from '@shared/board-id';

describe('isValidBoardId (TC-01)', () => {
  it('returns true for valid 22-char base64url', () => {
    // Generate a valid one to test
    const id = newBoardId();
    expect(id).toHaveLength(22);
    expect(isValidBoardId(id)).toBe(true);
  });

  it('returns false for 21 chars (boundary below)', () => {
    expect(isValidBoardId('a'.repeat(21))).toBe(false);
  });

  it('returns false for 23 chars (boundary above)', () => {
    expect(isValidBoardId('a'.repeat(23))).toBe(false);
  });

  it("returns false for '+' character", () => {
    // 22 chars with a '+' which is NOT in base64url
    expect(isValidBoardId('a+'.repeat(11))).toBe(false);
  });

  it("returns false for '../x'", () => {
    expect(isValidBoardId('../x')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isValidBoardId('')).toBe(false);
  });
});

describe('newBoardId (TC-02)', () => {
  it('generates 10,000 IDs that all match pattern with no duplicates', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(id).toMatch(BOARD_ID_PATTERN);
      ids.add(id);
    }
    expect(ids.size).toBe(10_000);
  });
});
