import { describe, it, expect } from 'vitest';
import {
  isValidBoardId,
  newBoardId,
  BOARD_ID_PATTERN,
  BOARD_ID_BYTES,
} from '../../src/shared/board-id.ts';

// TC-01: id validation, including the 21/22/23-char length boundary and
// characters that must not appear.
describe('isValidBoardId (TC-01)', () => {
  it('accepts a valid 22-char base64url id', () => {
    const id = newBoardId();
    expect(id).toHaveLength(22);
    expect(isValidBoardId(id)).toBe(true);
    expect(BOARD_ID_PATTERN.test(id)).toBe(true);
  });

  it('rejects 21 and 23 chars (length boundary)', () => {
    const base = newBoardId();
    expect(isValidBoardId(base.slice(0, 21))).toBe(false);
    expect(isValidBoardId(base + 'a')).toBe(false);
  });

  it('rejects a "+" char (not in the base64url alphabet)', () => {
    // 21 chars + a '+' would be 22 chars but '+' is not base64url.
    const withPlus = newBoardId().slice(0, 21) + '+';
    expect(withPlus).toHaveLength(22);
    expect(isValidBoardId(withPlus)).toBe(false);
  });

  it('rejects a path-traversal id', () => {
    expect(isValidBoardId('../x')).toBe(false);
  });

  it('rejects the empty string', () => {
    expect(isValidBoardId('')).toBe(false);
  });
});

// TC-02: the generator produces pattern-valid ids and never repeats one.
describe('newBoardId (TC-02)', () => {
  it('produces 10,000 pattern-valid ids with no duplicates', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(id).toMatch(BOARD_ID_PATTERN);
      expect(id).toHaveLength(BOARD_ID_BYTES > 0 ? 22 : 0);
      seen.add(id);
    }
    expect(seen.size).toBe(10_000);
  });
});
