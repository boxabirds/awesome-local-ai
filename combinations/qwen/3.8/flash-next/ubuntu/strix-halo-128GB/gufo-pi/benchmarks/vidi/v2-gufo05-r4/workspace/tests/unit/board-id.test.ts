/**
 * TC-01, TC-02 — board addresses (`sync.worker_entry`).
 *
 * Validation is the Worker's first gate: an address that is not 22 base64url
 * characters never reaches a Durable Object. Generation must produce addresses
 * that pass that gate, look like nothing else and never repeat.
 */

import { describe, expect, it } from 'vitest';
import { BOARD_ID_BYTES, BOARD_ID_PATTERN, isValidBoardId, newBoardId } from '../../src/shared/board-id';

/** base64url without padding, the encoding `newBoardId` is specified to use. */
function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

describe('isValidBoardId', () => {
  it('accepts a 22-character base64url id (TC-01)', () => {
    const id = base64url(new Uint8Array(Array.from({ length: BOARD_ID_BYTES }, (_, i) => i * 7)));
    expect(id).toHaveLength(22);
    expect(isValidBoardId(id)).toBe(true);
  });

  it('rejects 21 and 23 characters (TC-01 boundary)', () => {
    expect(isValidBoardId('a'.repeat(21))).toBe(false);
    expect(isValidBoardId('a'.repeat(23))).toBe(false);
  });

  it('rejects characters that are not URL-safe (TC-01)', () => {
    // Same length, but '+' and '/' are base64, not base64url.
    expect(isValidBoardId('A'.repeat(21) + '+')).toBe(false);
    expect(isValidBoardId('A'.repeat(21) + '/')).toBe(false);
    expect(isValidBoardId('A'.repeat(21) + '=')).toBe(false);
  });

  it('rejects path traversal and an empty id (TC-01)', () => {
    expect(isValidBoardId('../x')).toBe(false);
    expect(isValidBoardId('')).toBe(false);
  });
});

describe('newBoardId', () => {
  it('generates 10,000 unique ids that all match the pattern (TC-02)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i += 1) {
      const id = newBoardId();
      expect(BOARD_ID_PATTERN.test(id)).toBe(true);
      seen.add(id);
    }
    expect(seen.size).toBe(10_000);
  });

  it('generates ids that isValidBoardId accepts', () => {
    for (let i = 0; i < 50; i += 1) expect(isValidBoardId(newBoardId())).toBe(true);
  });
});
