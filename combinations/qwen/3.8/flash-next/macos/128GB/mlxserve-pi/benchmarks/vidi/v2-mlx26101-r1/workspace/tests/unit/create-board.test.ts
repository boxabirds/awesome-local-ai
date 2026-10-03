// share.board_api (unit): the link code behind a board address (TC-04).
//
// share.unguessable says a board link carries at least 128 bits of randomness, is
// 22 characters long, that 10,000 created boards have distinct codes, and that a
// code is never derived from creation order, time, creator or another board's
// link. This suite tests the code generator the server-side create path
// (`createBoard` → `newBoardId()`) is built on — the HTTP contract around it is
// integration work (tests/integration/board-api.test.ts).

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BOARD_ID_BYTES,
  BOARD_ID_PATTERN,
  isValidBoardId,
  newBoardId,
} from '../../src/shared/board-id';
import { CREATE_BUDGET_MS } from '../../src/shared/config';

/** How many codes the PRD's verification asks for. */
const SAMPLE = 10_000;

describe('board link codes are unguessable (TC-04)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('draws its randomness from a cryptographic source of 16 bytes (128 bits)', () => {
    const calls: number[] = [];
    const original = crypto.getRandomValues.bind(crypto);
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(
      <T extends ArrayBufferView | null>(values: T): T => {
        if (values && values.byteLength !== undefined) {
          calls.push(values.byteLength);
          original(values);
        }
        return values;
      },
    );

    const id = newBoardId();

    // Exactly one draw, of exactly BOARD_ID_BYTES bytes — the 128 bits the PRD
    // names. A code built from a counter, a timestamp or `Math.random` would
    // produce no such call at all.
    expect(calls).toEqual([BOARD_ID_BYTES]);
    expect(BOARD_ID_BYTES * 8).toBe(128);
    expect(id).toHaveLength(22);
  });

  it(`generates ${SAMPLE} distinct codes, all 22 characters of URL-safe alphabet`, () => {
    const seen = new Set<string>();
    for (let i = 0; i < SAMPLE; i++) {
      const id = newBoardId();
      expect(id).toHaveLength(22);
      expect(BOARD_ID_PATTERN.test(id)).toBe(true);
      expect(isValidBoardId(id)).toBe(true);
      seen.add(id);
    }
    // 10,000 created boards, 10,000 distinct codes (share.unguessable).
    expect(seen.size).toBe(SAMPLE);
  });

  it('is not derived from creation order, time, or a neighbouring code', () => {
    // Successive codes (creation order) share no prefix, suffix or length pattern,
    // and a code carries no digits of the clock that produced it.
    const epoch = String(Date.now());
    const sequential: string[] = [];
    for (let i = 0; i < 200; i++) sequential.push(newBoardId());

    const unique = new Set(sequential);
    expect(unique.size).toBe(sequential.length);
    // The shortest common prefix of two neighbours of a counter-based (or sorted)
    // sequence is long; here neighbours start out different.
    let longestCommonPrefix = 0;
    for (let i = 1; i < sequential.length; i++) {
      let n = 0;
      while (n < 22 && sequential[i - 1]![n] === sequential[i]![n]) n += 1;
      longestCommonPrefix = Math.max(longestCommonPrefix, n);
    }
    expect(longestCommonPrefix).toBeLessThan(6);

    // No code contains the current epoch millisecond, so a code is not a re-hashing
    // of the clock and cannot be derived from when the board was made.
    for (const id of sequential) expect(id.includes(epoch.slice(0, 8))).toBe(false);
  });

  it('rejects malformed ids without throwing (the 404 rule, not a 500)', () => {
    for (const bad of ['', 'abc', 'a'.repeat(21), 'a'.repeat(23), 'a'.repeat(40), 'bad/id', 'bad id', 'a'.repeat(22) + '!']) {
      expect(isValidBoardId(bad)).toBe(false);
    }
    expect(isValidBoardId(newBoardId())).toBe(true);
  });

  it('CREATE_BUDGET_MS is the share.create budget the e2e workflow logs against', () => {
    expect(CREATE_BUDGET_MS).toBe(2000);
  });
});
