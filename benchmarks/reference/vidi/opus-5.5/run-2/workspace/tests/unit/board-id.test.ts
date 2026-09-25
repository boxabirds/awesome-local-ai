import { describe, expect, it } from 'vitest';
import { BOARD_ID_BYTES, BOARD_ID_PATTERN, isValidBoardId, newBoardId } from '../../src/shared/board-id';

const GENERATED = 10_000;

describe('board ids (sync.worker_entry)', () => {
  it('TC-01 accepts exactly 22 base64url characters', () => {
    expect(isValidBoardId('AbCdEfGhIjKlMnOpQr_-09')).toBe(true);
    expect(isValidBoardId('AbCdEfGhIjKlMnOpQr_-0')).toBe(false); // 21
    expect(isValidBoardId('AbCdEfGhIjKlMnOpQr_-091')).toBe(false); // 23
    expect(isValidBoardId('AbCdEfGhIjKlMnOpQr_+09')).toBe(false);
    expect(isValidBoardId('../x')).toBe(false);
    expect(isValidBoardId('')).toBe(false);
  });

  it(`TC-02 newBoardId() x ${GENERATED} all match the pattern with no duplicates`, () => {
    const ids = new Set<string>();
    for (let i = 0; i < GENERATED; i++) {
      const id = newBoardId();
      expect(id).toMatch(BOARD_ID_PATTERN);
      ids.add(id);
    }
    expect(ids.size).toBe(GENERATED);
  });

  it('carries 128 bits of randomness', () => {
    expect(BOARD_ID_BYTES * 8).toBe(128);
    const decoded = atob(newBoardId().replace(/-/g, '+').replace(/_/g, '/') + '==');
    expect(decoded.length).toBe(BOARD_ID_BYTES);
  });
});
