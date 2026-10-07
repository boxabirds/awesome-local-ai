import { describe, expect, it } from 'vitest';
import {
  BOARD_ID_BYTES,
  BOARD_ID_PATTERN,
  base64UrlEncode,
  isValidBoardId,
  newBoardId,
} from '../../src/shared/board-id';
import {
  BOARD_CHECK_RETRY_BASE_MS,
  CREATE_BUDGET_MS,
  LINK_COPIED_MS,
} from '../../src/shared/config';

/**
 * TC-04 (share.unguessable): a board's link code is 128 bits of cryptographic
 * randomness, written in the alphabet chat and email apps never re-encode, and it
 * says nothing about when the board was made or which board came before it.
 *
 * This is the test-first unit coverage for the board API (task 1): the strength of
 * the code is a pure property of the generator, so it is proved here — in bytes and
 * in odds — rather than through HTTP.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Decode unpadded base64url back to bytes (the inverse of `base64UrlEncode`). */
function base64UrlDecode(text: string): Uint8Array {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of text) {
    const value = ALPHABET.indexOf(char);
    if (value < 0) throw new Error(`not a base64url character: ${char}`);
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  if (buffer & ((1 << bits) - 1)) throw new Error(`${text}: non-canonical trailing bits`);
  return Uint8Array.from(bytes);
}

describe('TC-04 link codes cannot be guessed (share.unguessable)', () => {
  it('10,000 codes are all distinct and all well-formed', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(id).toHaveLength(22);
      expect(id).toMatch(BOARD_ID_PATTERN);
      expect(isValidBoardId(id)).toBe(true);
      ids.add(id);
    }
    expect(ids.size).toBe(10_000);
  });

  it('a code carries exactly BOARD_ID_BYTES (16 = 128 bits) of randomness', () => {
    expect(BOARD_ID_BYTES).toBe(16);
    for (let i = 0; i < 500; i++) {
      const id = newBoardId();
      const bytes = base64UrlDecode(id);
      expect(bytes).toHaveLength(BOARD_ID_BYTES);
      // Round-trip: the code holds nothing but those 16 bytes — no padding, no flag
      // bits, nothing a board's creation order could hide in.
      expect(base64UrlEncode(bytes)).toBe(id);
    }
  });

  it('uses the whole 22-character alphabet evenly enough to be random, not counted', () => {
    const counts = new Map<string, number>();
    const samples = 5_000;
    for (let i = 0; i < samples; i++) {
      const first = newBoardId()[0]!;
      counts.set(first, (counts.get(first) ?? 0) + 1);
    }
    // 64 possible first characters, ~78 expected each; requiring every one to show
    // up is a 1-in-10^43 event for a counter, and a coin flip for a real generator.
    expect(counts.size).toBe(64);
    for (const [, count] of counts) expect(count).toBeGreaterThan(20);
  });

  it('never orders its codes by creation order, time or any other code', () => {
    const ids = Array.from({ length: 2_000 }, () => newBoardId());
    let increasing = 0;
    let decreasing = 0;
    for (let i = 1; i < ids.length; i++) {
      if (ids[i]! > ids[i - 1]!) increasing += 1;
      else decreasing += 1;
    }
    // A code derived from creation order or a timestamp sorts one way only. A random
    // one goes up about as often as it goes down.
    expect(increasing).toBeGreaterThan(200);
    expect(decreasing).toBeGreaterThan(200);
    // Two codes made back to back share no prefix worth guessing from.
    expect(ids[0]!.slice(0, 8)).not.toBe(ids[1]!.slice(0, 8));
  });

  it('exposes the story 5 settings the pages and panels read', () => {
    expect(CREATE_BUDGET_MS).toBe(2000); // PRD share.create
    expect(LINK_COPIED_MS).toBe(2000); // PRD share.copy
    expect(BOARD_CHECK_RETRY_BASE_MS).toBe(1000); // PRD share.unreachable
  });
});
