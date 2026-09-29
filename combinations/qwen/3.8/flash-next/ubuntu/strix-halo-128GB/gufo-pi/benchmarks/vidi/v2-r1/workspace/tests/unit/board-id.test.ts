import { describe, expect, it } from 'vitest';

import { BOARD_ID_PATTERN, isValidBoardId, newBoardId } from '../../src/shared/board-id';

describe('isValidBoardId', () => {
  // TC-01: valid 22-char base64url → true
  it('accepts a valid 22-char base64url string', () => {
    // Generate a known-valid id
    const id = newBoardId();
    expect(id).toHaveLength(22);
    expect(isValidBoardId(id)).toBe(true);
  });

  it('accepts specific valid characters', () => {
    expect(isValidBoardId('a'.repeat(22))).toBe(true);
    expect(isValidBoardId('A'.repeat(22))).toBe(true);
    expect(isValidBoardId('0'.repeat(22))).toBe(true);
    expect(isValidBoardId('-'.repeat(22))).toBe(true);
    expect(isValidBoardId('_'.repeat(22))).toBe(true);
    expect(isValidBoardId('aB3-xY7_zK9_mN2_pQ5_rT')).toBe(true);
  });

  // TC-01: 21 chars → false (boundary)
  it('rejects 21 characters (too short)', () => {
    expect(isValidBoardId('a'.repeat(21))).toBe(false);
  });

  // TC-01: 23 chars → false (boundary)
  it('rejects 23 characters (too long)', () => {
    expect(isValidBoardId('a'.repeat(23))).toBe(false);
  });

  // TC-01: '+' char → false (negative)
  it('rejects strings containing +', () => {
    expect(isValidBoardId('a'.repeat(21) + '+')).toBe(false);
  });

  // TC-01: '../x' → false (negative)
  it('rejects path traversal strings', () => {
    expect(isValidBoardId('../x')).toBe(false);
  });

  // TC-01: empty → false (negative)
  it('rejects empty string', () => {
    expect(isValidBoardId('')).toBe(false);
  });

  it('rejects strings with spaces or other special chars', () => {
    expect(isValidBoardId('a'.repeat(21) + ' ')).toBe(false);
    expect(isValidBoardId('a'.repeat(21) + '!')).toBe(false);
    expect(isValidBoardId('a'.repeat(21) + '/')).toBe(false);
  });
});

describe('newBoardId', () => {
  // TC-02: 10,000 calls → all match pattern, no duplicates
  it('generates 10,000 ids that all match the pattern and are unique', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(id).toMatch(BOARD_ID_PATTERN);
      ids.add(id);
    }
    expect(ids.size).toBe(10_000);
  });

  it('generates ids of exactly 22 characters', () => {
    for (let i = 0; i < 100; i++) {
      expect(newBoardId()).toHaveLength(22);
    }
  });
});
