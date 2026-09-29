import { describe, it, expect } from 'vitest';
import {
  isValidBoardId,
  newBoardId,
  BOARD_ID_PATTERN,
  BOARD_ID_BYTES,
} from '../../src/shared/board-id.ts';

// TC-01 isValidBoardId: boundaries (length 21 / 22 / 23) and negatives.
describe('isValidBoardId', () => {
  it('accepts a 22-char base64url id', () => {
    expect(isValidBoardId('abcdefghijklmnopqrstuv')).toBe(true);
    expect(isValidBoardId('A-_09azAZ-_09azAZ-_09a')).toBe(true);
  });

  it('rejects 21 chars (boundary below)', () => {
    expect(isValidBoardId('a'.repeat(21))).toBe(false);
  });

  it('accepts exactly 22 chars (boundary at)', () => {
    expect(isValidBoardId('a'.repeat(22))).toBe(true);
  });

  it('rejects 23 chars (boundary above)', () => {
    expect(isValidBoardId('a'.repeat(23))).toBe(false);
  });

  it('rejects a "+" character (not base64url)', () => {
    expect(isValidBoardId('abcdefghijklmnopqrstu+')).toBe(false);
  });

  it('rejects a path traversal "../x" fragment', () => {
    expect(isValidBoardId('../x')).toBe(false);
  });

  it('rejects the empty string', () => {
    expect(isValidBoardId('')).toBe(false);
  });
});

// TC-02 newBoardId(): 10,000 ids all match the pattern and are unique.
describe('newBoardId', () => {
  it('generates 10,000 valid, unique ids', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(id).toMatch(BOARD_ID_PATTERN);
      expect(id).toHaveLength(22);
      seen.add(id);
    }
    expect(seen.size).toBe(10_000);
  });

  it('uses the configured byte length', () => {
    expect(BOARD_ID_BYTES).toBe(16);
  });
});
