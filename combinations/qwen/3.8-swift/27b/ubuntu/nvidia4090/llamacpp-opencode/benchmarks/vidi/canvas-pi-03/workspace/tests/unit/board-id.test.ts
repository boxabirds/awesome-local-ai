import { describe, it, expect } from 'vitest';
import {
  isValidBoardId,
  newBoardId,
  BOARD_ID_PATTERN,
  BOARD_ID_BYTES,
} from 'src/shared/board-id';

/**
 * TC-01 / TC-02 — pure board id validation and generation.
 */
describe('board-id', () => {
  describe('TC-01: isValidBoardId', () => {
    it('accepts a valid 22-char base64url id', () => {
      expect(isValidBoardId('abcdefghijklmnopqrstuv')).toBe(true);
      // base64url may include '-', '_', digits and uppercase
      expect(isValidBoardId('AbCdEfGhIjKlMnOpQrStUv')).toBe(true);
      expect(isValidBoardId('0123456789abcdefghijkl')).toBe(true);
      expect(isValidBoardId('abcdefghijklm-no_pqrst')).toBe(true);
    });

    it('rejects the 21-char boundary (too short)', () => {
      expect(isValidBoardId('abcdefghijklmnopqrstu')).toBe(false);
    });

    it('rejects the 23-char boundary (too long)', () => {
      expect(isValidBoardId('abcdefghijklmnopqrstuvw')).toBe(false);
    });

    it('rejects the base64 "+" char (not base64url)', () => {
      expect(isValidBoardId('abcdefghijklmnopqrstuv+')).toBe(false);
    });

    it('rejects the base64 "/" char (not base64url)', () => {
      expect(isValidBoardId('abcdefghijklmnopqrstuv/')).toBe(false);
    });

    it('rejects traversal-like ids', () => {
      expect(isValidBoardId('../x')).toBe(false);
    });

    it('rejects empty and whitespace ids', () => {
      expect(isValidBoardId('')).toBe(false);
      expect(isValidBoardId('abcdefghijklmnopqrstuv ')).toBe(false);
    });
  });

  describe('TC-02: newBoardId', () => {
    it('generates 10,000 ids that all match the pattern and are unique', () => {
      const seen = new Set<string>();
      for (let i = 0; i < 10_000; i++) {
        const id = newBoardId();
        expect(BOARD_ID_PATTERN.test(id)).toBe(true);
        expect(id).toHaveLength(22);
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
      expect(seen.size).toBe(10_000);
    });

    it('uses 16 random bytes (128 bits)', () => {
      expect(BOARD_ID_BYTES).toBe(16);
      // 16 bytes -> ceil(16*8/6) = 22 base64url chars, no padding
      const id = newBoardId();
      expect(id.replace(/=+$/, '')).toBe(id); // no padding '='
    });
  });
});
