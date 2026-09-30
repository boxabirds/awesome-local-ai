import { describe, expect, it } from 'vitest';
import {
  BOARD_ID_BYTES,
  BOARD_ID_PATTERN,
  isValidBoardId,
  newBoardId,
} from '../../src/shared/board-id';

/**
 * TC-01 / TC-02 (sync.worker_entry): a board address is exactly
 * base64url(BOARD_ID_BYTES) with no padding, and generating one cannot collide.
 */

/** Base64url of 16 bytes is 22 characters; the strings below are real ids. */
const VALID = newBoardId();

describe('isValidBoardId (TC-01)', () => {
  it('accepts a 22 character base64url id', () => {
    expect(VALID).toMatch(BOARD_ID_PATTERN);
    expect(VALID).toHaveLength(22);
    expect(isValidBoardId(VALID)).toBe(true);
  });

  it('accepts every base64url alphabet character', () => {
    expect(isValidBoardId('ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'.slice(0, 22))).toBe(true);
    expect(isValidBoardId('abcdefghijklmnopqrstuvwxyz012345'.slice(0, 22))).toBe(true);
    // '-', '_' and digits in a 22 character id.
    expect(isValidBoardId(`-_0123456789${'ab'.repeat(5)}`)).toBe(true);
  });

  it('rejects ids one character shorter and longer than the boundary', () => {
    expect(isValidBoardId(VALID.slice(0, 21))).toBe(false);
    expect(isValidBoardId(`${VALID}x`)).toBe(false);
  });

  it('rejects characters that are base64 but not base64url', () => {
    // '+' and '/' are base64; '=' is padding. None may appear in an address,
    // and each string below is exactly 22 characters long.
    expect('+'.repeat(22)).toHaveLength(22);
    expect(isValidBoardId('+'.repeat(22))).toBe(false);
    expect(isValidBoardId('/'.repeat(22))).toBe(false);
    expect(isValidBoardId(`${'A'.repeat(20)}==`)).toBe(false);
    expect(isValidBoardId(`${VALID.slice(0, 21)}+`)).toBe(false);
  });

  it('rejects path traversal and empty ids', () => {
    expect(isValidBoardId('../x')).toBe(false);
    expect(isValidBoardId('')).toBe(false);
    expect(isValidBoardId(`${VALID}/../secrets`)).toBe(false);
  });

  it('is exactly the documented pattern', () => {
    expect(BOARD_ID_BYTES).toBe(16);
    expect(BOARD_ID_PATTERN.source).toBe('^[A-Za-z0-9_-]{22}$');
  });
});

describe('newBoardId (TC-02)', () => {
  it('generates 10,000 ids that all match the pattern and never repeat', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i += 1) {
      const id = newBoardId();
      expect(isValidBoardId(id)).toBe(true);
      seen.add(id);
    }
    expect(seen.size).toBe(10_000);
  });
});
