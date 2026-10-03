/**
 * TC-04 (story 5, share.unguessable): link-code strength.
 *
 * 10,000 `newBoardId()` calls must all be unique, all 22 characters matching
 * BOARD_ID_PATTERN, and each must decode to exactly 16 random bytes
 * (128 bits) from a cryptographic random source.
 */
import { describe, it, expect } from 'vitest';
import {
  newBoardId,
  BOARD_ID_PATTERN,
  BOARD_ID_BYTES,
} from '../../src/shared/board-id';

/** Decodes a base64url string (no padding) back to bytes. */
function base64UrlDecode(s: string): Uint8Array {
  const base64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

describe('TC-04: link codes are unguessable (share.unguessable)', () => {
  it('10,000 ids are unique, 22 chars, match BOARD_ID_PATTERN, and decode to 16 bytes', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(id).toMatch(BOARD_ID_PATTERN);
      expect(id.length).toBe(22);
      // 16 bytes = 128 bits of randomness; base64url carries only
      // letters, digits, hyphen and underscore (chat-app safe).
      expect(base64UrlDecode(id).length).toBe(BOARD_ID_BYTES);
      seen.add(id);
    }
    expect(seen.size).toBe(10_000);
  });
});
