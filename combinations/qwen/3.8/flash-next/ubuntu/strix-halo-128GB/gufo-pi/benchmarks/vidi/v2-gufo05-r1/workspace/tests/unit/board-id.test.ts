/**
 * TC-01, TC-02 — board ids.
 *
 * A board id is the only thing separating two people's boards in this story, so
 * it has to be exactly the shape the router accepts and it has to be unique
 * enough that generating a lot of them never collides.
 */
import { describe, expect, it } from 'vitest';

import { BOARD_ID_BYTES, BOARD_ID_PATTERN, isValidBoardId, newBoardId } from '../../src/shared/board-id';

/** A valid id of a given length, made of characters the pattern allows. */
function idOfLength(length: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_';
  let id = '';
  for (let index = 0; index < length; index += 1) {
    id += alphabet[index % alphabet.length];
  }
  return id;
}

describe('isValidBoardId (TC-01)', () => {
  it('accepts a 22-character base64url id', () => {
    expect(isValidBoardId(idOfLength(22))).toBe(true);
  });

  it('rejects an id that is one character too short', () => {
    expect(isValidBoardId(idOfLength(21))).toBe(false);
  });

  it('rejects an id that is one character too long', () => {
    expect(isValidBoardId(idOfLength(23))).toBe(false);
  });

  it('rejects padding and the non-URL-safe base64 characters', () => {
    expect(isValidBoardId('AAAAAAAAAAAAAAAAAAAAA+')).toBe(false);
    expect(isValidBoardId('AAAAAAAAAAAAAAAAAAAAA/')).toBe(false);
    expect(isValidBoardId('AAAAAAAAAAAAAAAAAAAAAA==')).toBe(false);
  });

  it('rejects a path traversal attempt', () => {
    expect(isValidBoardId('../x')).toBe(false);
  });

  it('rejects the empty string', () => {
    expect(isValidBoardId('')).toBe(false);
  });

  it('rejects whitespace and dots', () => {
    expect(isValidBoardId(' AAAAAAAAAAAAAAAAAAAAAA')).toBe(false);
    expect(isValidBoardId('AAAAAAAAAAAAAAAAAAAA.A')).toBe(false);
  });
});

describe('newBoardId (TC-02)', () => {
  it('generates 10,000 ids that all match the pattern and never repeat', () => {
    const seen = new Set<string>();
    for (let index = 0; index < 10_000; index += 1) {
      const id = newBoardId();
      expect(id).toMatch(BOARD_ID_PATTERN);
      expect(isValidBoardId(id)).toBe(true);
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
    expect(seen.size).toBe(10_000);
  });

  it('encodes BOARD_ID_BYTES bytes as 22 characters', () => {
    // 16 bytes is 128 bits: ceil(16 / 3) * 4 = 24 base64 characters, minus the
    // two padding characters that 16 bytes would produce.
    expect(Math.ceil(BOARD_ID_BYTES / 3) * 4 - 2).toBe(22);
    expect(newBoardId()).toHaveLength(22);
  });
});
