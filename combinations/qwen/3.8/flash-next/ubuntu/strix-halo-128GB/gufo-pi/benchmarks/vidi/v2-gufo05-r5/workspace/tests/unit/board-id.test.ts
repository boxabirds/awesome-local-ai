/**
 * board.id unit tests (TC-01, TC-02): the shape of a board address.
 *
 * An address is the only thing standing between a stranger and a board's contents until
 * story 14 adds sign-in, so validation is exact (length and alphabet) and generation must
 * never repeat.
 */
import { describe, expect, test } from 'vitest';
import {
  BOARD_ID_BYTES,
  BOARD_ID_PATTERN,
  isValidBoardId,
  newBoardId,
} from '../../src/shared/board-id';

/** 22 characters of base64url that is definitely not generated here. */
const A_VALID_ID = 'Zm9vYmFyYmF6cXV1eA1234'; // exactly 22 chars, alphabet-legal

/** The same shape with a `+` at the end (base64, not base64url). */
const WITH_PLUS = 'Zm9vYmFyYmF6cXV1eA123+'; // exactly 22 chars, one illegal

/** A path traversal attempt: `/` and `.` are outside the alphabet. */
const TRAVERSAL = '../x';

describe('isValidBoardId (TC-01)', () => {
  test('accepts a 22-character base64url id', () => {
    expect(A_VALID_ID).toHaveLength(22);
    expect(isValidBoardId(A_VALID_ID)).toBe(true);
  });

  test('rejects 21 and 23 characters (boundary values)', () => {
    expect(isValidBoardId(A_VALID_ID.slice(0, 21))).toBe(false);
    expect(isValidBoardId(`${A_VALID_ID}x`)).toBe(false);
  });

  test('rejects a "+" character, a path traversal and the empty string', () => {
    expect(isValidBoardId(WITH_PLUS)).toBe(false);
    expect(isValidBoardId(TRAVERSAL)).toBe(false);
    expect(isValidBoardId('')).toBe(false);
  });

  test('accepts every id newBoardId can produce', () => {
    // the alphabet includes '-' and '_', which a naive [A-Za-z0-9] check would reject
    let checked = 0;
    for (let i = 0; i < 500; i += 1) {
      const id = newBoardId();
      if (!isValidBoardId(id)) {
        throw new Error(`newBoardId produced an id that does not validate: ${id}`);
      }
      checked += 1;
    }
    expect(checked).toBe(500);
  });
});

describe('newBoardId (TC-02)', () => {
  test('generates 10,000 ids that all match the pattern and never repeat', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i += 1) {
      const id = newBoardId();
      expect(BOARD_ID_PATTERN.test(id)).toBe(true);
      expect(id).toHaveLength(22);
      seen.add(id);
    }
    expect(seen.size).toBe(10_000);
  });

  test('is built from 16 random bytes, i.e. has no padding and no fixed characters', () => {
    expect(BOARD_ID_BYTES).toBe(16);
    const id = newBoardId();
    expect(id).not.toContain('=');
    // 16 bytes cannot be encoded in fewer than 22 characters, and no padding is used
    expect(id.length).toBe(Math.ceil((BOARD_ID_BYTES * 8) / 6));
  });
});
