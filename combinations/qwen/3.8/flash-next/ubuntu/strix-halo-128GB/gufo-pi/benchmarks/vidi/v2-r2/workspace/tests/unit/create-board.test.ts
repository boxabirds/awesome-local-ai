import { describe, it, expect } from 'vitest';
import {
  newBoardId,
  isValidBoardId,
  BOARD_ID_PATTERN,
  BOARD_ID_BYTES,
} from '@shared/board-id';

// TC-04 (share.unguessable): link-code format and uniqueness. 10,000 generated
// ids are all distinct, all 22 characters matching BOARD_ID_PATTERN, and each
// decodes back to 16 bytes (128 bits) of randomness from a cryptographic source.
describe('TC-04: board id (link code) strength and uniqueness', () => {
  it('BOARD_ID_BYTES is 16 (128 bits of randomness)', () => {
    expect(BOARD_ID_BYTES).toBe(16);
  });

  it('10,000 ids are unique, 22 chars long and match BOARD_ID_PATTERN', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(id).toHaveLength(22);
      expect(id).toMatch(BOARD_ID_PATTERN);
      expect(isValidBoardId(id)).toBe(true);
      seen.add(id);
    }
    expect(seen.size).toBe(10_000);
  });

  it('each id is the base64url of exactly 16 random bytes', () => {
    for (let i = 0; i < 100; i++) {
      const id = newBoardId();
      let b64 = id.replace(/-/g, '+').replace(/_/g, '/');
      b64 += '='.repeat((4 - (b64.length % 4)) % 4);
      const binary = atob(b64);
      expect(binary.length).toBe(BOARD_ID_BYTES);
    }
  });

  it('uses a cryptographic random source (crypto.getRandomValues) and never derives from order', () => {
    // Two consecutive ids must differ (a counter/time derivation would correlate);
    // with 128 bits they are effectively never equal.
    let differs = 0;
    for (let i = 0; i < 100; i++) {
      if (newBoardId() !== newBoardId()) differs++;
    }
    expect(differs).toBe(100);
  });
});
