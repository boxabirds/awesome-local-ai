import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BOARD_ID_BYTES,
  BOARD_ID_PATTERN,
  isValidBoardId,
  newBoardId,
} from '../../src/shared/board-id';
import { BOARD_CHECK_RETRY_BASE_MS, CREATE_BUDGET_MS, LINK_COPIED_MS } from '../../src/shared/config';

/**
 * TC-04 (`share.unguessable`, unit layer): the link code is 128 bits of cryptographic
 * randomness, 22 characters long, distinct across 10,000 boards, and derived from
 * nothing but those random bytes — never from order, time, or another board's id.
 *
 * This is the test-first half of task 1: it holds the link-code strength story 5
 * promises to the same `newBoardId()` story 3 introduced, which is exactly what
 * `src/worker/create-board.ts` calls.
 */

/** The sample size PRD `share.unguessable` names ("10,000 created boards have distinct codes"). */
const SAMPLES = 10_000;

/** base64url without padding, back to bytes: the exact inverse of `newBoardId`'s encoding. */
function decodeId(id: string): Uint8Array {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (const character of id) {
    const value = ALPHABET.indexOf(character);
    if (value < 0) throw new Error(`character ${character} is not base64url`);
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[index] = (buffer >>> bits) & 0xff;
      index += 1;
    }
  }
  if (index !== BOARD_ID_BYTES) throw new Error(`decoded ${index} bytes, expected ${BOARD_ID_BYTES}`);
  return bytes;
}

describe('board link codes cannot be guessed (TC-04)', () => {
  it('comes from at least 16 cryptographic random bytes', () => {
    const randomValues = vi.spyOn(globalThis.crypto, 'getRandomValues');
    const id = newBoardId();
    expect(randomValues).toHaveBeenCalledTimes(1);
    const askedFor = randomValues.mock.calls[0]?.[0];
    expect((askedFor as Uint8Array).length).toBeGreaterThanOrEqual(16);
    expect(BOARD_ID_BYTES * 8).toBeGreaterThanOrEqual(128);
    // 22 characters is what 16 bytes come to once the padding is dropped.
    expect(id).toHaveLength(22);
    expect(decodeId(id)).toHaveLength(BOARD_ID_BYTES);
    randomValues.mockRestore();
  });

  it('gives 10,000 boards codes that are all 22 characters and all different', () => {
    const ids: string[] = [];
    for (let i = 0; i < SAMPLES; i += 1) {
      const id = newBoardId();
      expect(id, `id #${i}`).toHaveLength(22);
      expect(BOARD_ID_PATTERN.test(id), `id #${i} (${id})`).toBe(true);
      expect(isValidBoardId(id), `id #${i} (${id})`).toBe(true);
      ids.push(id);
    }
    expect(new Set(ids).size).toBe(SAMPLES);
  });

  it('only ever uses characters chat and email apps do not re-encode', () => {
    // Letters, digits, hyphen and underscore: nothing percent-encoding survives a URL path.
    for (let i = 0; i < 500; i += 1) expect(newBoardId()).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it('does not derive a code from creation order, time, or another code', () => {
    const ids = Array.from({ length: 64 }, () => newBoardId());
    const bytes = ids.map((id) => decodeId(id));
    // Successive codes share no prefix beyond the first byte, and their first differing
    // byte is early and large: a counter, a timestamp or any other derivation would show
    // a long common prefix and small differences.
    let shortestPrefix = Infinity;
    let smallestFirstDifference = Infinity;
    let changedBytes = Infinity;
    for (let i = 1; i < bytes.length; i += 1) {
      let shared = 0;
      while (shared < BOARD_ID_BYTES && bytes[i][shared] === bytes[i - 1][shared]) shared += 1;
      let differing = -1;
      let differences = 0;
      for (let b = 0; b < BOARD_ID_BYTES; b += 1) {
        if (bytes[i][b] !== bytes[i - 1][b]) {
          if (differing === -1) differing = b;
          differences += 1;
        }
      }
      shortestPrefix = Math.min(shortestPrefix, shared);
      smallestFirstDifference = Math.min(
        smallestFirstDifference,
        differing === -1 ? 0 : Math.abs(bytes[i][differing] - bytes[i - 1][differing]),
      );
      changedBytes = Math.min(changedBytes, differences);
    }
    expect(shortestPrefix).toBeLessThanOrEqual(1);
    // A 128-bit random step changes most of the 16 bytes; half of them would be chance.
    expect(changedBytes).toBeGreaterThan(BOARD_ID_BYTES / 2);

    // A counter or a timestamp occupies the same bytes in every id of a run, so those
    // bytes would be nearly constant across 1,000 codes. Random bytes are not.
    const sample = Array.from({ length: 1_000 }, () => decodeId(newBoardId()));
    for (let position = 0; position < BOARD_ID_BYTES; position += 1) {
      const values = sample.map((bytes) => bytes[position]);
      const spread = Math.max(...values) - Math.min(...values);
      expect(spread, `byte ${position} spans too little of 0..255`).toBeGreaterThan(180);
    }
  });

  it('names the settings the PRD asks for', () => {
    expect(CREATE_BUDGET_MS).toBe(2_000); // share.create
    expect(LINK_COPIED_MS).toBe(2_000); // share.copy
    expect(BOARD_CHECK_RETRY_BASE_MS).toBe(1_000); // share.unreachable
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
