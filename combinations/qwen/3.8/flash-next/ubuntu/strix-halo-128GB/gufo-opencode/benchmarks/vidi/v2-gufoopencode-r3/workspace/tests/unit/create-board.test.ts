import { describe, expect, it } from 'vitest';
import {
  BOARD_ID_BYTES,
  BOARD_ID_PATTERN,
  newBoardId
} from '../../src/shared/board-id';

// TC-04 (PRD share.unguessable): link codes come from a cryptographic
// random source of at least 16 bytes, are 22 characters long, and 10,000
// generated ids are all distinct. Nothing here is derived from time,
// counters or another id; ids are pure crypto output.
describe('board id strength for share links (TC-04)', () => {
  it('uses a >= 16-byte cryptographic random source', () => {
    expect(BOARD_ID_BYTES).toBeGreaterThanOrEqual(16);
    // newBoardId must consume crypto.getRandomValues (not Math.random).
    const calls: number[] = [];
    const original = crypto.getRandomValues.bind(crypto);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (crypto as any).getRandomValues = <T extends Uint8Array>(bytes: T): T => {
      calls.push(bytes.length);
      return original(bytes);
    };
    try {
      newBoardId();
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (crypto as any).getRandomValues = original;
    }
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(16);
  });

  it('every id is 22 characters matching BOARD_ID_PATTERN', () => {
    for (let i = 0; i < 1000; i += 1) {
      const id = newBoardId();
      expect(id).toHaveLength(22);
      expect(BOARD_ID_PATTERN.test(id)).toBe(true);
    }
  });

  it('10,000 generated ids are all unique', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i += 1) ids.add(newBoardId());
    expect(ids.size).toBe(10_000);
  });
});
