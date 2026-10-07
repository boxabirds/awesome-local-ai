/**
 * Task 1 & 5.1: Unit tests for board-id (TC-01, TC-02, TC-04).
 * TC-04: link-code format and uniqueness
 */
import { describe, it, expect } from 'vitest';
import { isValidBoardId, newBoardId, BOARD_ID_PATTERN, BOARD_ID_BYTES } from '@/shared/board-id';

describe('board-id unit tests', () => {
  // ---- TC-01: isValidBoardId validation ----
  describe('isValidBoardId', () => {
    it('TC-01: valid 22-char base64url → true', () => {
      const id = newBoardId();
      expect(isValidBoardId(id)).toBe(true);
    });

    it('TC-01: 21 chars → false', () => {
      expect(isValidBoardId('a'.repeat(21))).toBe(false);
    });

    it('TC-01: 23 chars → false', () => {
      expect(isValidBoardId('a'.repeat(23))).toBe(false);
    });

    it('TC-01: '+' char → false', () => {
      expect(isValidBoardId('Ab+DEFGHIJKLMNOPQRSTUV')).toBe(false);
    });

    it('TC-01: "../x" pattern → false', () => {
      expect(isValidBoardId('../x')).toBe(false);
    });

    it('TC-01: empty string → false', () => {
      expect(isValidBoardId('')).toBe(false);
    });

    it('TC-01: null/undefined → false', () => {
      // @ts-ignore -- testing runtime behaviour
      expect(isValidBoardId(null)).toBe(false);
      // @ts-ignore
      expect(isValidBoardId(undefined)).toBe(false);
    });
  });

  // ---- TC-02: newBoardId generator ----
  it('TC-02: newBoardId() × 10,000 all match pattern and no duplicates', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(id).toMatch(BOARD_ID_PATTERN);
      expect(ids.has(id)).toBe(false);
      ids.add(id);
    }
    expect(ids.size).toBe(10_000);
  });

  // ---- TC-04: link-code format and uniqueness ----
  describe('TC-04: unguessable board codes', () => {
    it('codes are 22 characters long', () => {
      for (let i = 0; i < 100; i++) {
        const id = newBoardId();
        expect(id.length).toBe(22);
      }
    });

    it('all 10,000 codes unique', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 10_000; i++) {
        ids.add(newBoardId());
      }
      expect(ids.size).toBe(10_000);
    });

    it('all codes match BOARD_ID_PATTERN', () => {
      for (let i = 0; i < 10_000; i++) {
        expect(newBoardId()).toMatch(BOARD_ID_PATTERN);
      }
    });

    it('uses at least 16 bytes (128 bits) of randomness', () => {
      // Verify the constant reflects 16 bytes = 128 bits
      expect(BOARD_ID_BYTES).toBe(16);
      // A 16-byte buffer produces 22 base64url chars (no padding)
      const buf = crypto.getRandomValues(new Uint8Array(BOARD_ID_BYTES));
      const encoded = Buffer.from(buf).toString('base64url');
      expect(encoded).toHaveLength(22);
      expect(encoded).not.toContain('=');
    });
  });
});
