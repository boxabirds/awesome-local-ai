import { describe, expect, test } from 'vitest';
import { BOARD_ID_BYTES, BOARD_ID_PATTERN, isValidBoardId, newBoardId } from '../../src/shared/board-id';

describe('sync.worker_entry board ids (TC-01)', () => {
  test('TC-01 a 22-char base64url id is valid', () => {
    expect(isValidBoardId('V1stPms2TfzXy9u0aBcDeF')).toBe(true);
    expect(isValidBoardId('_'.repeat(22))).toBe(true);
    expect(isValidBoardId('-_AbCdEfGhIjKlMnOpQrSt')).toBe(true);
  });

  test('TC-01 boundary: 21 and 23 chars are invalid', () => {
    expect(isValidBoardId('a'.repeat(21))).toBe(false);
    expect(isValidBoardId('a'.repeat(23))).toBe(false);
  });

  test('TC-01 negative: non-base64url characters, path traversal and empty are invalid', () => {
    expect(isValidBoardId('a'.repeat(21) + '+')).toBe(false); // '+' is not base64url
    expect(isValidBoardId('a'.repeat(21) + '=')).toBe(false); // '=' padding
    expect(isValidBoardId('a'.repeat(21) + '/')).toBe(false); // '/' is not base64url
    expect(isValidBoardId('a'.repeat(21) + ' ')).toBe(false); // space
    expect(isValidBoardId('../x')).toBe(false);
    expect(isValidBoardId('')).toBe(false);
  });
});

describe('sync.worker_entry board id generation (TC-02)', () => {
  test('TC-02 10,000 generated ids all match the pattern and are unique', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i += 1) {
      const id = newBoardId();
      expect(id).toMatch(BOARD_ID_PATTERN);
      expect(isValidBoardId(id)).toBe(true);
      seen.add(id);
    }
    expect(seen.size).toBe(10_000);
  });

  test('TC-02 the id encodes BOARD_ID_BYTES of randomness', () => {
    const id = newBoardId();
    expect(id.length).toBe(Math.ceil((BOARD_ID_BYTES * 8) / 6));
  });
});
