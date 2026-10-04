import { describe, expect, it } from 'vitest';
import {
  BOARD_ID_BYTES,
  BOARD_ID_PATTERN,
  isValidBoardId,
  newBoardId,
} from '../../src/shared/board-id';

/**
 * TC-01 (`isValidBoardId`) and TC-02 (`newBoardId`) from the story 3 design:
 * pure board-address validation and generation.
 */
describe('isValidBoardId (TC-01)', () => {
  it('accepts a 22-character base64url id', () => {
    expect(isValidBoardId('aB3-x_y9Zk0Qr7StUvWxYz')).toBe(true);
  });

  it('accepts every id the generator produces', () => {
    for (let i = 0; i < 50; i++) expect(isValidBoardId(newBoardId())).toBe(true);
  });

  it('rejects the length boundaries 21 and 23', () => {
    expect(isValidBoardId('a'.repeat(21))).toBe(false);
    expect(isValidBoardId('a'.repeat(23))).toBe(false);
  });

  it('rejects characters that are not base64url', () => {
    expect(isValidBoardId('aB3+x/y9Zk0Qr7StUvWxYz')).toBe(false); // '+' and '/'
    expect(isValidBoardId('abcdefghijklmnopqrstu=')).toBe(false); // padding
  });

  it('rejects path traversal and the empty string', () => {
    expect(isValidBoardId('../x')).toBe(false);
    expect(isValidBoardId('..%2fx')).toBe(false);
    expect(isValidBoardId('')).toBe(false);
  });

  it('rejects non-string-ish junk without throwing', () => {
    for (const value of [undefined, null, 42, {}, [], true]) {
      expect(isValidBoardId(value as unknown as string)).toBe(false);
    }
  });
});

describe('newBoardId (TC-02)', () => {
  it('is documented as 16 random bytes', () => {
    expect(BOARD_ID_BYTES).toBe(16);
  });

  it('produces 10000 ids that all match the pattern, with no duplicates', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(id).toMatch(BOARD_ID_PATTERN);
      seen.add(id);
    }
    expect(seen.size).toBe(10_000);
  });
});
