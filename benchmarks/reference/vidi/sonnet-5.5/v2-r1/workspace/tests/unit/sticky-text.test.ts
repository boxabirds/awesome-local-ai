import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { applyTextDiff, clampToLimit, counterVisible } from '../../src/client/objects/StickyText';
import { STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';
import { LONG_TEXT, OVER_LIMIT_TEXT } from '../fixtures/texts';

function textWith(value: string): Y.Text {
  const doc = new Y.Doc();
  const t = doc.getText('t');
  t.insert(0, value);
  return t;
}

function deltas(t: Y.Text, fn: () => void): unknown[][] {
  const out: unknown[][] = [];
  t.observe((e) => out.push(e.delta as unknown[]));
  fn();
  return out;
}

describe('applyTextDiff', () => {
  it('TC-13 inserts a single char without rewriting the text', () => {
    const t = textWith('abc');
    const d = deltas(t, () => applyTextDiff(t, 'abXc', 'o'));
    expect(t.toString()).toBe('abXc');
    expect(d).toEqual([[{ retain: 2 }, { insert: 'X' }]]);
  });

  it('deletes in the middle', () => {
    const t = textWith('abcde');
    const d = deltas(t, () => applyTextDiff(t, 'abe', 'o'));
    expect(t.toString()).toBe('abe');
    expect(d).toEqual([[{ retain: 2 }, { delete: 2 }]]);
  });

  it('replaces a selection', () => {
    const t = textWith('hello world');
    applyTextDiff(t, 'hello there', 'o');
    expect(t.toString()).toBe('hello there');
  });

  it('keeps emoji surrogate pairs intact', () => {
    const t = textWith('a😀b');
    applyTextDiff(t, 'a😁b', 'o');
    expect(t.toString()).toBe('a😁b');
    applyTextDiff(t, 'a😁😀b', 'o');
    expect(t.toString()).toBe('a😁😀b');
  });

  it('does nothing when unchanged', () => {
    const t = textWith('same');
    expect(deltas(t, () => applyTextDiff(t, 'same', 'o'))).toEqual([]);
  });
});

describe('clampToLimit', () => {
  it('TC-14 keeps the first 1,000 of 1,200 characters', () => {
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
    expect(clampToLimit('a'.repeat(999) + '😀')).toBe('a'.repeat(999));
  });
});

describe('counterVisible', () => {
  it('TC-17 appears within 50 characters of the limit', () => {
    expect(counterVisible(949)).toBe(false);
    expect(counterVisible(950)).toBe(true);
    expect(counterVisible(951)).toBe(true);
    expect(counterVisible(1000)).toBe(true);
  });
});
