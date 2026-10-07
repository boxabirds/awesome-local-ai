import { describe, expect, it } from 'vitest';
import {
  BOARD_ID_BYTES,
  BOARD_ID_PATTERN,
  isValidBoardId,
  newBoardId,
} from '../../src/shared/board-id';

// TC-01 / TC-02 (sync.worker_entry): board addresses are pure functions, so the
// route guard and the generator are covered here rather than in workerd.

describe('isValidBoardId (TC-01)', () => {
  it('accepts a generated id', () => {
    expect(isValidBoardId(newBoardId())).toBe(true);
  });

  it('accepts a 22-character base64url string', () => {
    expect(isValidBoardId('KWobTWj7bGzX9Hx3YQ8pZA')).toBe(true);
    expect(isValidBoardId('-_AAAAAAAAAAAAAAAAAAAA')).toBe(true); // 22 chars
  });

  // Boundary values from the design: 21 / 22 / 23 characters.
  it('rejects 21 and 23 characters', () => {
    expect(isValidBoardId('a'.repeat(21))).toBe(false);
    expect(isValidBoardId('a'.repeat(23))).toBe(false);
  });

  it('rejects characters outside the base64url alphabet', () => {
    expect(isValidBoardId('KWobTWj7bGzX9Hx3YQ8pZ+')).toBe(false); // '+' is not base64url
    expect(isValidBoardId('KWobTWj7bGzX9Hx3YQ8pZ=')).toBe(false); // padding
    expect(isValidBoardId('KWobTWj7bGzX9Hx3YQ8pZ/')).toBe(false);
  });

  it('rejects path traversal and the empty string', () => {
    expect(isValidBoardId('../x')).toBe(false);
    expect(isValidBoardId('')).toBe(false);
  });
});

describe('newBoardId (TC-02)', () => {
  it('generates 10,000 ids that all match the pattern, with no duplicates', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(id).toMatch(BOARD_ID_PATTERN);
      ids.add(id);
    }
    expect(ids.size).toBe(10_000);
  });

  it('encodes exactly BOARD_ID_BYTES bytes into 22 characters (no padding)', () => {
    expect(BOARD_ID_BYTES).toBe(16);
    expect(newBoardId()).toHaveLength(22);
  });
});
