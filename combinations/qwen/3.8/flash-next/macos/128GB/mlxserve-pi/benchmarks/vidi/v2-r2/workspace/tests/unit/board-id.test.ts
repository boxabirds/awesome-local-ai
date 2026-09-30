// board-id unit tests (TC-01, TC-02). Board ids are 16 random bytes as unpadded
// base64url; validation gates the Worker route before any object is created.

import { describe, expect, it } from 'vitest';
import {
  BOARD_ID_BYTES,
  BOARD_ID_PATTERN,
  isValidBoardId,
  newBoardId,
} from '../../src/shared/board-id';

/** base64url of `bytes`, no padding — the same shape newBoardId must produce. */
function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('TC-01 isValidBoardId', () => {
  it('accepts a 22-char base64url id (16 bytes, no padding)', () => {
    expect(isValidBoardId(newBoardId())).toBe(true);
    // a hand-built valid id, independent of the generator
    const id = base64url(new Uint8Array(BOARD_ID_BYTES).fill(251));
    expect(id).toHaveLength(22);
    expect(isValidBoardId(id)).toBe(true);
  });

  it('rejects ids of the wrong length (21 and 23 boundary)', () => {
    expect(isValidBoardId('A'.repeat(21))).toBe(false);
    expect(isValidBoardId('A'.repeat(23))).toBe(false);
    expect(isValidBoardId('A'.repeat(22))).toBe(true);
  });

  it("rejects '+' (base64, not base64url)", () => {
    expect(isValidBoardId('A'.repeat(21) + '+')).toBe(false);
  });

  it("rejects a path traversal and the empty string", () => {
    expect(isValidBoardId('../x')).toBe(false);
    expect(isValidBoardId('')).toBe(false);
  });
});

describe('TC-02 newBoardId', () => {
  it('produces 10,000 ids that all match the pattern, none repeated', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(id).toMatch(BOARD_ID_PATTERN);
      expect(id).toHaveLength(22);
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
    expect(seen.size).toBe(10_000);
  });
});
