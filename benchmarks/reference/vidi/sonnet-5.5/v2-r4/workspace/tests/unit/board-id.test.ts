import { describe, expect, it } from 'vitest';
import { BOARD_ID_PATTERN, isValidBoardId, newBoardId } from '../../src/shared/board-id';

describe('isValidBoardId (TC-01)', () => {
  const id22 = 'abcdefghijklmnopqrstuv';
  it('accepts a 22-char base64url id', () => {
    expect(isValidBoardId(id22)).toBe(true);
    expect(isValidBoardId('A-_9'.repeat(5) + 'zz')).toBe(true);
  });
  it('rejects 21 and 23 chars', () => {
    expect(isValidBoardId(id22.slice(1))).toBe(false);
    expect(isValidBoardId(id22 + 'a')).toBe(false);
  });
  it.each(['abcdefghijklmnopqrst+v', '../x', '', 'abcdefghijklmnopqrst=v', 'abcdefghijklmnopqrst v'])('rejects %j', (s) => {
    expect(isValidBoardId(s)).toBe(false);
  });
});

describe('newBoardId (TC-02)', () => {
  it('generates 10,000 unique ids matching the pattern', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(BOARD_ID_PATTERN.test(id)).toBe(true);
      seen.add(id);
    }
    expect(seen.size).toBe(10_000);
  });
});
