import { describe, expect, it } from 'vitest';
import { BOARD_ID_BYTES, BOARD_ID_PATTERN, isValidBoardId, newBoardId } from '../../src/shared/board-id';

describe('isValidBoardId (TC-01)', () => {
  it('accepts a 22-char base64url id', () => {
    expect(isValidBoardId('abcdefghijklmnopqrstuv')).toBe(true);
    expect(isValidBoardId('A-_0123456789abcdefghij')).toBe(false); // 23 chars
    expect(isValidBoardId('A-_012345678901234567x')).toBe(true);
  });

  it('rejects 21 and 23 characters', () => {
    expect(isValidBoardId('a'.repeat(21))).toBe(false);
    expect(isValidBoardId('a'.repeat(22))).toBe(true);
    expect(isValidBoardId('a'.repeat(23))).toBe(false);
  });

  it('rejects non-base64url characters, traversal and empty', () => {
    expect(isValidBoardId('a'.repeat(21) + '+')).toBe(false);
    expect(isValidBoardId('../x')).toBe(false);
    expect(isValidBoardId('')).toBe(false);
  });
});

describe('newBoardId (TC-02)', () => {
  it('generates 10,000 unique ids that match the pattern', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(BOARD_ID_PATTERN.test(id)).toBe(true);
      ids.add(id);
    }
    expect(ids.size).toBe(10_000);
  });

  it('encodes BOARD_ID_BYTES bytes without padding', () => {
    expect(BOARD_ID_BYTES).toBe(16);
    expect(newBoardId()).toHaveLength(22);
  });
});
