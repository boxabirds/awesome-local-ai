import { describe, expect, it } from 'vitest';
import { actionForKey, removalTarget, rovingIndex } from '@/features/tasks/useRovingList';

describe('roving list maths', () => {
  it('TC-106 next/prev clamp at the ends (no wrap); Home/End go to first/last', () => {
    expect(rovingIndex(0, 3, 'next')).toBe(1);
    expect(rovingIndex(2, 3, 'next')).toBe(2);
    expect(rovingIndex(0, 3, 'prev')).toBe(0);
    expect(rovingIndex(2, 3, 'prev')).toBe(1);
    expect(rovingIndex(1, 3, 'first')).toBe(0);
    expect(rovingIndex(1, 3, 'last')).toBe(2);
    expect(rovingIndex(-1, 3, 'next')).toBe(0);
    expect(rovingIndex(0, 0, 'next')).toBe(-1);
  });

  it('TC-106 focusAfterRemoval targets: middle -> next, last -> previous, only -> the add button (null)', () => {
    expect(removalTarget(['a', 'b', 'c'], 'b')).toBe('c');
    expect(removalTarget(['a', 'b', 'c'], 'c')).toBe('b');
    expect(removalTarget(['a'], 'a')).toBeNull();
  });

  it('maps ↑/k, ↓/j, Home and End; ignores other keys', () => {
    expect(['ArrowDown', 'j', 'ArrowUp', 'k', 'Home', 'End', 'x', 'Enter'].map(actionForKey)).toEqual([
      'next',
      'next',
      'prev',
      'prev',
      'first',
      'last',
      null,
      null,
    ]);
  });
});
