import { describe, expect, it } from 'vitest';
import { BOARD_ID_BYTES, BOARD_ID_PATTERN, isValidBoardId, newBoardId } from '../../src/shared/board-id';

// Length of unpadded base64url for BOARD_ID_BYTES bytes.
const ID_LENGTH = Math.ceil((BOARD_ID_BYTES * 8) / 6);

describe('TC-01 isValidBoardId', () => {
  const valid = 'AbCdEfGhIjKlMnOpQr_-09';

  it('accepts a 22-character base64url id', () => {
    expect(valid).toHaveLength(ID_LENGTH);
    expect(isValidBoardId(valid)).toBe(true);
  });

  it('rejects one character too short or too long (boundary)', () => {
    expect(isValidBoardId(valid.slice(1))).toBe(false);
    expect(isValidBoardId(`${valid}A`)).toBe(false);
  });

  it.each([
    ['a "+" character', 'AbCdEfGhIjKlMnOpQr+-09'],
    ['a "/" character', 'AbCdEfGhIjKlMnOpQr/-09'],
    ['padding', 'AbCdEfGhIjKlMnOpQr_-0='],
    ['a path', '../x'],
    ['an empty string', ''],
    ['a trailing newline', `${valid}\n`],
  ])('rejects %s', (_label, id) => {
    expect(isValidBoardId(id)).toBe(false);
  });
});

describe('TC-02 newBoardId', () => {
  it('generates 10,000 unique ids that all match the pattern', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(id).toMatch(BOARD_ID_PATTERN);
      ids.add(id);
    }
    expect(ids.size).toBe(10_000);
  });

  it('encodes exactly BOARD_ID_BYTES random bytes as base64url', () => {
    const id = newBoardId();
    const bytes = Buffer.from(id, 'base64url');
    expect(bytes).toHaveLength(BOARD_ID_BYTES);
    expect(bytes.toString('base64url')).toBe(id);
  });
});
