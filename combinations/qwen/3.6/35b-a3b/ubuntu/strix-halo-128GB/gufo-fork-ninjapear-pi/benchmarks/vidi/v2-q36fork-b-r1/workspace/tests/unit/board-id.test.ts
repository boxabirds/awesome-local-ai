/**
 * Task 1.1: Unit tests for board-id (TC-01, TC-02).
 */
import { describe, it, expect } from 'vitest';
import { isValidBoardId, newBoardId, BOARD_ID_PATTERN } from '@/shared/board-id';

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
});
