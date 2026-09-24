import { describe, expect, it } from 'vitest';
import { BOARD_ID_PATTERN, isValidBoardId, newBoardId } from '../../src/shared/board-id';

const VALID_LENGTH = 22;
const GENERATED_COUNT = 10_000;

describe('TC-01 isValidBoardId', () => {
  const valid = 'AbCdEfGhIjKlMnOpQr_-09';

  it('accepts a 22-character base64url id', () => {
    expect(valid).toHaveLength(VALID_LENGTH);
    expect(isValidBoardId(valid)).toBe(true);
  });

  it('rejects 21 and 23 characters (boundaries)', () => {
    expect(isValidBoardId(valid.slice(1))).toBe(false);
    expect(isValidBoardId(`${valid}A`)).toBe(false);
  });

  it("rejects '+', path traversal and the empty string", () => {
    expect(isValidBoardId(`${valid.slice(1)}+`)).toBe(false);
    expect(isValidBoardId('../x')).toBe(false);
    expect(isValidBoardId('')).toBe(false);
  });
});

describe('TC-02 newBoardId', () => {
  it(`generates ${GENERATED_COUNT} distinct ids that all match the pattern`, () => {
    const ids = new Set<string>();
    for (let i = 0; i < GENERATED_COUNT; i += 1) {
      const id = newBoardId();
      expect(id).toMatch(BOARD_ID_PATTERN);
      ids.add(id);
    }
    expect(ids.size).toBe(GENERATED_COUNT);
  });
});
