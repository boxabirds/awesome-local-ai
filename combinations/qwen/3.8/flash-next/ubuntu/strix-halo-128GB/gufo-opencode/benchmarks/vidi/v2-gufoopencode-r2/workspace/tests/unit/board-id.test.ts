import { describe, expect, it } from 'vitest';
import {
  BOARD_ID_BYTES,
  BOARD_ID_PATTERN,
  isValidBoardId,
  newBoardId,
} from '../../src/shared/board-id';

// TC-01: isValidBoardId — boundary (21/22/23 chars) and negative inputs.
const VALID_ID = 'Ab0-_9ZyXwVuTsRqPoNmLk'; // 22 chars, base64url alphabet

describe('isValidBoardId (TC-01)', () => {
  it('accepts a 22-char base64url id', () => {
    expect(VALID_ID).toHaveLength(22);
    expect(isValidBoardId(VALID_ID)).toBe(true);
    expect(isValidBoardId(newBoardId())).toBe(true);
  });

  it('rejects ids of the wrong length (boundary 21 / 23)', () => {
    expect(isValidBoardId(VALID_ID.slice(0, 21))).toBe(false); // 21
    expect(isValidBoardId(VALID_ID + 'H')).toBe(false); // 23
  });

  it('rejects non-base64url characters, path traversal and empty strings', () => {
    expect(isValidBoardId('Ab0+8ZyXwVuTsRqPoNmLkJ')).toBe(false); // '+' is not base64url
    expect(isValidBoardId('../x')).toBe(false);
    expect(isValidBoardId('')).toBe(false);
  });

  it('exposes the 16-byte entropy constant and a matching pattern', () => {
    expect(BOARD_ID_BYTES).toBe(16);
    expect(BOARD_ID_PATTERN.test('a'.repeat(22))).toBe(true);
    expect(BOARD_ID_PATTERN.test('a'.repeat(21))).toBe(false);
  });
});

// TC-02: newBoardId x 10,000 — all match the pattern, no duplicates.
describe('newBoardId (TC-02)', () => {
  it('generates 10,000 unique ids that all match BOARD_ID_PATTERN', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(id).toMatch(BOARD_ID_PATTERN);
      expect(isValidBoardId(id)).toBe(true);
      seen.add(id);
    }
    expect(seen.size).toBe(10_000);
  });
});
