import { describe, expect, it } from 'vitest';
import { BOARD_ID_BYTES, BOARD_ID_PATTERN, isValidBoardId, newBoardId } from '@/shared/board-id';

describe('board-id', () => {
  describe('TC-01: isValidBoardId', () => {
    it('accepts a valid 22-char base64url id', () => {
      expect(isValidBoardId('abcdefghijklmnopqrstuv')).toBe(true);
      expect(isValidBoardId('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.slice(0, 22))).toBe(true);
      expect(isValidBoardId('0123456789ABCDEFGHIJ_-')).toBe(true);
      // A real generated id must always validate.
      expect(isValidBoardId(newBoardId())).toBe(true);
    });

    it('rejects boundary lengths 21 and 23', () => {
      expect(isValidBoardId('abcdefghijklmnopqrstu')).toBe(false); // 21
      expect(isValidBoardId('abcdefghijklmnopqrstuvw')).toBe(false); // 23
    });

    it('rejects characters outside the base64url alphabet', () => {
      expect(isValidBoardId('abcdefghijklmnopqrst+u')).toBe(false); // '+'
      expect(isValidBoardId('abcdefghijklmnopqrst/u')).toBe(false); // '/'
      expect(isValidBoardId('abcdefghijklmnopqrstuv=')).toBe(false); // padding '='
    });

    it('rejects path traversal and empty input', () => {
      expect(isValidBoardId('../x')).toBe(false);
      expect(isValidBoardId('')).toBe(false);
    });
  });

  describe('TC-02: newBoardId', () => {
    it('BOARD_ID_PATTERN describes exactly 22 base64url chars', () => {
      expect(BOARD_ID_PATTERN.source).toBe('^[A-Za-z0-9_-]{22}$');
      expect(BOARD_ID_BYTES).toBe(16);
    });

    it('generates 10,000 unique, well-formed ids', () => {
      const seen = new Set<string>();
      for (let i = 0; i < 10_000; i++) {
        const id = newBoardId();
        expect(BOARD_ID_PATTERN.test(id), `id ${i} malformed: ${id}`).toBe(true);
        expect(seen.has(id), `duplicate id at ${i}: ${id}`).toBe(false);
        seen.add(id);
      }
      expect(seen.size).toBe(10_000);
    });
  });
});
