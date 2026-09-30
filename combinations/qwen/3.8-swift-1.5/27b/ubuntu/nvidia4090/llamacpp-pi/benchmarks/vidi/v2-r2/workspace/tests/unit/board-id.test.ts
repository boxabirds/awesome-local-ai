import { describe, it, expect } from 'vitest';
import { isValidBoardId, newBoardId, BOARD_ID_PATTERN } from '../../src/shared/board-id';

describe('TC-01: isValidBoardId', () => {
  it('accepts a valid 22-char base64url string', () => {
    // 22 chars of valid base64url
    expect(isValidBoardId('abcdefghijklmnopqrstuvwxyz'.slice(0, 22))).toBe(true);
    expect(isValidBoardId('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.slice(0, 22))).toBe(true);
    expect(isValidBoardId('0123456789012345678901')).toBe(true);
    expect(isValidBoardId('_-_-_-_-_-_-_-_-_-_-_-')).toBe(true);
    // A real generated id
    const id = newBoardId();
    expect(isValidBoardId(id)).toBe(true);
  });

  it('rejects 21 characters (boundary below)', () => {
    expect(isValidBoardId('a'.repeat(21))).toBe(false);
  });

  it('rejects 23 characters (boundary above)', () => {
    expect(isValidBoardId('a'.repeat(23))).toBe(false);
  });

  it("rejects '+' character (not in base64url)", () => {
    expect(isValidBoardId('a'.repeat(21) + '+')).toBe(false);
  });

  it('rejects "../x" (path traversal attempt)', () => {
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
      expect(BOARD_ID_PATTERN.test(id)).toBe(true);
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
    expect(seen.size).toBe(10_000);
  });
});
