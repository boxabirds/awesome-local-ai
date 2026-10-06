import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BOARD_ID_BYTES,
  BOARD_ID_PATTERN,
  isValidBoardId,
  newBoardId,
} from '../../src/shared/board-id.js';
import { BOARD_CHECK_RETRY_BASE_MS, CREATE_BUDGET_MS, LINK_COPIED_MS } from '../../src/shared/config.js';

/**
 * TC-04 (design "Board creation and existence API", unit scope): the link code
 * `createBoard` puts into a board's address is `newBoardId()` — 16 bytes (128
 * bits) from the cryptographic random source, rendered as 22 base64url
 * characters, never derived from anything else (PRD `share.unguessable`).
 *
 * Generation is the only part of `share.board_api` that is a pure function, so
 * it is the part tested here rather than through the Worker. "10,000 created
 * boards have distinct codes" and "codes are produced from a cryptographic
 * random source of at least 16 bytes, are 22 characters long" are both read
 * straight off the generator; the request-handling half of the requirement is
 * in `tests/integration/board-api.test.ts`.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the link code is 128 random bits (TC-04)', () => {
  it('gives 10,000 codes that are all 22 characters and all distinct', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 10_000; i += 1) {
      const id = newBoardId();
      expect(id).toMatch(BOARD_ID_PATTERN);
      expect(id).toHaveLength(22);
      expect(isValidBoardId(id)).toBe(true);
      codes.add(id);
    }
    expect(codes.size).toBe(10_000);
  });

  it('asks the cryptographic random source for 16 bytes every time', () => {
    const source = crypto.getRandomValues.bind(crypto);
    const sizes: number[] = [];
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(
      ((bytes: Uint8Array) => {
        sizes.push(bytes.byteLength);
        return source(bytes);
      }) as typeof crypto.getRandomValues,
    );

    const id = newBoardId();
    expect(sizes).toEqual([BOARD_ID_BYTES]);
    expect(BOARD_ID_BYTES).toBe(16); // 16 bytes is the 128 bits the PRD names.
    expect(id).toMatch(BOARD_ID_PATTERN);
  });

  it('is nothing but those bytes: the same bytes give the same code', () => {
    // A code derived from the clock, a counter or another board's code would
    // change between two calls that were handed the same random bytes. This one
    // does not, because the bytes are all there is in it.
    const bytes = new Uint8Array(BOARD_ID_BYTES).fill(0);
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(
      ((target: Uint8Array) => {
        target.set(bytes);
        return target;
      }) as typeof crypto.getRandomValues,
    );
    const first = newBoardId();
    const second = newBoardId();
    expect(second).toBe(first);
    expect(first).toMatch(BOARD_ID_PATTERN);

    // …and every byte of the code follows from the bytes: changing the last byte
    // changes the code, so none of the 128 bits is thrown away by accident.
    bytes[BOARD_ID_BYTES - 1] = 1;
    expect(newBoardId()).not.toBe(first);
  });

  it('does not step with creation order or time', () => {
    // Consecutive codes share no visible counter: they differ in their first
    // character as often as their last, which is what a random source gives and
    // what a sequence does not.
    const codes = Array.from({ length: 200 }, () => newBoardId());
    const firsts = new Set(codes.map((code) => code[0]));
    expect(firsts.size).toBeGreaterThan(10);
    expect(new Set(codes).size).toBe(200);
  });
});

describe('the settings a shared link needs (named settings)', () => {
  it('has the values the PRD names', () => {
    expect(CREATE_BUDGET_MS).toBe(2000); // share.create: opened within 2 seconds.
    expect(LINK_COPIED_MS).toBe(2000); // share.copy: "Link copied" for 2 seconds.
    expect(BOARD_CHECK_RETRY_BASE_MS).toBe(1000); // share.unreachable: retry backoff base.
  });
});
