import { describe, expect, it } from 'vitest';
import { BOARD_ID_PATTERN, isValidBoardId, newBoardId } from '../../src/shared/board-id';

describe('isValidBoardId (TC-01)', () => {
  it('accepts a 22-character base64url id', () => {
    expect(isValidBoardId('AbCdEfGhIjKlMnOpQr_-09')).toBe(true);
  });

  it('rejects 21 and 23 characters (boundary)', () => {
    expect(isValidBoardId('A'.repeat(21))).toBe(false);
    expect(isValidBoardId('A'.repeat(23))).toBe(false);
  });

  it("rejects '+', path traversal and empty", () => {
    expect(isValidBoardId('AbCdEfGhIjKlMnOpQr+-09')).toBe(false);
    expect(isValidBoardId('../x')).toBe(false);
    expect(isValidBoardId('')).toBe(false);
  });
});

describe('newBoardId (TC-02)', () => {
  it('generates 10,000 unique ids that all match the pattern', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(id).toMatch(BOARD_ID_PATTERN);
      ids.add(id);
    }
    expect(ids.size).toBe(10_000);
  });
});
