import { describe, expect, it } from 'vitest';
import { indexAfterRemoval, rovingTarget } from '@/features/tasks/useRovingList';

describe('TC-106 roving list maths (3 rows)', () => {
  it('next from the last row and previous from the first clamp (no wrap)', () => {
    expect(rovingTarget(2, 3, 'ArrowDown')).toBe(2);
    expect(rovingTarget(2, 3, 'j')).toBe(2);
    expect(rovingTarget(0, 3, 'ArrowUp')).toBe(0);
    expect(rovingTarget(0, 3, 'k')).toBe(0);
  });

  it('moves one row in between, and Home/End jump to the ends', () => {
    expect(rovingTarget(0, 3, 'ArrowDown')).toBe(1);
    expect(rovingTarget(1, 3, 'j')).toBe(2);
    expect(rovingTarget(2, 3, 'ArrowUp')).toBe(1);
    expect(rovingTarget(1, 3, 'k')).toBe(0);
    expect(rovingTarget(1, 3, 'Home')).toBe(0);
    expect(rovingTarget(1, 3, 'End')).toBe(2);
  });

  it('other keys and empty lists move nothing', () => {
    expect(rovingTarget(1, 3, 'Enter')).toBeNull();
    expect(rovingTarget(1, 3, 'q')).toBeNull();
    expect(rovingTarget(0, 0, 'ArrowDown')).toBeNull();
  });

  it('focusAfterRemoval: the middle row -> the next row; the last row -> the previous row; the only row -> the add button', () => {
    const ids = ['a', 'b', 'c'];
    // Indexes are into the list without the removed row.
    expect(indexAfterRemoval(ids, 'b')).toBe(1); // 'c'
    expect(indexAfterRemoval(ids, 'c')).toBe(1); // 'b'
    expect(indexAfterRemoval(ids, 'a')).toBe(0); // 'b'
    expect(indexAfterRemoval(['only'], 'only')).toBe(-1);
  });
});
