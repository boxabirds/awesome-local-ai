// TC-01, TC-02: board id validation and generation (sync.worker_entry, pure).

import { describe, expect, it } from 'vitest';
import { BOARD_ID_PATTERN, isValidBoardId, newBoardId } from '../../src/shared/board-id';

describe('TC-01 isValidBoardId', () => {
  it('accepts a valid 22-char base64url id', () => {
    expect(isValidBoardId('abcdefghijklmnopqrstuv')).toBe(true);
    expect(isValidBoardId('a1B2c3D4e5F6g7H8i9K_-l')).toBe(true);
  });

  it('rejects 21 chars (boundary below)', () => {
    expect(isValidBoardId('abcdefghijklmnopqrstu')).toBe(false);
  });

  it('rejects 23 chars (boundary above)', () => {
    expect(isValidBoardId('abcdefghijklmnopqrstuvw')).toBe(false);
  });

  it('rejects a base64 "+" char (not base64url)', () => {
    expect(isValidBoardId('abcdefghijklmnop+rstuv')).toBe(false);
  });

  it('rejects traversal-like input', () => {
    expect(isValidBoardId('../x')).toBe(false);
  });

  it('rejects the empty string', () => {
    expect(isValidBoardId('')).toBe(false);
  });
});

describe('TC-02 newBoardId', () => {
  it('produces 10,000 ids that all match the pattern with no duplicates', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(BOARD_ID_PATTERN.test(id)).toBe(true);
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
    expect(seen.size).toBe(10_000);
  });
});
