// Unit tests for board addresses (design "sync.worker_entry"): TC-01 shape
// validation with boundary lengths and negatives, TC-02 generated-id shape and
// uniqueness over 10,000 draws.
import { describe, expect, it } from 'vitest';

import {
  BOARD_ID_BYTES,
  BOARD_ID_PATTERN,
  isValidBoardId,
  newBoardId,
} from '../../src/shared/board-id';

describe('isValidBoardId (TC-01)', () => {
  it('accepts a 22-character base64url string', () => {
    expect(isValidBoardId('ABCDEFGHabcdefgh0123-_')).toBe(true);
  });

  it('accepts the id newBoardId generates', () => {
    expect(isValidBoardId(newBoardId())).toBe(true);
  });

  it('rejects 21 characters (one short of the boundary)', () => {
    expect(isValidBoardId('ABCDEFGHabcdefgh0123-')).toBe(false);
  });

  it('rejects 23 characters (one over the boundary)', () => {
    expect(isValidBoardId('ABCDEFGHabcdefgh0123-_x')).toBe(false);
  });

  it('rejects a padded/plus character outside the base64url alphabet', () => {
    expect(isValidBoardId('ABCDEFGHabcdefgh0123+_')).toBe(false);
    expect(isValidBoardId('ABCDEFGHabcdefgh0123/_')).toBe(false);
    expect(isValidBoardId('ABCDEFGHabcdefgh0123==')).toBe(false);
  });

  it('rejects a path traversal attempt', () => {
    expect(isValidBoardId('../x')).toBe(false);
  });

  it('rejects the empty string', () => {
    expect(isValidBoardId('')).toBe(false);
  });
});

describe('newBoardId (TC-02)', () => {
  it('generates ids that match the pattern, drawn 10,000 times without repeats', () => {
    const seen = new Set<string>();
    for (let attempt = 0; attempt < 10_000; attempt += 1) {
      const id = newBoardId();
      expect(id).toMatch(BOARD_ID_PATTERN);
      expect(id.length).toBe(22);
      seen.add(id);
    }
    expect(seen.size).toBe(10_000);
  });

  it('draws from 16 random bytes', () => {
    expect(BOARD_ID_BYTES).toBe(16);
  });
});
