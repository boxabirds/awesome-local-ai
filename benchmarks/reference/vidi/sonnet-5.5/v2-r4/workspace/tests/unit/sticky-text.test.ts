import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { applyTextDiff, clampToLimit, counterVisible } from '../../src/client/objects/StickyText';
import { STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';
import { LONG_TEXT, OVER_LIMIT_TEXT } from '../fixtures/texts';

function textWith(value: string) {
  const doc = new Y.Doc();
  const t = doc.getText('t');
  t.insert(0, value);
  const deltas: unknown[][] = [];
  t.observe((e) => deltas.push(e.changes.delta as unknown[]));
  return { t, deltas };
}

describe('applyTextDiff', () => {
  it('TC-13 inserts a single character without replacing the rest', () => {
    const { t, deltas } = textWith('abc');
    applyTextDiff(t, 'abXc', 'o');
    expect(t.toString()).toBe('abXc');
    expect(deltas).toEqual([[{ retain: 2 }, { insert: 'X' }]]);
  });

  it('deletes in the middle', () => {
    const { t, deltas } = textWith('abcde');
    applyTextDiff(t, 'abe', 'o');
    expect(t.toString()).toBe('abe');
    expect(deltas).toEqual([[{ retain: 2 }, { delete: 2 }]]);
  });

  it('replaces a selection with one transaction', () => {
    const { t, deltas } = textWith('hello world');
    applyTextDiff(t, 'hello there', 'o');
    expect(t.toString()).toBe('hello there');
    expect(deltas).toHaveLength(1);
  });

  it('keeps emoji surrogate pairs intact', () => {
    const { t } = textWith('a😀b');
    applyTextDiff(t, 'a😁b', 'o');
    expect(t.toString()).toBe('a😁b');
    applyTextDiff(t, 'a😁😁b', 'o');
    expect(t.toString()).toBe('a😁😁b');
  });

  it('does nothing when text is unchanged', () => {
    const { t, deltas } = textWith('same');
    applyTextDiff(t, 'same', 'o');
    expect(deltas).toEqual([]);
  });
});

describe('clampToLimit', () => {
  it('TC-14 cuts a 1,200 character paste to 1,000', () => {
    expect(OVER_LIMIT_TEXT).toHaveLength(1200);
    expect(clampToLimit(OVER_LIMIT_TEXT)).toBe(OVER_LIMIT_TEXT.slice(0, STICKY_TEXT_MAX_CHARS));
  });

  it('TC-15 accepts the 1,000th character', () => {
    expect(clampToLimit(LONG_TEXT.slice(0, 999) + 'x')).toHaveLength(1000);
  });

  it('TC-16 rejects the 1,001st character', () => {
    const full = LONG_TEXT.slice(0, 1000);
    expect(clampToLimit(full + 'x')).toBe(full);
  });
});

describe('counterVisible', () => {
  it('TC-17 shows within 50 characters of the limit', () => {
    expect(counterVisible(949)).toBe(false);
    expect(counterVisible(950)).toBe(true);
    expect(counterVisible(951)).toBe(true);
  });
});
