import { describe, expect, it } from 'vitest';
import {
  BOARD_ID_BYTES,
  BOARD_ID_PATTERN,
  isValidBoardId,
  newBoardId,
} from '../../src/shared/board-id.js';

describe('board id (sync.worker_entry)', () => {
  it('TC-01 accepts a valid 22-char base64url id', () => {
    expect(isValidBoardId(newBoardId())).toBe(true);
  });

  it('TC-01 rejects a 21-char id (lower boundary)', () => {
    expect(isValidBoardId('a'.repeat(21))).toBe(false);
  });

  it('TC-01 accepts exactly the 22-char boundary and rejects a 23-char id (upper boundary)', () => {
    expect(isValidBoardId('a'.repeat(22))).toBe(true);
    expect(isValidBoardId('a'.repeat(23))).toBe(false);
  });

  it('TC-01 rejects a base64 character outside the URL-safe alphabet', () => {
    // 22 characters, but '+' is not part of base64url.
    expect(isValidBoardId('+'.repeat(22))).toBe(false);
    expect(isValidBoardId('a'.repeat(21) + '/')).toBe(false);
  });

  it('TC-01 rejects a traversal string', () => {
    expect(isValidBoardId('../x')).toBe(false);
  });

  it('TC-01 rejects the empty string', () => {
    expect(isValidBoardId('')).toBe(false);
  });

  it('the pattern and byte count agree with the documented id shape', () => {
    expect(BOARD_ID_BYTES).toBe(16);
    expect(BOARD_ID_PATTERN).toBeInstanceOf(RegExp);
  });

  it('TC-02 generates 10,000 ids that all match the pattern with no duplicates', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(BOARD_ID_PATTERN.test(id)).toBe(true);
      seen.add(id);
    }
    expect(seen.size).toBe(10_000);
  });
});
