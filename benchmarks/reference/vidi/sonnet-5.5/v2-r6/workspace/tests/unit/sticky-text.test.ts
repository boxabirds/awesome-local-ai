import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';
import {
  applyTextDiff, clampEdit, clampToLimit, counterVisible,
} from '../../src/client/objects/StickyText';
import { LONG_TEXT } from '../fixtures/texts';

function textDoc(initial: string) {
  const doc = new Y.Doc();
  const t = doc.getText('t');
  t.insert(0, initial);
  const deltas: unknown[] = [];
  t.observe((e) => deltas.push(e.changes.delta));
  return { t, deltas };
}

describe('applyTextDiff', () => {
  it('TC-13 inserts only the changed character', () => {
    const { t, deltas } = textDoc('abc');
    applyTextDiff(t, 'abXc', 'o');
    expect(t.toString()).toBe('abXc');
    expect(deltas).toEqual([[{ retain: 2 }, { insert: 'X' }]]);
  });

  it('deletes in the middle', () => {
    const { t, deltas } = textDoc('abcde');
    applyTextDiff(t, 'abde', 'o');
    expect(t.toString()).toBe('abde');
    expect(deltas).toEqual([[{ retain: 2 }, { delete: 1 }]]);
  });

  it('replaces a selection', () => {
    const { t } = textDoc('hello world');
    applyTextDiff(t, 'hello there', 'o');
    expect(t.toString()).toBe('hello there');
  });

  it('keeps emoji surrogate pairs intact', () => {
    const { t } = textDoc('a😀b');
    applyTextDiff(t, 'a😁b', 'o');
    expect(t.toString()).toBe('a😁b');
    applyTextDiff(t, 'a😁😀b', 'o');
    expect(t.toString()).toBe('a😁😀b');
    applyTextDiff(t, 'ab', 'o');
    expect(t.toString()).toBe('ab');
  });

  it('does nothing when text is unchanged', () => {
    const { t, deltas } = textDoc('same');
    applyTextDiff(t, 'same', 'o');
    expect(deltas).toEqual([]);
  });
});

describe('length limit', () => {
  it('TC-14 a 1,200 character paste keeps the first 1,000', () => {
    const pasted = LONG_TEXT + LONG_TEXT.slice(0, 200);
    expect(pasted).toHaveLength(1200);
    expect(clampToLimit(pasted)).toBe(LONG_TEXT);
    expect(clampEdit('', pasted).value).toBe(LONG_TEXT);
  });

  it('TC-15 999 + 1 is accepted', () => {
    const prev = LONG_TEXT.slice(0, 999);
    expect(clampEdit(prev, `${prev}x`).value).toHaveLength(STICKY_TEXT_MAX_CHARS);
  });

  it('TC-16 1,000 + 1 is rejected, wherever it is typed', () => {
    expect(clampToLimit(`${LONG_TEXT}x`)).toBe(LONG_TEXT);
    const mid = clampEdit(LONG_TEXT, `${LONG_TEXT.slice(0, 5)}Z${LONG_TEXT.slice(5)}`);
    expect(mid.value).toBe(LONG_TEXT);
    expect(mid.caret).toBe(5);
  });

  it('does not split a surrogate pair at the limit', () => {
    const prev = 'a'.repeat(999);
    expect(clampEdit(prev, `${prev}😀`).value).toBe(prev);
  });

  it('TC-17 counter appears within 50 characters of the limit', () => {
    expect(counterVisible(949)).toBe(false);
    expect(counterVisible(950)).toBe(true);
    expect(counterVisible(951)).toBe(true);
    expect(counterVisible(1000)).toBe(true);
  });
});
