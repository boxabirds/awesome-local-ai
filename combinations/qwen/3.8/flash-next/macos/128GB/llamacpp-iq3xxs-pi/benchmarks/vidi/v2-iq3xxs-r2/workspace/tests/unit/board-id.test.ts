import { describe, expect, it } from 'vitest';
import {
  BOARD_ID_BYTES,
  BOARD_ID_PATTERN,
  isValidBoardId,
  newBoardId,
} from '../../src/shared/board-id';

/**
 * TC-01 and TC-02 of story 3 (`sync.worker_entry`): the board address is validated
 * before anything else happens, so the rules are pure functions of the string.
 */

/** A base64url string of `length` characters, for length-boundary cases. */
function idOfLength(length: number, seed = 0): string {
  const alphabet = 'AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz0123456789-_';
  let out = '';
  let value = seed + 1;
  for (let i = 0; i < length; i += 1) {
    value = (value * 1103515245 + 12345) % 2147483648;
    out += alphabet[value % alphabet.length];
  }
  return out;
}

const VALID_ID_LENGTH = 22; // base64url of BOARD_ID_BYTES bytes, padding removed

describe('board id format', () => {
  it('is 16 random bytes encoded as 22 base64url characters', () => {
    expect(BOARD_ID_BYTES).toBe(16);
    expect(VALID_ID_LENGTH).toBe(Math.ceil((BOARD_ID_BYTES * 8) / 6));
    expect(BOARD_ID_PATTERN.test(idOfLength(VALID_ID_LENGTH))).toBe(true);
  });

  // TC-01: a well-formed id, both boundary lengths and three negative shapes.
  describe('isValidBoardId (TC-01)', () => {
    it('accepts a 22 character base64url id', () => {
      expect(isValidBoardId(idOfLength(VALID_ID_LENGTH))).toBe(true);
      expect(isValidBoardId(newBoardId())).toBe(true);
    });

    it('rejects 21 and 23 characters (boundary)', () => {
      expect(isValidBoardId(idOfLength(VALID_ID_LENGTH - 1))).toBe(false);
      expect(isValidBoardId(idOfLength(VALID_ID_LENGTH + 1))).toBe(false);
    });

    it('rejects characters outside the base64url alphabet, path traversal and the empty id', () => {
      // '+' is base64 but not base64url: it would end up in a URL path unencoded.
      expect(isValidBoardId(`${idOfLength(VALID_ID_LENGTH - 1)}+`)).toBe(false);
      expect(isValidBoardId('=AbCdEfGhIjKlMnOpQrSt==')).toBe(false);
      expect(isValidBoardId('../x')).toBe(false);
      expect(isValidBoardId('')).toBe(false);
    });

    it('rejects the separators that would let a request reach another route', () => {
      expect(isValidBoardId(`${idOfLength(11)}/${idOfLength(11)}`)).toBe(false);
      expect(isValidBoardId(`${idOfLength(21)}%`)).toBe(false);
    });
  });

  // TC-02: 10,000 generated ids are all well-formed and all different.
  describe('newBoardId (TC-02)', () => {
    const SAMPLES = 10_000;

    it('generates 10,000 ids that all match the pattern with no duplicates', () => {
      const seen = new Set<string>();
      for (let i = 0; i < SAMPLES; i += 1) {
        const id = newBoardId();
        if (!BOARD_ID_PATTERN.test(id)) {
          throw new Error(`id #${i} (${id}) does not match ${BOARD_ID_PATTERN}`);
        }
        expect(isValidBoardId(id)).toBe(true);
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
      expect(seen.size).toBe(SAMPLES);
    });
  });
});
