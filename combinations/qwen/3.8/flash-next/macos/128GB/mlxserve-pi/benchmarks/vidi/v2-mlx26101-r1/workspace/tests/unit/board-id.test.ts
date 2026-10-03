// TC-01 / TC-02 — board id validation and generation (sync.worker_entry).
import { describe, expect, it } from 'vitest';
import {
  BOARD_ID_BYTES,
  BOARD_ID_PATTERN,
  isValidBoardId,
  newBoardId,
} from '../../src/shared/board-id';

/** 22 characters of the base64url alphabet, for boundary cases. */
const VALID_22 = 'ABCDEFGHJKLMNPQRSTUVWXYZ'.slice(0, 22);

describe('isValidBoardId (TC-01)', () => {
  it('accepts a 22-character base64url id', () => {
    expect(isValidBoardId(VALID_22)).toBe(true);
    expect(isValidBoardId(newBoardId())).toBe(true);
    expect(isValidBoardId('ab-cd_ef0123456789ABCD')).toBe(true);
  });

  it('rejects ids one character shorter or longer than the boundary', () => {
    expect(isValidBoardId(VALID_22.slice(0, 21))).toBe(false);
    expect(isValidBoardId(`${VALID_22}x`)).toBe(false);
  });

  it('rejects characters that are not URL-safe base64url', () => {
    expect(isValidBoardId('++++++++++++++++++++++')).toBe(false);
    // '+' and '=' are valid base64 but must never appear in an address.
    expect(isValidBoardId('++++++++++++++++++xx')).toBe(false);
    expect(isValidBoardId('AAAAAAAAAAAAAAAAAAAA+x')).toBe(false);
    expect(isValidBoardId('AAAAAAAAAAAAAAAAAAAA=x')).toBe(false);
  });

  it('rejects path traversal and the empty string', () => {
    expect(isValidBoardId('../x')).toBe(false);
    expect(isValidBoardId('')).toBe(false);
    expect(isValidBoardId('../../etc/passwd')).toBe(false);
  });
});

describe('newBoardId (TC-02)', () => {
  it('produces 10000 ids that all match the pattern with no duplicates', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(id).toMatch(BOARD_ID_PATTERN);
      expect(id.length).toBe(22);
      expect(isValidBoardId(id)).toBe(true);
      seen.add(id);
    }
    expect(seen.size).toBe(10_000);
  });

  it('is 16 random bytes encoded without padding', () => {
    expect(BOARD_ID_BYTES).toBe(16);
    // 16 bytes -> ceil(16 * 4 / 3) = 22 characters when unpadded base64url.
    expect(newBoardId()).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});
