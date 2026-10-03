/**
 * TC-01, TC-02: board id validation and generation (sync.worker_entry).
 */
import { describe, it, expect } from 'vitest';
import { isValidBoardId, newBoardId, BOARD_ID_PATTERN } from '../../src/shared/board-id';

describe('TC-01: isValidBoardId', () => {
  it('accepts a valid 22-char base64url id', () => {
    expect(isValidBoardId('abcdefghijklmnopQRSTuv')).toBe(true);
    expect(isValidBoardId('ABCDEFGHIJKLMN_op-1234')).toBe(true); // includes - and _
  });

  it('rejects 21 chars (boundary below)', () => {
    expect(isValidBoardId('abcdefghijklmnopQRSTu')).toBe(false);
  });

  it('rejects 23 chars (boundary above)', () => {
    expect(isValidBoardId('abcdefghijklmnopQRSTuvw')).toBe(false);
  });

  it('rejects a base64 "+" character (not base64url)', () => {
    expect(isValidBoardId('abcdefghijklmnopQRSTu+')).toBe(false);
  });

  it('rejects path traversal "../x"', () => {
    expect(isValidBoardId('../x')).toBe(false);
  });

  it('rejects the empty string', () => {
    expect(isValidBoardId('')).toBe(false);
  });
});

describe('TC-02: newBoardId', () => {
  it('generates 10,000 ids, all matching the pattern with no duplicates', () => {
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
