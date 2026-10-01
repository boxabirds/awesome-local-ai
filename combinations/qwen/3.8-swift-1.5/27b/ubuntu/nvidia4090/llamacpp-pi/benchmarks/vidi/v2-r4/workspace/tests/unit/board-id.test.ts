import { describe, it, expect } from 'vitest';
import { isValidBoardId, newBoardId, BOARD_ID_PATTERN } from '../../src/shared/board-id';

describe('TC-01: isValidBoardId', () => {
  it('accepts a valid 22-char base64url string', () => {
    // Generate a valid id and check it passes
    const id = newBoardId();
    expect(isValidBoardId(id)).toBe(true);
  });

  it('rejects 21-char string (boundary)', () => {
    const id = 'a'.repeat(21);
    expect(isValidBoardId(id)).toBe(false);
  });

  it('rejects 23-char string (boundary)', () => {
    const id = 'a'.repeat(23);
    expect(isValidBoardId(id)).toBe(false);
  });

  it('rejects string with + character', () => {
    // 22 chars with a '+'
    const id = 'a'.repeat(21) + '+';
    expect(isValidBoardId(id)).toBe(false);
  });

  it('rejects string with ../x', () => {
    expect(isValidBoardId('../x')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidBoardId('')).toBe(false);
  });
});

describe('TC-02: newBoardId', () => {
  it('generates 10,000 ids that all match the pattern with no duplicates', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(id).toMatch(BOARD_ID_PATTERN);
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
  });
});
