import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { applyTextDiff, clampToLimit, counterVisible } from '../../src/client/objects/StickyText';
import { STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';
import { LONG_TEXT, OVER_LIMIT_TEXT } from '../fixtures/texts';

function textWith(initial: string) {
  const doc = new Y.Doc();
  const t = doc.getText('t');
  t.insert(0, initial);
  const deltas: unknown[] = [];
  t.observe((e) => deltas.push(e.changes.delta));
  return { t, deltas };
}

describe('applyTextDiff', () => {
  it('TC-13 single insert in the middle is one insert op, not a rewrite', () => {
    const { t, deltas } = textWith('abc');
    applyTextDiff(t, 'abXc', 'o');
    expect(t.toString()).toBe('abXc');
    expect(deltas).toEqual([[{ retain: 2 }, { insert: 'X' }]]);
  });

  it('deletes in the middle', () => {
    const { t, deltas } = textWith('abcd');
    applyTextDiff(t, 'ad', 'o');
    expect(t.toString()).toBe('ad');
    expect(deltas).toEqual([[{ retain: 1 }, { delete: 2 }]]);
  });

  it('replaces a selection', () => {
    const { t } = textWith('hello world');
    applyTextDiff(t, 'hello there', 'o');
    expect(t.toString()).toBe('hello there');
  });

  it('does nothing when unchanged', () => {
    const { t, deltas } = textWith('same');
    applyTextDiff(t, 'same', 'o');
    expect(deltas).toEqual([]);
  });

  it('keeps emoji surrogate pairs intact', () => {
    const { t } = textWith('a😀b');
    applyTextDiff(t, 'a😁b', 'o');
    expect(t.toString()).toBe('a😁b');
    applyTextDiff(t, 'a😁😀b', 'o');
    expect(t.toString()).toBe('a😁😀b');
    applyTextDiff(t, 'ab', 'o');
    expect(t.toString()).toBe('ab');
  });
});

describe('clampToLimit', () => {
  it('TC-14 keeps the first 1,000 of a 1,200 character paste', () => {
    expect(OVER_LIMIT_TEXT).toHaveLength(1200);
    expect(clampToLimit(OVER_LIMIT_TEXT)).toBe(OVER_LIMIT_TEXT.slice(0, STICKY_TEXT_MAX_CHARS));
  });

  it('TC-15 999 + 1 is accepted', () => {
    expect(clampToLimit(LONG_TEXT.slice(0, 999) + 'x')).toHaveLength(1000);
  });

  it('TC-16 1,000 + 1 is rejected', () => {
    expect(clampToLimit(LONG_TEXT + 'x')).toBe(LONG_TEXT);
  });

  it('does not split a surrogate pair at the limit', () => {
    const s = 'a'.repeat(999) + '😀';
    expect(clampToLimit(s)).toBe('a'.repeat(999));
  });
});

describe('counterVisible', () => {
  it('TC-17 threshold boundary', () => {
    expect(counterVisible(949)).toBe(false);
    expect(counterVisible(950)).toBe(true);
    expect(counterVisible(951)).toBe(true);
    expect(counterVisible(1000)).toBe(true);
  });
});
