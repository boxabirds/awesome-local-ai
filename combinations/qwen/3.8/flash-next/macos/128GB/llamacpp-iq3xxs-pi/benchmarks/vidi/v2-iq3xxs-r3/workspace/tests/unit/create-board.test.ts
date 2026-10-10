/**
 * TC-04 — the strength of a board's link code (share.unguessable).
 *
 * Story 5 moves board creation to the server, so the link code is now the whole
 * access control (PRD security model): possession of the link is the only thing
 * that lets somebody edit a board. What has to be true of it is a property of
 * `newBoardId()` alone, so it is checked here, without a Worker:
 *
 *  - 22 characters from a 16-byte (128-bit) *cryptographic* random source;
 *  - 10,000 of them are distinct;
 *  - nothing about one id predicts the next one (they are not a sequence);
 *  - every character survives a chat app or an email client unedited.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BOARD_ID_BYTES, BOARD_ID_PATTERN, newBoardId } from '../../src/shared/board-id';

/** Every board of every story so far, for the uniqueness run. */
const BOARDS_CREATED = 10_000;

/** Chat-safe by construction: letters, digits, `-` and `_` (PRD constraint). */
const CHAT_SAFE = /^[A-Za-z0-9_-]+$/;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the link code of a board (TC-04)', () => {
  it('is 128 bits of randomness, encoded as 22 characters', () => {
    // `share.unguessable` names 128 bits; the setting behind it is in bytes.
    expect(BOARD_ID_BYTES * 8).toBeGreaterThanOrEqual(128);

    // Not "the setting says 16": the generator has to ask for that many bytes.
    const randomValues = vi.spyOn(globalThis.crypto, 'getRandomValues');
    const id = newBoardId();
    expect(id).toHaveLength(22);

    const askedFor = randomValues.mock.calls.map(([bytes]) => (bytes as Uint8Array).byteLength);
    expect(askedFor.length).toBeGreaterThan(0);
    for (const length of askedFor) expect(length).toBe(BOARD_ID_BYTES);
  });

  it('encodes 16 bytes as base64url without padding, so the code is exactly 22 chars', () => {
    // Deterministic bytes: the id is then known in advance, which proves both
    // the byte count and that no padding or prefix crept into the link.
    const bytes = new Uint8Array(BOARD_ID_BYTES).map((_, index) => index * 16);
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation((buffer) => {
      // Write into whatever the generator handed over: a view in Node and
      // workerd, and `getRandomValues` is expected to fill it in place.
      const target =
        buffer instanceof Uint8Array
          ? buffer
          : new Uint8Array((buffer as ArrayBufferView).buffer);
      target.set(bytes);
      return buffer;
    });
    const id = newBoardId();
    // A hand-computed base64url of the same bytes (no padding, `+` -> `-`,
    // `/` -> `_`), via the platform encoder so the test does not re-implement it.
    const padded = btoa(String.fromCharCode(...bytes));
    const expected = padded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(id).toBe(expected);
    expect(id).toHaveLength(22);
    expect(id).toMatch(BOARD_ID_PATTERN);
  });

  it('gives 10,000 created boards 10,000 different codes (share.unguessable)', () => {
    const ids: string[] = [];
    for (let index = 0; index < BOARDS_CREATED; index += 1) ids.push(newBoardId());
    expect(new Set(ids).size).toBe(BOARDS_CREATED);
    for (const id of ids) {
      expect(id).toMatch(BOARD_ID_PATTERN);
      expect(id).toMatch(CHAT_SAFE);
    }
  });

  it('does not derive one board\'s code from another, its order or the time', () => {
    // A code derived from a counter, a timestamp or any earlier code would
    // agree with its neighbours in most characters. Random 6-bit characters
    // agree in 1 of 64 positions, i.e. about 0.34 of 22.
    const ids: string[] = [];
    for (let index = 0; index < 500; index += 1) ids.push(newBoardId());

    let compared = 0;
    let equalTotal = 0;
    let equalMax = 0;
    for (let index = 0; index < ids.length - 1; index += 1) {
      const left = ids[index] as string;
      const right = ids[index + 1] as string;
      expect(left).not.toBe(right);
      let equal = 0;
      for (let at = 0; at < left.length; at += 1) if (left[at] === right[at]) equal += 1;
      compared += 1;
      equalTotal += equal;
      equalMax = Math.max(equalMax, equal);
    }
    const equalAverage = equalTotal / compared;
    expect(equalAverage).toBeLessThan(2); // 22 independent characters would average 0.34
    expect(equalMax).toBeLessThan(11); // no code is "mostly" its neighbour's

    // And they are not in the order they were made, which a timestamp or an
    // autoincrement would leave in plain sight.
    const sorted = [...ids].sort();
    const alreadySorted = ids.every((id, index) => id === sorted[index]);
    expect(alreadySorted).toBe(false);
    // Every character of the alphabet shows up in 500 codes, so no prefix is
    // reserved and nothing is countable from the outside.
    const alphabet = new Set(ids.join(''));
    expect(alphabet.size).toBe(64);
  });
});
