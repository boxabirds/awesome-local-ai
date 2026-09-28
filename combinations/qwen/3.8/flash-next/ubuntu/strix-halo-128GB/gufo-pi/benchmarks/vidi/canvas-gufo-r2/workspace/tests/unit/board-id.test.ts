/**
 * TC-01: isValidBoardId boundary and negative cases.
 * TC-02: newBoardId() generates valid, unique IDs.
 */
import { describe, it, expect } from 'vitest';
import { isValidBoardId, newBoardId, BOARD_ID_PATTERN, BOARD_ID_BYTES } from '../../src/shared/board-id';

describe('isValidBoardId', () => {
  // TC-01: valid 22-char base64url → true
  it('accepts a valid 22-char base64url string', () => {
    expect(isValidBoardId('abcdefghijklmnopqrstuv')).toBe(true);
    expect(isValidBoardId('ABCDEFGHIJKLmnopqrstuv')).toBe(true);
    expect(isValidBoardId('abcdefghijklmnopqrst_-')).toBe(true);
    // Also test a real generated ID
    const id = newBoardId();
    expect(isValidBoardId(id)).toBe(true);
  });

  // TC-01: 21 chars → false (boundary)
  it('rejects 21 characters', () => {
    expect(isValidBoardId('abcdefghijklmnopqrstu')).toBe(false);
  });

  // TC-01: 23 chars → false (boundary)
  it('rejects 23 characters', () => {
    expect(isValidBoardId('abcdefghijklmnopqrstuvw')).toBe(false);
  });

  // TC-01: '+' char → false (negative)
  it('rejects plus character', () => {
    expect(isValidBoardId('abcdefghijkl+opqrstuvw')).toBe(false);
  });

  // TC-01: '../x' → false (negative)
  it('rejects path traversal', () => {
    expect(isValidBoardId('../x')).toBe(false);
  });

  // TC-01: empty → false (negative)
  it('rejects empty string', () => {
    expect(isValidBoardId('')).toBe(false);
  });
});

describe('newBoardId', () => {
  // TC-02: generates 10,000 IDs, all match pattern, no duplicates
  it('generates 10000 valid unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(id).toMatch(BOARD_ID_PATTERN);
      ids.add(id);
    }
    expect(ids.size).toBe(10_000);
  });

  it('BOARD_ID_BYTES is 16', () => {
    expect(BOARD_ID_BYTES).toBe(16);
  });
});
