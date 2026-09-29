// Story 3, task 1: board id unit tests (TC-01, TC-02).

import { describe, expect, it } from 'vitest';
import {
  BOARD_ID_PATTERN,
  isValidBoardId,
  newBoardId,
} from '../../src/shared/board-id';

describe('isValidBoardId (TC-01)', () => {
  it('accepts a well-formed 22-char base64url id', () => {
    // Hand-written: 22 chars, all in [A-Za-z0-9_-].
    expect(isValidBoardId('abcDEF0123456789_-xyzz')).toBe(true);
    // And whatever the generator produces is always valid.
    expect(isValidBoardId(newBoardId())).toBe(true);
  });

  it('rejects 21 chars (boundary below)', () => {
    expect(isValidBoardId('a'.repeat(21))).toBe(false);
  });

  it('rejects 23 chars (boundary above)', () => {
    expect(isValidBoardId('a'.repeat(23))).toBe(false);
  });

  it('rejects a "+" character (standard base64 alphabet)', () => {
    expect(isValidBoardId('aaaaaaaaaaaaaaaaaaaaa+')).toBe(false);
  });

  it('rejects "../x" (path traversal)', () => {
    expect(isValidBoardId('../x')).toBe(false);
  });

  it('rejects the empty string', () => {
    expect(isValidBoardId('')).toBe(false);
  });
});

describe('newBoardId (TC-02)', () => {
  it('10,000 generated ids all match the pattern and are unique', () => {
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
