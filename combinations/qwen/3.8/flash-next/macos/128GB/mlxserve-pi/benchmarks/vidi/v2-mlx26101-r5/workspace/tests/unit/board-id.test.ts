/**
 * TC-01, TC-02 (sync.worker_entry): board ids are 22 base64url characters, the
 * validator accepts exactly that shape and the generator only ever produces it.
 */

import { describe, expect, it } from 'vitest';

import { BOARD_ID_BYTES, BOARD_ID_PATTERN, isValidBoardId, newBoardId } from '../../src/shared/board-id';

/** 22 characters, used for the positive case and as the boundary reference. */
const VALID = 'Zm9vYmFyYmFyMTIzNDU2Nzg5MDE';
const VALID_22 = `${VALID}x`.slice(0, 22);

describe('isValidBoardId', () => {
  // TC-01 positive: 22 base64url characters.
  it('accepts a 22-character base64url id', () => {
    expect(VALID_22).toHaveLength(22);
    expect(isValidBoardId(VALID_22)).toBe(true);
  });

  it('accepts every id newBoardId generates', () => {
    for (let i = 0; i < 50; i += 1) expect(isValidBoardId(newBoardId())).toBe(true);
  });

  // TC-01 boundaries: one character either side of 22.
  it('rejects a 21-character id', () => {
    expect(VALID_22.slice(0, 21)).toHaveLength(21);
    expect(isValidBoardId(VALID_22.slice(0, 21))).toBe(false);
  });

  it('rejects a 23-character id', () => {
    expect(`${VALID_22}x`).toHaveLength(23);
    expect(isValidBoardId(`${VALID_22}x`)).toBe(false);
  });

  // TC-01 negatives: characters outside base64url, path traversal, empty.
  it('rejects an id containing a base64 "+"', () => {
    expect(isValidBoardId('++++++++++++++++++++++')).toBe(false);
  });

  it('rejects an id containing a base64 "/" and a "=" padding character', () => {
    expect(isValidBoardId('//////////////////////')).toBe(false);
    expect(isValidBoardId('abcdefghijklmnopqrstu=')).toBe(false);
  });

  it('rejects a path traversal attempt', () => {
    expect(isValidBoardId('../x')).toBe(false);
  });

  it('rejects an empty id and whitespace', () => {
    expect(isValidBoardId('')).toBe(false);
    expect(isValidBoardId(' ')).toBe(false);
    expect(isValidBoardId(`${VALID_22}\n`)).toBe(false);
  });

  it('exposes the pattern it uses so tests can share it', () => {
    expect(BOARD_ID_PATTERN.test(VALID_22)).toBe(true);
    expect(BOARD_ID_BYTES).toBe(16);
  });
});

describe('newBoardId', () => {
  // TC-02: 10,000 ids, all well-formed, none repeated.
  it('generates 10,000 unique ids that all match the pattern', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i += 1) {
      const id = newBoardId();
      expect(id).toMatch(BOARD_ID_PATTERN);
      seen.add(id);
    }
    expect(seen.size).toBe(10_000);
  });
});
