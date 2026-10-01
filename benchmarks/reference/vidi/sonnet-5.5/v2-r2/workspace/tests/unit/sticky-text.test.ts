import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { applyTextDiff, clampToLimit, counterVisible } from '../../src/client/objects/StickyText';
import { STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';
import { LONG_TEXT, SHORT_TEXT } from '../fixtures/texts';

function textWith(value: string) {
  const doc = new Y.Doc();
  const t = doc.getText('t');
  t.insert(0, value);
  return t;
}

function deltas(t: Y.Text, fn: () => void) {
  const out: unknown[] = [];
  t.observe((e) => out.push(e.changes.delta));
  fn();
  return out;
}

describe('applyTextDiff', () => {
  it('TC-13 inserts a single character without replacing the text', () => {
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

  it('does nothing when unchanged', () => {
    const t = textWith(SHORT_TEXT);
    expect(deltas(t, () => applyTextDiff(t, SHORT_TEXT, 'o'))).toEqual([]);
  });

  it('keeps surrogate pairs intact', () => {
    const t = textWith('a😀b');
    applyTextDiff(t, 'a😁b', 'o');
    expect(t.toString()).toBe('a😁b');
    applyTextDiff(t, 'a😁😀b', 'o');
    expect(t.toString()).toBe('a😁😀b');
    applyTextDiff(t, 'ab', 'o');
    expect(t.toString()).toBe('ab');
    for (const ch of t.toString()) expect(ch.length).toBe(1);
  });
});

describe('clampToLimit', () => {
  it('TC-14 keeps the first 1,000 of a 1,200 character paste', () => {
    const pasted = LONG_TEXT + LONG_TEXT.slice(0, 200);
    expect(pasted.length).toBe(1200);
    expect(clampToLimit(pasted)).toBe(LONG_TEXT);
  });

  it('TC-15 accepts 999 + 1', () => {
    expect(clampToLimit(LONG_TEXT.slice(0, 999) + 'x')).toHaveLength(STICKY_TEXT_MAX_CHARS);
  });

  it('TC-16 rejects 1,000 + 1', () => {
    expect(clampToLimit(LONG_TEXT + 'x')).toBe(LONG_TEXT);
  });

  it('does not split a surrogate pair at the limit', () => {
    const out = clampToLimit(LONG_TEXT.slice(0, 999) + '😀');
    expect(out).toHaveLength(999);
  });
});

describe('counterVisible', () => {
  it('TC-17 appears within 50 characters of the limit', () => {
    expect(counterVisible(949)).toBe(false);
    expect(counterVisible(950)).toBe(true);
    expect(counterVisible(951)).toBe(true);
    expect(counterVisible(1000)).toBe(true);
    expect(counterVisible(0)).toBe(false);
  });
});
