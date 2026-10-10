import { describe, expect, it } from 'vitest';
import { BOARD_ID_BYTES, BOARD_ID_PATTERN, isValidBoardId, newBoardId } from '../../src/shared/board-id';

/**
 * TC-01 / TC-02 (anchor `sync.worker_entry`): board addresses are pure id
 * validation and generation, so they are tested without a runtime.
 *
 * Dimension classes: D3 = 1 participant, D4 = steady connection.
 */

/** A 22-character base64url string (what `newBoardId()` produces). */
const VALID = 'f7K_x9pQ-2mNb0R4sT8uVw';

describe('isValidBoardId (TC-01)', () => {
  it('accepts a 22-character base64url id', () => {
    expect(VALID).toHaveLength(22);
    expect(isValidBoardId(VALID)).toBe(true);
    expect(isValidBoardId(newBoardId())).toBe(true);
  });

  it('rejects ids one character shorter or longer than 22 (boundary)', () => {
    expect(BOARD_ID_PATTERN.test(VALID.slice(0, 21))).toBe(false);
    expect(isValidBoardId(VALID.slice(0, 21))).toBe(false);
    expect(isValidBoardId(`${VALID}x`)).toBe(false);
  });

  it('rejects characters outside the base64url alphabet', () => {
    // '+' and '/' are base64, but not base64url.
    expect(isValidBoardId('++++++++++++++++++++++')).toBe(false);
    expect(isValidBoardId('aaaaaaaaaaaaaaaaaaaa+/')).toBe(false);
    expect(isValidBoardId('aaaaaaaaaaaaaaaaaa==aa'.slice(0, 22))).toBe(false);
  });

  it('rejects path traversal and empty ids', () => {
    expect(isValidBoardId('../x')).toBe(false);
    expect(isValidBoardId('..')).toBe(false);
    expect(isValidBoardId('a/b')).toBe(false);
    expect(isValidBoardId('')).toBe(false);
  });

  it('rejects non-string-shaped input without throwing', () => {
    expect(isValidBoardId('a b c d e f g h i j k'.padEnd(22, 'x'))).toBe(false);
    expect(isValidBoardId('aaaaaaaaaaaaaaaaaaaá')).toBe(false);
  });
});

describe('newBoardId (TC-02)', () => {
  it('produces 16 random bytes encoded as 22 base64url characters', () => {
    expect(BOARD_ID_BYTES).toBe(16);
    const id = newBoardId();
    expect(id).toHaveLength(22);
    expect(id).toMatch(BOARD_ID_PATTERN);
  });

  it('produces 10,000 unique ids that all match the pattern', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i += 1) {
      const id = newBoardId();
      expect(id).toMatch(BOARD_ID_PATTERN);
      seen.add(id);
    }
    expect(seen.size).toBe(10_000);
  });
});
