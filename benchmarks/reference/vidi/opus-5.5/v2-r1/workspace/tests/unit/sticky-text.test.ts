import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import { STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';
import {
  applyTextDiff,
  clampEdit,
  clampToLimit,
  counterVisible,
} from '../../src/client/objects/StickyText';
import { LONG_PROSE_1000, RETRO_ITEM, SHORT_TEXT, prose } from '../fixtures/texts';

function textWith(initial: string) {
  const doc = new Y.Doc();
  const ytext = doc.getText('t');
  ytext.insert(0, initial);
  const deltas: unknown[] = [];
  const origins: unknown[] = [];
  ytext.observe((event) => {
    deltas.push(event.delta);
    origins.push(event.transaction.origin);
  });
  return { ytext, deltas, origins };
}

describe('sticky.text applyTextDiff', () => {
  it('TC-13 insert in the middle is a single insert, not a full replace', () => {
    const { ytext, deltas, origins } = textWith('abc');
    applyTextDiff(ytext, 'abXc', LOCAL_ORIGIN);
    expect(ytext.toString()).toBe('abXc');
    expect(deltas).toEqual([[{ retain: 2 }, { insert: 'X' }]]);
    expect(origins).toEqual([LOCAL_ORIGIN]);
  });

  it('deletion in the middle is a single delete', () => {
    const { ytext, deltas } = textWith(SHORT_TEXT);
    applyTextDiff(ytext, 'Faster boarding', LOCAL_ORIGIN);
    expect(ytext.toString()).toBe('Faster boarding');
    expect(deltas).toEqual([[{ retain: 7 }, { delete: 2 }]]);
  });

  it('replacing a selection is one delete plus one insert in one transaction', () => {
    const { ytext, deltas } = textWith(RETRO_ITEM);
    const next = RETRO_ITEM.replace('flaky CI', 'slow reviews');
    applyTextDiff(ytext, next, LOCAL_ORIGIN);
    expect(ytext.toString()).toBe(next);
    expect(deltas).toHaveLength(1);
    const ops = deltas[0] as Array<Record<string, unknown>>;
    expect(ops.filter((op) => 'insert' in op)).toHaveLength(1);
    expect(ops.filter((op) => 'delete' in op)).toHaveLength(1);
  });

  it('no change emits nothing', () => {
    const { ytext, deltas } = textWith(SHORT_TEXT);
    applyTextDiff(ytext, SHORT_TEXT, LOCAL_ORIGIN);
    expect(deltas).toHaveLength(0);
  });

  it('keeps emoji surrogate pairs intact', () => {
    const { ytext } = textWith('Ship it 🚀 now');
    applyTextDiff(ytext, 'Ship it 🚁 now', LOCAL_ORIGIN);
    expect(ytext.toString()).toBe('Ship it 🚁 now');
    const { ytext: t2, deltas } = textWith('a😀');
    applyTextDiff(t2, 'a😁', LOCAL_ORIGIN);
    expect(t2.toString()).toBe('a😁');
    // The whole pair is replaced, never half of it.
    expect(deltas).toEqual([[{ retain: 1 }, { delete: 2 }, { insert: '😁' }]]);
  });
});

describe('sticky.text length limit', () => {
  it('TC-14 a 1,200 character paste into an empty note keeps the first 1,000', () => {
    const pasted = prose(1200);
    expect(clampToLimit(pasted)).toBe(pasted.slice(0, STICKY_TEXT_MAX_CHARS));
    expect(clampToLimit(pasted)).toHaveLength(1000);
    expect(clampEdit('', pasted)).toEqual({ text: pasted.slice(0, 1000), caret: 1000 });
  });

  it('TC-15 999 + 1 character reaches exactly 1,000', () => {
    const prev = LONG_PROSE_1000.slice(0, 999);
    const next = `${prev}.`;
    expect(clampToLimit(next)).toBe(next);
    expect(clampEdit(prev, next)).toEqual({ text: next, caret: 1000 });
  });

  it('TC-16 inserting at 1,000 characters is rejected (still 1,000)', () => {
    const next = `${LONG_PROSE_1000}!`;
    expect(clampToLimit(next)).toBe(LONG_PROSE_1000);
    // Typing in the middle drops the typed character, not the end of the existing text.
    const middle = `${LONG_PROSE_1000.slice(0, 10)}X${LONG_PROSE_1000.slice(10)}`;
    expect(clampEdit(LONG_PROSE_1000, middle)).toEqual({ text: LONG_PROSE_1000, caret: 10 });
  });

  it('a paste in the middle keeps the pasted part that fits and all existing text', () => {
    const prev = prose(990);
    const next = `${prev.slice(0, 5)}0123456789ABCDEF${prev.slice(5)}`;
    const { text, caret } = clampEdit(prev, next);
    expect(text).toBe(`${prev.slice(0, 5)}0123456789${prev.slice(5)}`);
    expect(text).toHaveLength(1000);
    expect(caret).toBe(15);
  });

  it('never splits a surrogate pair at the limit', () => {
    const text = `${'a'.repeat(999)}😀`;
    expect(clampToLimit(text)).toBe('a'.repeat(999));
  });

  it('TC-17 counter visibility at 949 / 950 / 951 characters', () => {
    expect(counterVisible(0)).toBe(false);
    expect(counterVisible(949)).toBe(false);
    expect(counterVisible(950)).toBe(true);
    expect(counterVisible(951)).toBe(true);
    expect(counterVisible(1000)).toBe(true);
  });
});
