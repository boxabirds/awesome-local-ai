import { describe, expect, it } from 'vitest';

import {
  BOARD_ID_BYTES,
  BOARD_ID_PATTERN,
  isValidBoardId,
  newBoardId,
} from '../../src/shared/board-id';

/**
 * TC-01, TC-02 — sync.worker_entry: a board id is exactly base64url of
 * BOARD_ID_BYTES random bytes, and fresh ids never repeat.
 */

describe('isValidBoardId (TC-01)', () => {
  it('accepts a 22-character base64url id', () => {
    expect(isValidBoardId(newBoardId())).toBe(true);
    // The alphabet: lowercase, uppercase, digits, '-' and '_'. Both strings are
    // the base64url encoding of 16 real bytes.
    expect(isValidBoardId('Zm9vYmFyYmF6MTIzNDU2Nw')).toBe(true); // "foobarbaz1234567"
    expect(isValidBoardId('__79_Pv6-fj39vX08_Lx8A')).toBe(true); // 0xff..0xf0
    expect(isValidBoardId('0123456789abcdefghijAB')).toBe(true);
  });

  it('rejects ids of the wrong length (boundary: 21 and 23)', () => {
    expect(isValidBoardId('a'.repeat(21))).toBe(false);
    expect(isValidBoardId('a'.repeat(22))).toBe(true);
    expect(isValidBoardId('a'.repeat(23))).toBe(false);
  });

  it('rejects characters outside base64url', () => {
    expect(isValidBoardId('++++++++++++++++++++++')).toBe(false);
    // A 22-character id that contains '+' in the last position.
    expect(isValidBoardId('abcdefghijklmnopqrstu+')).toBe(false); // 22 chars, '+'
    expect(isValidBoardId('abcdefghijklmnopqrstuv=')).toBe(false); // 22 chars, padding
    expect(isValidBoardId('abcdefghijklmnopqrstu/')).toBe(false); // 22 chars, '/'
  });

  it('rejects traversal attempts and the empty string', () => {
    expect(isValidBoardId('../x')).toBe(false);
    expect(isValidBoardId('../../etc/passwd')).toBe(false);
    expect(isValidBoardId('')).toBe(false);
    expect(isValidBoardId('a'.repeat(22) + ' ')).toBe(false);
  });

  it('exposes the pattern and byte count the tests rely on', () => {
    expect(BOARD_ID_BYTES).toBe(16);
    expect(BOARD_ID_PATTERN).toBeInstanceOf(RegExp);
  });
});

describe('newBoardId (TC-02)', () => {
  it('generates 10,000 ids that all match the pattern and never repeat', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(id).toMatch(BOARD_ID_PATTERN);
      expect(id.length).toBe(22);
      seen.add(id);
    }
    expect(seen.size).toBe(10_000);
  });
});
