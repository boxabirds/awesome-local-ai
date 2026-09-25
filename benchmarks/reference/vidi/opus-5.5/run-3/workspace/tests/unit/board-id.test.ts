import { describe, expect, it } from 'vitest';
import { BOARD_ID_BYTES, BOARD_ID_PATTERN, isValidBoardId, newBoardId } from '../../src/shared/board-id';

describe('TC-01 isValidBoardId', () => {
  it('accepts a 22-character base64url id', () => {
    expect(isValidBoardId('AbCdEfGhIjKlMnOpQr_-09')).toBe(true);
  });
  it.each([
    ['21 characters', 'AbCdEfGhIjKlMnOpQr_-0'],
    ['23 characters', 'AbCdEfGhIjKlMnOpQr_-091'],
    ["a '+' character", 'AbCdEfGhIjKlMnOpQr+-09'],
    ['a path', '../x'],
    ['empty', ''],
  ])('rejects %s', (_label, id) => {
    expect(isValidBoardId(id)).toBe(false);
  });
});

describe('TC-02 newBoardId', () => {
  it('generates 10,000 distinct ids that all match the pattern', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(id).toMatch(BOARD_ID_PATTERN);
      ids.add(id);
    }
    expect(ids.size).toBe(10_000);
  });
  it('encodes BOARD_ID_BYTES random bytes', () => {
    const b64 = newBoardId().replace(/-/g, '+').replace(/_/g, '/') + '==';
    expect(atob(b64)).toHaveLength(BOARD_ID_BYTES);
  });
});
