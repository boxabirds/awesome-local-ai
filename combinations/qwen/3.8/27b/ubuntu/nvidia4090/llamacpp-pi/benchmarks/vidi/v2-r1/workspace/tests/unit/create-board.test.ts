// TC-04 (story 5): link-code strength for share.unguessable.
//
// Every board link must carry a code that cannot be guessed or derived from
// anything else: 16 random bytes (128 bits) from crypto.getRandomValues,
// base64url-encoded without padding → 22 characters of letters, digits,
// hyphen and underscore only (safe in chat and email).

import { describe, it, expect } from 'vitest';
import { BOARD_ID_BYTES, BOARD_ID_PATTERN, isValidBoardId, newBoardId } from '../../src/shared/board-id';

describe('board id (share.unguessable)', () => {
  it('TC-04: codes are 128 bits of randomness from 16 random bytes', () => {
    expect(BOARD_ID_BYTES).toBe(16);
  });

  it('TC-04: 10,000 new ids are all unique', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i += 1) ids.add(newBoardId());
    expect(ids.size).toBe(10_000);
  });

  it('TC-04: every id is 22 characters matching BOARD_ID_PATTERN', () => {
    for (let i = 0; i < 10_000; i += 1) {
      const id = newBoardId();
      expect(id).toHaveLength(22);
      expect(id).toMatch(BOARD_ID_PATTERN);
      expect(isValidBoardId(id)).toBe(true);
    }
  });

  it('TC-04: the pattern admits only chat-safe characters (letters, digits, hyphen, underscore)', () => {
    // 21 chars: too short.
    expect(isValidBoardId('a'.repeat(21))).toBe(false);
    // 23 chars: too long.
    expect(isValidBoardId('a'.repeat(23))).toBe(false);
    // Wrong characters: slash, dot, plus and whitespace are all rejected.
    expect(isValidBoardId(`${'a'.repeat(21)}/`)).toBe(false);
    expect(isValidBoardId(`${'a'.repeat(21)}.`)).toBe(false);
    expect(isValidBoardId(`${'a'.repeat(21)}+`)).toBe(false);
    expect(isValidBoardId(`${'a'.repeat(21)} `)).toBe(false);
  });
});
