import { describe, expect, it } from 'vitest';
import { BOARD_ID_PATTERN, isValidBoardId, newBoardId } from '../../src/shared/board-id';

describe('board id (TC-01, TC-02)', () => {
  it('TC-01 validates length and alphabet', () => {
    expect(isValidBoardId('A'.repeat(22))).toBe(true);
    expect(isValidBoardId('A'.repeat(21))).toBe(false);
    expect(isValidBoardId('A'.repeat(23))).toBe(false);
    expect(isValidBoardId(`${'A'.repeat(21)}+`)).toBe(false);
    expect(isValidBoardId('../x')).toBe(false);
    expect(isValidBoardId('')).toBe(false);
  });

  it('TC-02 newBoardId yields unique, valid ids', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(BOARD_ID_PATTERN.test(id)).toBe(true);
      seen.add(id);
    }
    expect(seen.size).toBe(10_000);
  });
});
