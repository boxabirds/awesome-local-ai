import { describe, expect, it } from 'vitest';
import {
  BOARD_ID_BYTES,
  BOARD_ID_PATTERN,
  isValidBoardId,
  newBoardId,
} from '../../src/shared/board-id';

/**
 * TC-01, TC-02 (`sync.worker_entry`): a board id is a 22-character base64url string, and
 * the generator only ever produces one. Validation is pure, so it needs no runtime.
 */

const BASE64URL_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** A well-formed id of `length` characters, for the boundary cases. */
function idOfLength(length: number): string {
  let id = '';
  for (let i = 0; i < length; i += 1) {
    id += BASE64URL_CHARS[(i * 7) % BASE64URL_CHARS.length] ?? 'A';
  }
  return id;
}

describe('isValidBoardId (TC-01)', () => {
  it('accepts a 22-character base64url id', () => {
    expect(BOARD_ID_BYTES).toBe(16);
    expect(idOfLength(22)).toHaveLength(22);
    expect(isValidBoardId(idOfLength(22))).toBe(true);
  });

  it('rejects 21 and 23 characters (boundary)', () => {
    expect(isValidBoardId(idOfLength(21))).toBe(false);
    expect(isValidBoardId(idOfLength(23))).toBe(false);
  });

  it('rejects characters outside base64url (negative)', () => {
    expect(isValidBoardId(`${idOfLength(21)}+`)).toBe(false);
    expect(isValidBoardId(`${idOfLength(21)}/`)).toBe(false);
    expect(isValidBoardId(`${idOfLength(21)} `)).toBe(false);
  });

  it('rejects path traversal and the empty string (negative)', () => {
    expect(isValidBoardId('../x')).toBe(false);
    expect(isValidBoardId('')).toBe(false);
    expect(isValidBoardId(`${idOfLength(18)}/..`)).toBe(false);
  });
});

describe('newBoardId (TC-02)', () => {
  it('always returns an id that isValidBoardId accepts', () => {
    for (let i = 0; i < 100; i += 1) {
      const id = newBoardId();
      expect(id).toMatch(BOARD_ID_PATTERN);
      expect(isValidBoardId(id)).toBe(true);
    }
  });

  it('returns 10,000 distinct ids', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i += 1) {
      ids.add(newBoardId());
    }
    expect(ids.size).toBe(10_000);
  });
});
