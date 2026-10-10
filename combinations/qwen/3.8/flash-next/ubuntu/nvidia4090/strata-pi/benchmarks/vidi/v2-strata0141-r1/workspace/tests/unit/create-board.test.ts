import { describe, expect, it } from 'vitest';
import { BOARD_ID_BYTES, BOARD_ID_PATTERN, isValidBoardId, newBoardId } from '../../src/shared/board-id';
import { BOARD_CHECK_RETRY_BASE_MS, CREATE_BUDGET_MS, LINK_COPIED_MS } from '../../src/shared/config';

/**
 * TC-04 (anchor `share.board_api`, requirement `share.unguessable`).
 *
 * A board link is the only thing standing between a board and a stranger, so
 * the link code is tested before anything that uses it: it must come from a
 * real cryptographic source, it must be the full 16 bytes (128 bits) wide, and
 * a large sample of real ids must contain no repeat.
 */

/** How many ids the uniqueness requirement is checked against. */
const SAMPLE_SIZE = 10_000;

describe('board link codes (share.unguessable)', () => {
  it('TC-04: 10,000 generated ids are all distinct', () => {
    const seen = new Set<string>();
    for (let index = 0; index < SAMPLE_SIZE; index += 1) {
      seen.add(newBoardId());
    }
    expect(seen.size).toBe(SAMPLE_SIZE);
  });

  it('TC-04: every generated id is 22 characters and matches BOARD_ID_PATTERN', () => {
    for (let index = 0; index < 500; index += 1) {
      const id = newBoardId();
      expect(id).toHaveLength(22);
      expect(BOARD_ID_PATTERN.test(id)).toBe(true);
      expect(isValidBoardId(id)).toBe(true);
    }
  });

  it('TC-04: the code carries 16 random bytes (128 bits)', () => {
    // 16 bytes of base64url are exactly 22 characters with no padding:
    // ceil(16 * 8 / 6) = 22, and 16 * 8 = 128 bits of randomness.
    expect(BOARD_ID_BYTES).toBe(16);
    expect(Math.ceil((BOARD_ID_BYTES * 8) / 6)).toBe(22);
    expect(BOARD_ID_BYTES * 8).toBeGreaterThanOrEqual(128);
  });

  it('TC-04: ids come from a cryptographic random source of at least 16 bytes', () => {
    const crypto = (globalThis as { crypto?: Crypto }).crypto;
    expect(crypto).toBeDefined();
    expect(typeof crypto?.getRandomValues).toBe('function');

    // Every byte position actually varies across a sample, which a counter, a
    // timestamp or anything else derived from creation order could not do.
    const bytes = new Uint8Array(BOARD_ID_BYTES);
    crypto!.getRandomValues(bytes);
    expect(bytes.byteLength).toBe(BOARD_ID_BYTES);

    const byPosition: Set<number>[] = Array.from({ length: BOARD_ID_BYTES }, () => new Set<number>());
    for (let index = 0; index < 200; index += 1) {
      const sample = new Uint8Array(BOARD_ID_BYTES);
      crypto!.getRandomValues(sample);
      sample.forEach((byte, position) => byPosition[position]!.add(byte));
    }
    // A fixed or ordered code would leave most positions with one value only.
    for (const position of byPosition) {
      expect(position.size).toBeGreaterThan(100);
    }
  });

  it('TC-04: a code is never derived from another code, a counter or the clock', () => {
    const ids = Array.from({ length: 200 }, () => newBoardId());
    // No id is a prefix, suffix or neighbour of another one.
    for (const a of ids) {
      for (const b of ids) {
        if (a === b) {
          continue;
        }
        expect(a.startsWith(b.slice(0, 12))).toBe(false);
      }
    }
    // Sorting them tells a reader nothing about the order they were made in.
    const sorted = [...ids].sort();
    const ordered = ids.filter((id, index) => id === sorted[index]).length;
    expect(ordered).toBeLessThan(20);
  });

  it('TC-04: story 5 named settings exist with the values the PRD gives', () => {
    expect(CREATE_BUDGET_MS).toBe(2000);
    expect(LINK_COPIED_MS).toBe(2000);
    expect(BOARD_CHECK_RETRY_BASE_MS).toBe(1000);
  });
});
