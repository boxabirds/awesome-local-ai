// sync.worker_entry — board id validation and generation (TC-01, TC-02).

import { describe, expect, it } from 'vitest';
import { BOARD_ID_PATTERN, isValidBoardId, newBoardId } from '../../src/shared/board-id';

describe('TC-01 isValidBoardId', () => {
  it('accepts a valid 22-char base64url id', () => {
    // 16 zero bytes -> 22 chars, no padding
    expect(isValidBoardId('AAAAAAAAAAAAAAAAAAAAAA')).toBe(true);
    expect(isValidBoardId('aB3-_Zx9yK1mN4pQ7rSvTw')).toBe(true);
    // every alphabet character class appears
    expect(isValidBoardId('0aZ-_9kxL2mN4pQ7rSvTwA')).toBe(true);
  });

  it('rejects boundary lengths 21 and 23 chars', () => {
    expect(isValidBoardId('AAAAAAAAAAAAAAAAAAAAA')).toBe(false); // 21
    expect(isValidBoardId('AAAAAAAAAAAAAAAAAAAAAAA')).toBe(false); // 23
  });

  it('rejects base64 non-url characters, traversal and empty input', () => {
    expect(isValidBoardId('AAAAAAAAAAAAAAAAAAAA+A')).toBe(false); // '+'
    expect(isValidBoardId('AAAAAAAAAAAAAAAAAAAA/A')).toBe(false); // '/'
    expect(isValidBoardId('../AAAAAAAAAAAAAAAAA')).toBe(false); // '../x'
    expect(isValidBoardId('')).toBe(false);
  });
});

describe('TC-02 newBoardId', () => {
  it('generates 10,000 unique ids that all match the pattern', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(BOARD_ID_PATTERN.test(id)).toBe(true);
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
  });
});
