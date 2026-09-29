import { describe, expect, it } from 'vitest';
import {
  BOARD_ID_BYTES,
  BOARD_ID_PATTERN,
  isValidBoardId,
  newBoardId,
} from '../../src/shared/board-id';

describe('sync.worker_entry: board ids', () => {
  // TC-01: isValidBoardId accepts exactly 22-char base64url ids.
  it('TC-01 accepts a valid 22-char base64url id', () => {
    expect(isValidBoardId('abcdefghijklmnopqrstuv')).toBe(true);
    expect(isValidBoardId('AbCdEfGhIjKlMnOpQrStUv')).toBe(true);
    expect(isValidBoardId('aB3-_xYz0123456789abc_')).toBe(true);
  });

  it('TC-01 rejects 21 and 23 char ids (boundary)', () => {
    expect(isValidBoardId('abcdefghijklmnopqrstu')).toBe(false); // 21
    expect(isValidBoardId('abcdefghijklmnopqrstuvw')).toBe(false); // 23
  });

  it('TC-01 rejects non-base64url characters and traversal', () => {
    expect(isValidBoardId('abcdefghijklmnopqrst+v')).toBe(false); // '+' is base64, not base64url
    expect(isValidBoardId('../x')).toBe(false);
    expect(isValidBoardId('abcdefghijklmnopqrst/u')).toBe(false); // '/' would change the route
    expect(isValidBoardId('')).toBe(false);
  });

  // TC-02: newBoardId generates 10,000 unique, well-formed ids.
  it('TC-02 newBoardId matches the pattern and is unique over 10,000 draws', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(id).toMatch(BOARD_ID_PATTERN);
      expect(seen.has(id)).toBe(false); // 128 bits of randomness: a collision would break the app
      seen.add(id);
    }
    expect(BOARD_ID_BYTES).toBe(16); // 22 base64url chars = 16 bytes, no padding
  });
});
