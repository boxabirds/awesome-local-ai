// Story 3, TC-01/TC-02: board id validation and generation (sync.worker_entry).

import { describe, expect, it } from 'vitest';
import { BOARD_ID_PATTERN, isValidBoardId, newBoardId } from '../../src/shared/board-id';

describe('TC-01: isValidBoardId', () => {
  it('accepts a valid 22-char base64url id', () => {
    expect(isValidBoardId('ABCDEFGHIJKLMNOPQRSTuv')).toBe(true);
    expect(isValidBoardId('abcDEF0123456789_-xyz1')).toBe(true);
  });

  it('rejects 21 characters (boundary below)', () => {
    expect(isValidBoardId('ABCDEFGHIJKLMNOPQRSTu')).toBe(false);
  });

  it('rejects 23 characters (boundary above)', () => {
    expect(isValidBoardId('ABCDEFGHIJKLMNOPQRSTuvw')).toBe(false);
  });

  it('rejects a non-base64url character (+)', () => {
    expect(isValidBoardId('ABCDEFGHIJKLMNOPQRST+v')).toBe(false);
  });

  it('rejects path-traversal-looking ids', () => {
    expect(isValidBoardId('../x')).toBe(false);
  });

  it('rejects the empty string', () => {
    expect(isValidBoardId('')).toBe(false);
  });

  it('matches the documented pattern exactly', () => {
    expect(isValidBoardId('a1B2c3D4e5F6g7H8i9J0k-l_')).toBe(BOARD_ID_PATTERN.test('a1B2c3D4e5F6g7H8i9J0k-l_'));
  });
});

describe('TC-02: newBoardId', () => {
  it('produces 10,000 unique ids that all match the pattern', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(id).toMatch(BOARD_ID_PATTERN);
      seen.add(id);
    }
    expect(seen.size).toBe(10_000);
  });
});
