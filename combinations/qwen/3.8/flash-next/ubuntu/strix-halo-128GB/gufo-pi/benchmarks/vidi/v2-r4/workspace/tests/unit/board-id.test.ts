import { describe, it, expect } from 'vitest';
import { isValidBoardId, newBoardId, BOARD_ID_PATTERN } from '../../src/shared/board-id';

describe('isValidBoardId', () => {
  it('accepts a valid 22-char base64url string', () => {
    // Generate one to be sure it's valid
    const id = newBoardId();
    expect(id).toHaveLength(22);
    expect(isValidBoardId(id)).toBe(true);
  });

  it('rejects a 21-char string', () => {
    expect(isValidBoardId('a'.repeat(21))).toBe(false);
  });

  it('rejects a 23-char string', () => {
    expect(isValidBoardId('a'.repeat(23))).toBe(false);
  });

  it("rejects a string containing '+'", () => {
    // 20 valid chars + '+' + 1 valid char = 22 but '+' is not in [A-Za-z0-9_-]
    expect(isValidBoardId('a'.repeat(20) + '+' + 'a')).toBe(false);
  });

  it("rejects '../x'", () => {
    expect(isValidBoardId('../x')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidBoardId('')).toBe(false);
  });
});

describe('newBoardId', () => {
  it('generates 10000 IDs that all match the pattern with no duplicates', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(id).toMatch(BOARD_ID_PATTERN);
      expect(id).toHaveLength(22);
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
  });
});
