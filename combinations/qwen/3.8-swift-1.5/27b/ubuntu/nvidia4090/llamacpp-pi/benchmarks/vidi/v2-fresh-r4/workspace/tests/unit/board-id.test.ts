import { describe, it, expect } from 'vitest';
import { isValidBoardId, newBoardId, BOARD_ID_PATTERN } from '../../src/shared/board-id';

describe('TC-01: isValidBoardId', () => {
  it('accepts a valid 22-char base64url string', () => {
    // 22 chars from [A-Za-z0-9_-]
    expect(isValidBoardId('abcdefghijklmnopqrstuv')).toBe(true);
    expect(isValidBoardId('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.slice(0, 22))).toBe(true);
    expect(isValidBoardId('0123456789012345678901')).toBe(true);
    expect(isValidBoardId('ABCDEFGHIJKLMNOPQRST_-')).toBe(true);
  });

  it('rejects 21 chars (too short)', () => {
    expect(isValidBoardId('abcdefghijklmnopqrstu')).toBe(false);
  });

  it('rejects 23 chars (too long)', () => {
    expect(isValidBoardId('abcdefghijklmnopqrstuvw')).toBe(false);
  });

  it('rejects strings with + character', () => {
    expect(isValidBoardId('abcdefghijklmnopqrst+v')).toBe(false);
  });

  it('rejects strings with / character', () => {
    expect(isValidBoardId('abcdefghijklmnopqrst/v')).toBe(false);
  });

  it('rejects ../x (path traversal)', () => {
    expect(isValidBoardId('../x')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidBoardId('')).toBe(false);
  });
});

describe('TC-02: newBoardId', () => {
  it('generates 10,000 unique valid board ids', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(BOARD_ID_PATTERN.test(id)).toBe(true);
      ids.add(id);
    }
    expect(ids.size).toBe(10_000);
  });
});
