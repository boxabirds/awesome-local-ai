import { describe, expect, it } from 'vitest';
import {
  BOARD_ID_BYTES,
  BOARD_ID_PATTERN,
  isValidBoardId,
  newBoardId,
} from '../../src/shared/board-id';

/**
 * sync.worker_entry unit tests (design TC-01, TC-02).
 */

describe('board ids (TC-01, TC-02)', () => {
  it('TC-01: accepts a well-formed 22-char base64url id and rejects malformed ones', () => {
    // 22 characters of [A-Za-z0-9_-] (boundary: exact length)
    const valid = 'ab12CD34-_ef56GH78ij90';
    expect(valid.length).toBe(22);
    expect(BOARD_ID_PATTERN.test(valid)).toBe(true);
    expect(isValidBoardId(valid)).toBe(true);

    // boundary: one short
    expect(isValidBoardId(valid.slice(0, 21))).toBe(false);
    // boundary: one long
    expect(isValidBoardId(valid + 'x')).toBe(false);

    // '+' is not base64url
    expect(isValidBoardId(valid.slice(0, 10) + '+' + valid.slice(11))).toBe(false);
    // '/' is not base64url
    expect(isValidBoardId(valid.slice(0, 10) + '/' + valid.slice(11))).toBe(false);
    // path traversal and empty
    expect(isValidBoardId('../x')).toBe(false);
    expect(isValidBoardId('')).toBe(false);
    // not a string-shaped value at all
    expect(isValidBoardId(valid.toUpperCase().replace('AB', 'äB'))).toBe(false);
  });

  it('TC-02: 10,000 generated ids all match the pattern and are unique', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(BOARD_ID_PATTERN.test(id)).toBe(true);
      expect(id.length).toBe(22);
      seen.add(id);
    }
    expect(seen.size).toBe(10_000);
    // every generated id validates
    for (const id of seen) {
      expect(isValidBoardId(id)).toBe(true);
    }
    // entropy sanity: 16 bytes = 128 bits
    expect(BOARD_ID_BYTES).toBe(16);
  });
});
