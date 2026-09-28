import { describe, it, expect } from 'vitest';
import { isValidBoardId, newBoardId, BOARD_ID_PATTERN, BOARD_ID_BYTES } from '../../src/shared/board-id';

describe('isValidBoardId (TC-01)', () => {
  it('accepts a valid 22-char base64url string', () => {
    const valid = 'abcdefghij_kl-mnopqr01';
    expect(valid).toHaveLength(22);
    expect(isValidBoardId(valid)).toBe(true);
  });

  it('rejects a 21-char string', () => {
    expect(isValidBoardId('abcdefghij_kl-mnopqr0')).toBe(false);
  });

  it('rejects a 23-char string', () => {
    expect(isValidBoardId('abcdefghij_kl-mnopqrst012')).toBe(false);
  });

  it('rejects a string containing "+"', () => {
    expect(isValidBoardId('abcdefghij+kl-mnopqrst')).toBe(false);
  });

  it('rejects "../x"', () => {
    expect(isValidBoardId('../x')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidBoardId('')).toBe(false);
  });
});

describe('newBoardId (TC-02)', () => {
  it('generates 10,000 ids that all match the pattern and are unique', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(BOARD_ID_PATTERN.test(id)).toBe(true);
      ids.add(id);
    }
    expect(ids.size).toBe(10_000);
  });

  it('generates ids of exactly 22 characters', () => {
    for (let i = 0; i < 100; i++) {
      expect(newBoardId()).toHaveLength(22);
    }
  });

  it('BOARD_ID_BYTES is 16', () => {
    expect(BOARD_ID_BYTES).toBe(16);
  });
});
