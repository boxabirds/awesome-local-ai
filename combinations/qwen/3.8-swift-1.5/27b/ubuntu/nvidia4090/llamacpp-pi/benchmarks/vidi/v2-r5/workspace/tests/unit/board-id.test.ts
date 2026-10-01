// tests/unit/board-id.test.ts
import { describe, it, expect } from 'vitest';
import { isValidBoardId, newBoardId, BOARD_ID_PATTERN } from '../../src/shared/board-id';

describe('sync.worker_entry: board id validation (TC-01)', () => {
  it('accepts a valid 22-char base64url string', () => {
    // 22 chars of valid base64url
    expect(isValidBoardId('abcdefghijklmnopqrstuv')).toBe(true);
    expect(isValidBoardId('ABCDEFGHIJ1234567890ab')).toBe(true);
    expect(isValidBoardId('a1B2c3D4e5F6g7H8i9J0k_')).toBe(true);
  });

  it('rejects 21-char string (boundary low)', () => {
    expect(isValidBoardId('abcdefghijklmnopqrstu')).toBe(false); // 21 chars
  });

  it('rejects 23-char string (boundary high)', () => {
    expect(isValidBoardId('abcdefghijklmnopqrstuvw')).toBe(false); // 23 chars
  });

  it('rejects string with + character', () => {
    expect(isValidBoardId('abcdefghijklmnopqrst+v')).toBe(false);
  });

  it('rejects string with / character', () => {
    expect(isValidBoardId('abcdefghijklmnopqrst/v')).toBe(false);
  });

  it('rejects string with dots (path traversal)', () => {
    expect(isValidBoardId('..x..x..x..x..x..x..x.')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidBoardId('')).toBe(false);
  });
});

describe('sync.worker_entry: board id generation (TC-02)', () => {
  it('generates 10,000 ids that all match the pattern with no duplicates', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(BOARD_ID_PATTERN.test(id)).toBe(true);
      expect(id).toHaveLength(22);
      ids.add(id);
    }
    expect(ids.size).toBe(10_000);
  });
});
