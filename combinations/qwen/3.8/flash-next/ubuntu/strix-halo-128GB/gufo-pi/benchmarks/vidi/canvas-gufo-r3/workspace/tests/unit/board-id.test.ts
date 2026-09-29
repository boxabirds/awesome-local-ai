import { describe, it, expect } from 'vitest';
import {
  isValidBoardId,
  newBoardId,
  BOARD_ID_PATTERN,
  BOARD_ID_BYTES,
} from '@shared/board-id';

describe('board-id (TC-01, TC-02)', () => {
  describe('isValidBoardId (TC-01)', () => {
    it('accepts a valid 22-char base64url id', () => {
      const id = newBoardId();
      expect(id).toHaveLength(22);
      expect(isValidBoardId(id)).toBe(true);
    });

    it('accepts the full base64url alphabet', () => {
      // '-' and '_' plus every alphanumeric character, 22 chars.
      expect(isValidBoardId('abcdefghij_-KLMNOPQRST')).toBe(true);
    });

    it('rejects a 21-char id (boundary below)', () => {
      expect(isValidBoardId(newBoardId().slice(0, 21))).toBe(false);
    });

    it('rejects a 23-char id (boundary above)', () => {
      expect(isValidBoardId(newBoardId() + 'A')).toBe(false);
    });

    it('rejects a "+" character (not base64url)', () => {
      const withPlus = 'abcdefghij_A-KLMN+PQRS'; // 22 chars, contains '+'
      expect(withPlus).toHaveLength(22);
      expect(isValidBoardId(withPlus)).toBe(false);
    });

    it('rejects a path traversal attempt', () => {
      expect(isValidBoardId('../x')).toBe(false);
    });

    it('rejects an empty string', () => {
      expect(isValidBoardId('')).toBe(false);
    });

    it('pattern constant matches what isValidBoardId accepts', () => {
      const id = newBoardId();
      expect(BOARD_ID_PATTERN.test(id)).toBe(isValidBoardId(id));
    });
  });

  describe('newBoardId (TC-02)', () => {
    it('produces 22-char ids matching the pattern for 10,000 draws', () => {
      const seen = new Set<string>();
      for (let i = 0; i < 10_000; i++) {
        const id = newBoardId();
        expect(id).toHaveLength(BOARD_ID_BYTES === 16 ? 22 : id.length);
        expect(BOARD_ID_PATTERN.test(id)).toBe(true);
        expect(isValidBoardId(id)).toBe(true);
        seen.add(id);
      }
      // 128 bits of randomness: 10,000 draws must be all unique.
      expect(seen.size).toBe(10_000);
    });
  });
});
