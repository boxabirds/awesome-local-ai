import { describe, it, expect } from 'vitest';
import {
  BOARD_ID_BYTES,
  BOARD_ID_PATTERN,
  isValidBoardId,
  newBoardId,
} from '../../src/shared/board-id';

describe('TC-01: isValidBoardId', () => {
  it('accepts a valid 22-char base64url id', () => {
    // 16 bytes of 0xab → deterministic base64url string, 22 chars
    const id = btoa(String.fromCharCode(...new Uint8Array(BOARD_ID_BYTES).fill(0xab)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(id).toMatch(BOARD_ID_PATTERN);
    expect(isValidBoardId(id)).toBe(true);
  });

  it('rejects 21 chars (boundary below)', () => {
    expect(isValidBoardId('a'.repeat(21))).toBe(false);
  });

  it('rejects 23 chars (boundary above)', () => {
    expect(isValidBoardId('a'.repeat(23))).toBe(false);
  });

  it('rejects a standard-base64 "+" character', () => {
    // 21 valid chars + "+"
    expect(isValidBoardId('a'.repeat(21) + '+')).toBe(false);
  });

  it('rejects path-traversal-like input "../x"', () => {
    expect(isValidBoardId('../x')).toBe(false);
  });

  it('rejects the empty string', () => {
    expect(isValidBoardId('')).toBe(false);
  });
});

describe('TC-02: newBoardId', () => {
  it('generates 10,000 ids that all match the pattern with no duplicates', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(id).toMatch(BOARD_ID_PATTERN);
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
    expect(seen.size).toBe(10_000);
  });
});
