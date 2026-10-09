import { describe, expect, it } from 'vitest';
import {
  BOARD_ID_BYTES,
  BOARD_ID_PATTERN,
  base64UrlEncode,
  isValidBoardId,
  newBoardId,
} from '../../src/shared/board-id';

describe('board ids', () => {
  it('BOARD_ID_BYTES is 16', () => {
    expect(BOARD_ID_BYTES).toBe(16);
  });

  it('newBoardId: 22-char base64url of 16 bytes (base32-style charset)', () => {
    for (let i = 0; i < 500; i++) {
      const id = newBoardId();
      expect(id).toHaveLength(22);
      expect(id).toMatch(BOARD_ID_PATTERN);
      // exactly the 16-byte base64url encoding: no padding, charset only
      expect(id).toMatch(/^[0-9A-Za-z_-]{22}$/);
    }
  });

  it('newBoardId: unique in a sample of 10000', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10000; i++) seen.add(newBoardId());
    expect(seen.size).toBe(10000);
  });

  it('isValidBoardId accepts generated ids', () => {
    for (let i = 0; i < 200; i++) expect(isValidBoardId(newBoardId())).toBe(true);
  });

  it('isValidBoardId rejects wrong lengths', () => {
    const ok = newBoardId();
    expect(ok).toHaveLength(22);
    expect(isValidBoardId(ok.slice(0, 21))).toBe(false);
    expect(isValidBoardId(ok + 'a')).toBe(false);
    expect(isValidBoardId('')).toBe(false);
  });

  it('newBoardId is genuine base64url (round-trips against btoa where available)', () => {
    const bytes = new Uint8Array(BOARD_ID_BYTES);
    crypto.getRandomValues(bytes);
    const expected = btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(base64UrlEncode(bytes)).toBe(expected);
  });

  it('isValidBoardId rejects bad characters', () => {
    const ok = newBoardId().slice(0, 21);
    for (const ch of ['+', '/', ' ', 'ø', '0é']) {
      expect(isValidBoardId(ok + ch)).toBe(false);
    }
    // padding char must be rejected
    expect(isValidBoardId('a'.repeat(21) + '=')).toBe(false);
  });
});
