import { describe, expect, it } from 'vitest';

import {
  BOARD_ID_BYTES,
  BOARD_ID_PATTERN,
  isValidBoardId,
  newBoardId,
} from '../../src/shared/board-id.js';

/**
 * TC-01 / TC-02 (design "Worker entry and routing", unit scope): a board id is
 * unpadded base64url of 16 random bytes. Validation and generation are pure,
 * so they are tested here rather than through the Worker.
 */

/** An id made of 22 base64url characters (the kind `newBoardId` produces). */
const VALID = 'vN8d2mKx1pQ0tY7rZ4wL3A';

describe('isValidBoardId (TC-01)', () => {
  it('accepts a 22-character base64url id', () => {
    expect(isValidBoardId(VALID)).toBe(true);
  });

  it('accepts every base64url character', () => {
    expect(isValidBoardId('ABCDEFGHIJKLMNOPQRSTUV')).toBe(true);
    expect(isValidBoardId('abcdefghijklmnopqrstuv')).toBe(true);
    expect(isValidBoardId('0123456789-_-__ABCDEF1')).toBe(true);
  });

  // Boundary: the length is exactly 22 characters, so 21 and 23 are rejected.
  it('rejects 21 and 23 characters', () => {
    expect(isValidBoardId(VALID.slice(0, 21))).toBe(false);
    expect(isValidBoardId(`${VALID}x`)).toBe(false);
  });

  it('rejects characters outside the base64url alphabet', () => {
    // Always at the right length, so the character is the reason for the 'false'.
    // '+' and '/' are standard base64 but not base64url; '=' is padding, which
    // an unpadded encoding never carries.
    expect(isValidBoardId(`${VALID.slice(0, 21)}+`)).toBe(false);
    expect(isValidBoardId(`${VALID.slice(0, 21)}/`)).toBe(false);
    expect(isValidBoardId(`${VALID.slice(0, 21)}=`)).toBe(false);
  });

  it('rejects a path traversal attempt', () => {
    expect(isValidBoardId('../x')).toBe(false);
  });

  it('rejects the empty string', () => {
    expect(isValidBoardId('')).toBe(false);
  });

  it('has the documented pattern and byte count', () => {
    expect(BOARD_ID_BYTES).toBe(16);
    expect(BOARD_ID_PATTERN.test(VALID)).toBe(true);
    expect(BOARD_ID_PATTERN.test(`${VALID}x`)).toBe(false);
    // 16 bytes are 128 bits: 22 base64url characters carry the last 4 bits.
    expect(Math.ceil((BOARD_ID_BYTES * 8) / 6)).toBe(22);
  });
});

describe('newBoardId (TC-02)', () => {
  it('generates 10,000 ids that all match the pattern with no duplicates', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i += 1) {
      const id = newBoardId();
      expect(id).toMatch(BOARD_ID_PATTERN);
      ids.add(id);
    }
    expect(ids.size).toBe(10_000);
  });

  it('generates ids that are valid according to isValidBoardId', () => {
    for (let i = 0; i < 20; i += 1) {
      expect(isValidBoardId(newBoardId())).toBe(true);
    }
  });
});
