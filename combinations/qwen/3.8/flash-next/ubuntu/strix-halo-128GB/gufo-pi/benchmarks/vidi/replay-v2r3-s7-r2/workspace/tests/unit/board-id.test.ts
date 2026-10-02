import { describe, it, expect } from 'vitest';
import { isValidBoardId, newBoardId, BOARD_ID_PATTERN } from '../../src/shared/board-id';

describe('isValidBoardId (TC-01)', () => {
  it('accepts valid 22-char base64url', () => {
    // A real 16-byte base64url without padding is 22 characters
    expect(isValidBoardId('ABCDEFGHIJKLMNOPqrstuv')).toBe(true);
    expect(isValidBoardId('abcdefghijklmnopqrstuv')).toBe(true);
    expect(isValidBoardId('ABCDEFGHIJKL-__qrstuv1')).toBe(true);
    expect(isValidBoardId('ABCDEFGHIJKL-++qrstuv2')).toBe(false); // + is not in base64url pattern
  });

  it('rejects 21 chars (too short)', () => {
    expect(isValidBoardId('ABCDEFGHIJKLMNOPqrstu')).toBe(false);
  });

  it('rejects 23 chars (too long)', () => {
    expect(isValidBoardId('ABCDEFGHIJKLMNOPqrstuvw')).toBe(false);
  });

  it('rejects "+" character', () => {
    expect(isValidBoardId('ABCDEFGHIJKL+bcdefqrst')).toBe(false);
  });

  it('rejects "../x"', () => {
    expect(isValidBoardId('../x')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidBoardId('')).toBe(false);
  });
});

describe('newBoardId (TC-02)', () => {
  it('generates 10000 ids that all match the pattern and are unique', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10000; i++) {
      const id = newBoardId();
      expect(id).toMatch(BOARD_ID_PATTERN);
      ids.add(id);
    }
    expect(ids.size).toBe(10000);
  });
});
