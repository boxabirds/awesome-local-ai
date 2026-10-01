import { describe, expect, it } from 'vitest';
import { BOARD_ID_PATTERN, isValidBoardId, newBoardId } from '../../src/shared/board-id';

describe('isValidBoardId (TC-01)', () => {
  const valid = 'abcdefghijklmnopqrstuv';
  it('accepts 22 base64url characters', () => {
    expect(valid).toHaveLength(22);
    expect(isValidBoardId(valid)).toBe(true);
    expect(isValidBoardId('A-_0123456789abcdefghi')).toBe(true);
  });
  it('rejects 21 and 23 characters', () => {
    expect(isValidBoardId(valid.slice(1))).toBe(false);
    expect(isValidBoardId(valid + 'x')).toBe(false);
  });
  it('rejects bad characters, path traversal and empty', () => {
    expect(isValidBoardId('abcdefghijklmnopqrstu+')).toBe(false);
    expect(isValidBoardId('../x')).toBe(false);
    expect(isValidBoardId('')).toBe(false);
  });
});

describe('newBoardId (TC-02)', () => {
  it('generates 10,000 unique ids matching the pattern', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(BOARD_ID_PATTERN.test(id)).toBe(true);
      seen.add(id);
    }
    expect(seen.size).toBe(10_000);
  });
});
