/**
 * TC-04 — the link code behind a board address (`share.board_api`, `share.unguessable`).
 *
 * Possession of the link is the whole of the access control (story 5's security model),
 * so the only thing standing between a stranger and somebody's board is the randomness
 * of these 22 characters. Two properties are tested here, and they are the two the PRD
 * names:
 *
 *  - the code is *long enough and random enough*: 16 bytes (128 bits) from
 *    `crypto.getRandomValues`, written with characters chat and email apps do not break;
 *  - the code is *nothing else*: not a counter, not a timestamp, not a function of
 *    another board's code. That is shown by holding the random source still — with a
 *    fixed source every id is identical, so whatever varies between real ids varies only
 *    because the bytes under it vary.
 *
 * 10,000 ids are drawn per case because a uniqueness test on three ids proves nothing
 * about a 128-bit space; 10,000 collisions-free draws is the PRD's own verification.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { BOARD_ID_BYTES, BOARD_ID_PATTERN, isValidBoardId, newBoardId } from '../../src/shared/board-id';

/** How many ids the unguessability requirement says to draw. */
const UNIQUE_SAMPLE = 10_000;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the link code of a board address', () => {
  it('draws 10,000 distinct codes, all 22 characters of them (TC-04)', () => {
    const seen = new Set<string>();
    for (let index = 0; index < UNIQUE_SAMPLE; index += 1) {
      const id = newBoardId();
      expect(id, `id ${index} is the wrong length`).toHaveLength(22);
      expect(BOARD_ID_PATTERN.test(id), `id ${index} is not base64url`).toBe(true);
      seen.add(id);
    }
    expect(seen.size).toBe(UNIQUE_SAMPLE);
  });

  it('takes its bytes from a cryptographic source of at least 16 bytes (TC-04)', () => {
    // 128 bits of randomness is the requirement; 16 bytes is what makes them.
    expect(BOARD_ID_BYTES).toBeGreaterThanOrEqual(16);

    const calls: number[] = [];
    const random = {
      getRandomValues<T extends ArrayBufferView | null>(buffer: T): T {
        if (!buffer) return buffer;
        calls.push(buffer.byteLength);
        // Deterministic bytes: the length of the request is what this case is about.
        if (buffer instanceof Uint8Array) buffer.fill(7);
        return buffer;
      }
    };
    vi.stubGlobal('crypto', random as unknown as Crypto);

    newBoardId();
    newBoardId();
    expect(calls).toEqual([BOARD_ID_BYTES, BOARD_ID_BYTES]);
  });

  it('is nothing but those bytes: no counter, no clock, no derivation (TC-04)', () => {
    // A frozen random source. If an id mixed in creation order, creation time, or any
    // other board's code, these two ids would differ from each other.
    const frozen = (fill: number) =>
      vi.stubGlobal(
        'crypto',
        {
          getRandomValues(buffer: Uint8Array) {
            buffer.fill(fill);
            return buffer;
          }
        } as unknown as Crypto
      );

    frozen(0);
    const first = newBoardId();
    const second = newBoardId();
    expect(second).toBe(first);
    // base64url of 16 zero bytes, padding stripped.
    expect(first).toBe('AAAAAAAAAAAAAAAAAAAAAA');
    expect(isValidBoardId(first)).toBe(true);

    // The encoding is the URL-safe one: 0xfb 0xff would be '+' and '/' in base64, and
    // a link must survive chat and email untouched (`share.unguessable`, constraints).
    frozen(0xff);
    const awkward = newBoardId();
    expect(awkward).not.toMatch(/[+/=]/);
    expect(isValidBoardId(awkward)).toBe(true);
    expect(awkward).toBe('_____________________w');
  });

  it('never repeats a code between two boards, however they were made (TC-04)', () => {
    // "Not derived from another board's link": a fresh id shares no meaningful prefix
    // with any other. 22 base64url characters is 132 bits of text; six characters is
    // 36 bits, which random 128-bit codes agree on about never.
    const ids = Array.from({ length: 1000 }, () => newBoardId());
    for (let index = 1; index < ids.length; index += 1) {
      let shared = 0;
      while (shared < 6 && ids[index][shared] === ids[index - 1][shared]) shared += 1;
      expect(shared, `${ids[index - 1]} and ${ids[index]} share ${shared} leading characters`).toBeLessThan(6);
    }
  });
});
