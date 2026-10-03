import { describe, it, expect } from 'vitest';
import { isValidBoardId, newBoardId, BOARD_ID_PATTERN } from '../../src/shared/board-id';

describe('TC-01: isValidBoardId', () => {
  it('returns true for valid 22-char base64url', () => {
    // Generate a valid id and verify it passes
    const id = newBoardId();
    expect(id).toMatch(BOARD_ID_PATTERN);
    expect(isValidBoardId(id)).toBe(true);

    // Hand-crafted valid ids (exactly 22 chars each)
    expect(isValidBoardId('abcdefghijklmnopqrstuv')).toBe(true); // 22 lowercase
    expect(isValidBoardId('ABCDEFGHIJKLMNOPQRSTuv')).toBe(true); // 22 mixed
    expect(isValidBoardId('a1B2c3D4e5F6g7H8i9J0k_')).toBe(true); // 22 with underscore
    expect(isValidBoardId('-_a1B2c3D4e5F6g7H8i9J0')).toBe(true); // 22 with dash
  });

  it('returns false for 21 chars (boundary below)', () => {
    // 'a' through 'u' = 21 chars
    expect(isValidBoardId('abcdefghijklmnopqrstu')).toBe(false);
  });

  it('returns false for 23 chars (boundary above)', () => {
    // 'a' through 'w' = 23 chars
    expect(isValidBoardId('abcdefghijklmnopqrstuvw')).toBe(false);
  });

  it('returns false for "+" character (not base64url)', () => {
    // 22 chars with a '+' in it
    expect(isValidBoardId('abcdefghijklmnopq+wstuv')).toBe(false);
  });

  it('returns false for "../x" (path traversal)', () => {
    expect(isValidBoardId('../x')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isValidBoardId('')).toBe(false);
  });
});

describe('TC-02: newBoardId', () => {
  it('generates 10,000 ids that all match pattern with no duplicates', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(id).toMatch(BOARD_ID_PATTERN);
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
    expect(seen.size).toBe(10_000);
  });
});
