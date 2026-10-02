/**
 * TC-01, TC-02 — board addresses (design anchor `sync.worker_entry`, unit level).
 *
 * A board id is a URL path segment, so its length and alphabet are the contract:
 * 22 base64url characters, nothing else. The invalid cases are the boundaries
 * (21 / 22 / 23 characters) and the characters that must never be accepted.
 */
import { describe, expect, it } from 'vitest';

import { BOARD_ID_BYTES, BOARD_ID_PATTERN, isValidBoardId, newBoardId } from '../../src/shared/board-id';

/**
 * base64url of `bytes` without padding, written here so the test does not grade
 * the generator with the generator.
 */
function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

/** A well-formed address, built independently of `newBoardId`. */
const VALID_ID = base64url(Uint8Array.from({ length: BOARD_ID_BYTES }, (_, i) => i * 7 + 3));

describe('isValidBoardId', () => {
  // TC-01: one valid address and every invalid class the contract names.
  it('accepts a 22-character base64url address', () => {
    expect(VALID_ID).toHaveLength(22);
    expect(isValidBoardId(VALID_ID)).toBe(true);
  });

  it.each([
    ['21 characters (one short)', VALID_ID.slice(0, 21)],
    ['23 characters (one long)', `${VALID_ID}z`],
    ['a base64 character that is not URL-safe', `${VALID_ID.slice(0, 21)}+`],
    ['a path traversal attempt', '../x'],
    ['the empty string', ''],
    ['a path that is not one segment', `${VALID_ID}/notes`],
    ['a character outside the alphabet', `${VALID_ID.slice(0, 21)}!`],
  ])('rejects %s', (_label, id) => {
    expect(isValidBoardId(id)).toBe(false);
  });

  it('rejects the empty string and accepts every address the generator makes', () => {
    expect(isValidBoardId('')).toBe(false);
    expect(isValidBoardId(newBoardId())).toBe(true);
  });
});

describe('newBoardId', () => {
  // TC-02: 10,000 addresses all match the pattern and none collide.
  it('makes 10,000 addresses that all match the pattern and never repeat', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(BOARD_ID_PATTERN.test(id)).toBe(true);
      seen.add(id);
    }
    expect(seen.size).toBe(10_000);
  });
});
