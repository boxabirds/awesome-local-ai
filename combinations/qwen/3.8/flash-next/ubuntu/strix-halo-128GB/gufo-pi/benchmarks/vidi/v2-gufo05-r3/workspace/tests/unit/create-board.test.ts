/**
 * Link-code strength (story 5, task 1): TC-04 (`share.unguessable`).
 *
 * Board creation is server-side, but the code behind a board link is the
 * story-3 generator, and it is that generator the whole "links cannot be
 * guessed" requirement rests on. So it is tested here, at the unit level, the
 * way the design names it: ten thousand codes, all well formed, none repeated,
 * each from a fresh 16-byte (128-bit) draw of the cryptographic random source.
 */
import { describe, expect, it } from 'vitest';

import {
  BOARD_ID_BYTES,
  BOARD_ID_PATTERN,
  isValidBoardId,
  newBoardId,
} from '../../src/shared/board-id';
import { CREATE_BUDGET_MS, LINK_COPIED_MS, BOARD_CHECK_RETRY_BASE_MS } from '../../src/shared/config';

describe('link codes are unguessable (TC-04)', () => {
  it('draws 128 bits — 16 random bytes per code', () => {
    expect(BOARD_ID_BYTES).toBe(16);
  });

  it('produces 10,000 codes that are all 22 chars matching the pattern and all distinct', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(id.length).toBe(22);
      expect(id).toMatch(BOARD_ID_PATTERN);
      expect(isValidBoardId(id)).toBe(true);
      seen.add(id);
    }
    expect(seen.size).toBe(10_000);
  });

  it('uses only characters chat and email apps do not re-encode (letters, digits, hyphen, underscore)', () => {
    for (let i = 0; i < 500; i++) {
      expect(newBoardId()).toMatch(/^[A-Za-z0-9_-]{22}$/);
    }
  });

  it('never derives a code from time or creation order', () => {
    // Two codes generated back-to-back share no predictable prefix or suffix:
    // every one of the 22 characters varies across a sample, so nothing in a
    // code comes from a counter, the clock or another code.
    const sample = Array.from({ length: 2000 }, () => newBoardId());
    // The 22nd character carries only the final 2 bits (128 = 21*6 + 2), so it
    // can take only 4 values by construction; the other 21 are full 6-bit draws.
    for (let column = 0; column < 21; column++) {
      const distinct = new Set(sample.map((id) => id[column]));
      // A counter or timestamp column would leave most values identical; a
      // uniform 64-symbol column over 2000 draws hits ~all symbols it can.
      expect(distinct.size, `column ${column} looks random`).toBeGreaterThan(40);
    }
  });
});

describe('story 5 named settings', () => {
  it('exposes the link-copied duration, creation budget and check-retry base', () => {
    expect(CREATE_BUDGET_MS).toBe(2000);
    expect(LINK_COPIED_MS).toBe(2000);
    expect(BOARD_CHECK_RETRY_BASE_MS).toBe(1000);
  });
});
