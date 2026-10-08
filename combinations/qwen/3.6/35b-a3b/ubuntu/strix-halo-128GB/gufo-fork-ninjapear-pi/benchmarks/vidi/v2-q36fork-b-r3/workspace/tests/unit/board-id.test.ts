/** TC-01, TC-02 already covered in unit tests */

import { describe, it, expect } from 'vitest';
import { isValidBoardId, newBoardId } from '@shared/board-id';

describe('board-id unit tests (TC-01, TC-02)', () => {
  describe('isValidBoardId', () => {
    // TC-01
    it('valid 22-char base64url → true', () => {
      const id = newBoardId();
      expect(isValidBoardId(id)).toBe(true);
    });

    it('21 chars → false', () => {
      expect(isValidBoardId('A'.repeat(21))).toBe(false);
    });

    it('23 chars → false', () => {
      expect(isValidBoardId('A'.repeat(23))).toBe(false);
    });

    it('+ char → false', () => {
      expect(isValidBoardId('ABC+DEFghiJklMNopQrStUv')).toBe(false);
    });

    it('../x → false', () => {
      expect(isValidBoardId('../x')).toBe(false);
    });

    it('empty → false', () => {
      expect(isValidBoardId('')).toBe(false);
    });
  });

  // TC-02
  it('newBoardId() x 10,000 all match pattern; no duplicates', async ({
    expect: tExpect,
  }) => {
    const set = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(isValidBoardId(id)).toBe(true);
      set.add(id);
    }
    expect(set.size).toBe(10_000);
  });
});
