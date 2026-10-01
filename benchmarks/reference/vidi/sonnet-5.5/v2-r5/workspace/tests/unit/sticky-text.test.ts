import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';
import { applyTextDiff, clampToLimit, counterVisible } from '../../src/client/objects/StickyText';
import { LONG_TEXT, OVER_LIMIT_TEXT } from '../fixtures/texts';

function textWith(initial: string): { doc: Y.Doc; ytext: Y.Text } {
  const doc = new Y.Doc();
  const ytext = doc.getText('t');
  ytext.insert(0, initial);
  return { doc, ytext };
}

function deltas(ytext: Y.Text, fn: () => void): unknown[] {
  const out: unknown[] = [];
  ytext.observe((e) => out.push(e.delta));
  fn();
  return out;
}

describe('applyTextDiff', () => {
  it('TC-13 inserts a single char without replacing the rest', () => {
    const { ytext } = textWith('abc');
    const d = deltas(ytext, () => applyTextDiff(ytext, 'abXc', 'o'));
    expect(ytext.toString()).toBe('abXc');
    expect(d).toEqual([[{ retain: 2 }, { insert: 'X' }]]);
  });

  it('deletes in the middle', () => {
    const { ytext } = textWith('abcde');
    const d = deltas(ytext, () => applyTextDiff(ytext, 'abe', 'o'));
    expect(ytext.toString()).toBe('abe');
    expect(d).toEqual([[{ retain: 2 }, { delete: 2 }]]);
  });

  it('replaces a selection', () => {
    const { ytext } = textWith('hello world');
    applyTextDiff(ytext, 'hello there', 'o');
    expect(ytext.toString()).toBe('hello there');
  });

  it('is a no-op when nothing changed', () => {
    const { ytext } = textWith('same');
    const d = deltas(ytext, () => applyTextDiff(ytext, 'same', 'o'));
    expect(d).toEqual([]);
  });

  it('keeps surrogate pairs intact', () => {
    const { ytext } = textWith('a😀b');
    applyTextDiff(ytext, 'a😁b', 'o');
    expect(ytext.toString()).toBe('a😁b');
    applyTextDiff(ytext, 'a😁😀b', 'o');
    expect(ytext.toString()).toBe('a😁😀b');
    applyTextDiff(ytext, 'ab', 'o');
    expect(ytext.toString()).toBe('ab');
  });
});

describe('clampToLimit', () => {
  it('TC-14 keeps the first 1,000 characters of a 1,200 paste', () => {
    expect(OVER_LIMIT_TEXT).toHaveLength(1200);
    const out = clampToLimit(OVER_LIMIT_TEXT);
    expect(out).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(out).toBe(OVER_LIMIT_TEXT.slice(0, 1000));
  });

  it('TC-15 accepts 999 + 1', () => {
    expect(clampToLimit(LONG_TEXT.slice(0, 999) + 'x')).toHaveLength(1000);
  });

  it('TC-16 rejects 1,000 + 1', () => {
    expect(clampToLimit(LONG_TEXT + 'x')).toBe(LONG_TEXT);
  });

  it('does not split a surrogate pair at the limit', () => {
    expect(clampToLimit('ab😀', 3)).toBe('ab');
  });
});

describe('counterVisible', () => {
  it('TC-17 switches on at 950 characters', () => {
    expect(counterVisible(949)).toBe(false);
    expect(counterVisible(950)).toBe(true);
    expect(counterVisible(951)).toBe(true);
    expect(counterVisible(1000)).toBe(true);
  });
});
