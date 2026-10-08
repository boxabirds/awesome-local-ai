/** TC-01, TC-02, TC-04 — board id unit tests */

import { describe, it, expect } from 'vitest';
import { BOARD_ID_BYTES, BOARD_ID_PATTERN, isValidBoardId, newBoardId } from '@shared/board-id';

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
  it('newBoardId() x 10,000 all match pattern; no duplicates', () => {
    const set = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(isValidBoardId(id)).toBe(true);
      expect(id.length).toBe(22);
      set.add(id);
    }
    expect(set.size).toBe(10_000);
  });
});

// TC-04 — link-code strength: 128 bits, unguessable
describe('TC-04: board id format and uniqueness', () => {
  it('BOARD_ID_BYTES is 16 (128 bits)', () => {
    expect(BOARD_ID_BYTES).toBe(16);
  });

  it('all generated ids are 22 chars matching BOARD_ID_PATTERN', () => {
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(id.length).toBe(22);
      expect(BOARD_ID_PATTERN.test(id)).toBe(true);
    }
  });

  it('10,000 ids are all unique', () => {
    const set = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      set.add(newBoardId());
    }
    expect(set.size).toBe(10_000);
  });
});
