import { describe, expect, it } from 'vitest';
import {
  BOARD_ID_BYTES,
  BOARD_ID_PATTERN,
  isValidBoardId,
  newBoardId,
} from '../../src/shared/board-id';
import {
  BOARD_CHECK_RETRY_BASE_MS,
  CREATE_BUDGET_MS,
  LINK_COPIED_MS,
  RECONNECT_MAX_BACKOFF_MS,
} from '../../src/shared/config';

/**
 * TC-04 (`share.board_api`, share.unguessable): the link code.
 *
 * The whole access control of a board is the link, so the code in it has to be something
 * nobody can guess and nobody can derive from another board's link. Both of those come from
 * the same fact, which is what this suite pins down: the code is 16 bytes - 128 bits - out of
 * `crypto.getRandomValues`, written in a 22-character base64url alphabet. A 22-character
 * base64url code carries exactly 16 bytes (16 * 8 / 6 = 21.33, rounded up), which is why the
 * length and the byte count are asserted together rather than separately.
 *
 * Creation itself is server-side from this story on (`src/worker/create-board.ts` calls the
 * same generator), so the strength of a link is decided by the one function below - and this
 * is the test that says it is strong enough, at the same 10,000-sample size the PRD's
 * verification names.
 */

/** The characters a base64url code is allowed to use - and nothing else. */
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/**
 * Characters a chat or email client can be trusted not to break or re-encode. The PRD's
 * privacy constraint is the reason the alphabet is base64url rather than base64: `+` and `/`
 * both survive a URL but neither survives a careless client.
 */
const SAFE_IN_CHAT = /^[A-Za-z0-9_-]{22}$/;

describe('the board link code (TC-04, share.unguessable)', () => {
  it('is 16 bytes - 128 bits - of randomness', () => {
    expect(BOARD_ID_BYTES).toBe(16);
    expect(BOARD_ID_BYTES * 8).toBe(128);
  });

  it('produces 10,000 distinct codes, every one of them well-formed', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 10_000; i += 1) {
      const code = newBoardId();
      expect(code).toHaveLength(22);
      expect(code).toMatch(BOARD_ID_PATTERN);
      expect(code).toMatch(BASE64URL);
      expect(code).toMatch(SAFE_IN_CHAT);
      expect(isValidBoardId(code)).toBe(true);
      codes.add(code);
    }
    expect(codes.size).toBe(10_000);
  });

  it('is not derived from when, or in what order, it was made', () => {
    // Codes made one after another share no prefix beyond what 128 random bits guarantees by
    // chance, and the shortest common prefix of two of them is a couple of characters - never
    // the leading run a counter, a timestamp or a sequence would leave.
    const codes = Array.from({ length: 200 }, () => newBoardId());
    let longestCommonPrefix = 0;
    for (let i = 0; i < codes.length; i += 1) {
      for (let j = i + 1; j < codes.length; j += 1) {
        const a = codes[i]!;
        const b = codes[j]!;
        let shared = 0;
        while (shared < a.length && a[shared] === b[shared]) {
          shared += 1;
        }
        longestCommonPrefix = Math.max(longestCommonPrefix, shared);
      }
    }
    // 128 random bits make a 6-character prefix shared by two of 20,000 codes a
    // one-in-hundreds-of-millions event; a time- or counter-derived code would show one
    // dozens of characters long.
    expect(longestCommonPrefix).toBeLessThan(6);
  });

  it('carries no digits in the order the codes were created', () => {
    // Sequential creation would put the counter somewhere in the code, and a counter grows
    // monotonically: two codes made in a row would differ only in their final characters, and
    // every code would be numerically between its neighbours. Random bytes differ all over.
    const codes = Array.from({ length: 500 }, () => newBoardId());
    const differingFromFirst = codes.slice(1).map((code) => {
      const first = codes[0]!;
      let positions = 0;
      for (let i = 0; i < first.length; i += 1) {
        if (first[i] !== code[i]) {
          positions += 1;
        }
      }
      return positions;
    });
    // On average 21 of the 22 characters differ between two random codes; a counter in the
    // last characters would leave 20 or 21 of them identical.
    const leastDiffering = Math.min(...differingFromFirst);
    expect(leastDiffering).toBeGreaterThan(10);
  });
});

describe('the named settings this story adds', () => {
  it('gives the creation budget, the confirmation and the retry base their product values', () => {
    expect(CREATE_BUDGET_MS).toBe(2000);
    expect(LINK_COPIED_MS).toBe(2000);
    expect(BOARD_CHECK_RETRY_BASE_MS).toBe(1000);
    // The backoff ceiling belongs to story 3 and is what the link check caps at.
    expect(BOARD_CHECK_RETRY_BASE_MS).toBeLessThan(RECONNECT_MAX_BACKOFF_MS);
  });
});
