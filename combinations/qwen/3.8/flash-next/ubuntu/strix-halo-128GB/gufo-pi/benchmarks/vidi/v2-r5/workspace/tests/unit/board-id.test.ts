import { describe, it, expect } from 'vitest';
import { isValidBoardId, newBoardId, BOARD_ID_PATTERN } from '../../src/shared/board-id';

describe('isValidBoardId', () => {
  // TC-01: valid 22-char base64url → true
  it('accepts valid 22-char base64url', () => {
    const id = newBoardId(); // generate a valid one
    expect(isValidBoardId(id)).toBe(true);
  });

  // TC-01: boundary - 21 chars → false
  it('rejects 21-char string', () => {
    expect(isValidBoardId('a'.repeat(21))).toBe(false);
  });

  // TC-01: boundary - 23 chars → false
  it('rejects 23-char string', () => {
    expect(isValidBoardId('a'.repeat(23))).toBe(false);
  });

  // TC-01: '+' char → false
  it('rejects string containing +', () => {
    expect(isValidBoardId('++++++++++++++++++++++')).toBe(false);
  });

  // TC-01: '../x' → false
  it('rejects path traversal', () => {
    expect(isValidBoardId('../x')).toBe(false);
  });

  // TC-01: empty → false
  it('rejects empty string', () => {
    expect(isValidBoardId('')).toBe(false);
  });
});

describe('newBoardId', () => {
  // TC-02: 10,000 calls → all match pattern, no duplicates
  it('generates 10000 unique ids all matching pattern', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(id).toMatch(BOARD_ID_PATTERN);
      ids.add(id);
    }
    expect(ids.size).toBe(10_000);
  });
});
