/**
 * The link code (share.unguessable, TC-04): every board id is 22 characters of
 * base64url drawn from BOARD_ID_BYTES (16 = 128 bits) of cryptographic randomness,
 * so a code cannot practically be guessed or derived from another board's link.
 *
 * This is the test-first unit coverage the design puts in
 * `tests/unit/create-board.test.ts`: it pins the code format and uniqueness
 * before the server-side creation that will hand these ids out.
 *
 * Spec: spec/stories/005-share-a-board-with-others-using-a-link/design.md,
 * "Board creation and existence API" (share.board_api), TC-04.
 */
import { describe, expect, it } from 'vitest';
import {
  BOARD_ID_BYTES,
  BOARD_ID_PATTERN,
  isValidBoardId,
  newBoardId,
} from '../../src/shared/board-id';

/** 16 random bytes are 128 bits: the strength PRD share.unguessable names. */
const BITS_OF_RANDOMNESS = BOARD_ID_BYTES * 8;

describe('a link code is unguessable (TC-04)', () => {
  it('is drawn from at least 128 bits of randomness', () => {
    expect(BITS_OF_RANDOMNESS).toBeGreaterThanOrEqual(128);
    expect(BOARD_ID_BYTES).toBeGreaterThanOrEqual(16);
  });

  it('is 22 characters long and matches BOARD_ID_PATTERN, 10,000 times', () => {
    for (let i = 0; i < 10_000; i += 1) {
      const id = newBoardId();
      expect(id).toHaveLength(22);
      expect(BOARD_ID_PATTERN.test(id)).toBe(true);
      expect(isValidBoardId(id)).toBe(true);
    }
  });

  it('produces 10,000 distinct codes', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 10_000; i += 1) codes.add(newBoardId());
    expect(codes.size).toBe(10_000);
  });

  it('is not derived from time, order or another code', () => {
    // Successive codes share no predictable prefix: if the id came from a
    // counter or a timestamp, an early prefix would be constant across the run.
    const prefixLen = 4;
    const prefixes = new Set<string>();
    for (let i = 0; i < 5_000; i += 1) prefixes.add(newBoardId().slice(0, prefixLen));
    // 5,000 draws spread over ~1.4M possible 4-char prefixes: the count of
    // distinct prefixes stays near the draw count. A time/counter source would
    // leave only a handful.
    expect(prefixes.size).toBeGreaterThan(4_000);
  });
});
