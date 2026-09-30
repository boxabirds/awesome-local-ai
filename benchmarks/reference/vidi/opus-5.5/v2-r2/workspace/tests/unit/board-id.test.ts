import { describe, expect, it } from 'vitest';
import { BOARD_ID_PATTERN, isValidBoardId, newBoardId } from '../../src/shared/board-id';

describe('isValidBoardId (TC-01)', () => {
  const valid = 'AbCdEfGhIjKlMnOpQr_-09';

  it('accepts a 22-character base64url id', () => {
    expect(valid).toHaveLength(22);
    expect(isValidBoardId(valid)).toBe(true);
  });

  it.each([
    ['21 characters', valid.slice(0, 21)],
    ['23 characters', `${valid}A`],
    ["a '+' character", `${valid.slice(0, 21)}+`],
    ['a path traversal', '../x'],
    ['an empty string', ''],
  ])('rejects %s', (_label, id) => {
    expect(isValidBoardId(id)).toBe(false);
  });
});

describe('newBoardId (TC-02)', () => {
  it('generates 10,000 unique ids matching the pattern', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(id).toMatch(BOARD_ID_PATTERN);
      ids.add(id);
    }
    expect(ids.size).toBe(10_000);
  });
});
