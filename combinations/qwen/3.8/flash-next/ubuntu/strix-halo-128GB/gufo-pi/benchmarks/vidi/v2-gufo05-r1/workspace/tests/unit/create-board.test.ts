/**
 * The link code of a board (prd `share.unguessable`), tested where it is made.
 *
 * A board's whole access control is that nobody can guess its address, so the code in
 * the address has to be a fresh 128-bit draw every time and must not be built from
 * anything else — not the clock, not a counter, not another board's code. That is a
 * claim about a generator, and a generator can be tested directly: 10,000 codes, and
 * three things measured on them (TC-04).
 *
 *  - **Shape**: 22 characters of base64url, which is exactly what the pattern allows,
 *    and decodes back to `BOARD_ID_BYTES` bytes. Only letters, digits, `-` and `_`, so
 *    a chat app or an email client cannot re-encode part of it.
 *  - **Uniqueness**: 10,000 codes with no duplicate. With 128 random bits a duplicate
 *    is not a practical event, so a duplicate here means the generator is not random.
 *  - **Independence**: consecutive codes differ everywhere, and every character of the
 *    alphabet turns up in the first position. A code built from an id, a counter or a
 *    timestamp shares a prefix with its neighbours; these do not.
 *
 * The named settings the story adds are asserted here too: the PRD gives their values,
 * and a test that reads them from the config would pass whatever they were set to.
 */
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

/** The alphabet a link code may use: what chat and email apps pass through unchanged. */
const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** base64url back to bytes, so the claim "16 random bytes" is measured and not assumed. */
function decodeBase64Url(code: string): Uint8Array {
  const padded = code.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

describe('board link codes (TC-04)', () => {
  const codes = Array.from({ length: 10_000 }, () => newBoardId());

  it('every one of 10,000 codes is distinct', () => {
    // The PRD's verification case, exactly: 10,000 created boards have distinct codes.
    expect(new Set(codes).size).toBe(10_000);
  });

  it('every code is 22 characters the pattern allows, and accepted by the validator', () => {
    for (const code of codes) {
      expect(code).toHaveLength(22);
      expect(code, code).toMatch(BOARD_ID_PATTERN);
      expect(isValidBoardId(code)).toBe(true);
    }
  });

  it('a code carries the whole 128 bits and nothing outside the url-safe alphabet', () => {
    // 16 bytes is the 128 bits the PRD asks for; 22 base64url characters is what 16
    // bytes is, so the two figures have to agree with each other.
    expect(BOARD_ID_BYTES * 8).toBeGreaterThanOrEqual(128);
    for (const code of codes.slice(0, 500)) {
      expect(decodeBase64Url(code)).toHaveLength(BOARD_ID_BYTES);
      for (const character of code) expect(BASE64URL_ALPHABET).toContain(character);
    }
  });

  it('is not built from the clock, an order, or the code before it', () => {
    // A code derived from anything sequential shares its leading characters with its
    // neighbours. Back-to-back codes differ in nearly every position here, and the
    // first character alone takes all 64 values inside one batch.
    const firsts = new Set<string>();
    let differing = 0;
    let compared = 0;
    for (let index = 1; index < codes.length; index += 1) {
      const previous = codes[index - 1] as string;
      const current = codes[index] as string;
      firsts.add(current[0] as string);
      for (let position = 0; position < current.length; position += 1) {
        differing += previous[position] === current[position] ? 0 : 1;
        compared += 1;
      }
    }
    expect(firsts.size).toBe(BASE64URL_ALPHABET.length);
    // Two independent 128-bit draws agree in one position in 1/64 of the cases. Allowing
    // a generous margin, a code with a fixed prefix or a slowly-changing tail falls far
    // short of this.
    expect(differing / compared).toBeGreaterThan(0.9);
  });

  it('rejects anything that is not a code, without a look at storage', () => {
    for (const candidate of ['abc', '', 'a'.repeat(21), 'a'.repeat(23), 'a'.repeat(22) + '/', 'a b'.padEnd(22, '-')]) {
      expect(isValidBoardId(candidate), candidate).toBe(false);
    }
  });
});

describe('story 5 settings', () => {
  it('holds the values the PRD names', () => {
    // `share.create`: a board opens within 2 seconds of the click.
    expect(CREATE_BUDGET_MS).toBe(2000);
    // `share.copy`: "Link copied" shows for 2 seconds.
    expect(LINK_COPIED_MS).toBe(2000);
    // `share.unreachable`: retries start at a second and double to the same cap the
    // board connection already uses.
    expect(BOARD_CHECK_RETRY_BASE_MS).toBe(1000);
    expect(BOARD_CHECK_RETRY_BASE_MS).toBeLessThan(RECONNECT_MAX_BACKOFF_MS);
  });
});
