import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import { STICKY_COUNTER_THRESHOLD_CHARS, STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';
import { applyTextDiff, clampEdit, clampToLimit, counterVisible, diffText } from '../../src/client/objects/StickyText';
import { SHORT_PHRASE, prose } from '../fixtures/texts';

function textWith(initial: string) {
  const doc = new Y.Doc();
  const ytext = doc.getText('t');
  ytext.insert(0, initial);
  const deltas: unknown[] = [];
  const origins: unknown[] = [];
  ytext.observe((e) => {
    deltas.push(e.delta);
    origins.push(e.transaction.origin);
  });
  return { ytext, deltas, origins };
}

describe('sticky.text applyTextDiff', () => {
  it('TC-13 abc → abXc is a single insert of X at index 2', () => {
    const { ytext, deltas, origins } = textWith('abc');
    applyTextDiff(ytext, 'abXc', LOCAL_ORIGIN);
    expect(ytext.toString()).toBe('abXc');
    expect(deltas).toEqual([[{ retain: 2 }, { insert: 'X' }]]);
    expect(origins).toEqual([LOCAL_ORIGIN]);
  });

  it('pure deletion in the middle deletes only those characters', () => {
    const { ytext, deltas } = textWith(SHORT_PHRASE);
    applyTextDiff(ytext, 'Faster boarding', LOCAL_ORIGIN);
    expect(ytext.toString()).toBe('Faster boarding');
    expect(deltas).toEqual([[{ retain: 7 }, { delete: 2 }]]);
  });

  it('replacing a selection is one delete plus one insert in one transaction', () => {
    const { ytext, deltas } = textWith('Faster onboarding');
    applyTextDiff(ytext, 'Smoother onboarding', LOCAL_ORIGIN);
    expect(ytext.toString()).toBe('Smoother onboarding');
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toEqual([{ delete: 4 }, { insert: 'Smooth' }]);
  });

  it('no change emits nothing', () => {
    const { ytext, deltas } = textWith('abc');
    applyTextDiff(ytext, 'abc', LOCAL_ORIGIN);
    expect(deltas).toEqual([]);
  });

  it('keeps emoji surrogate pairs intact', () => {
    // 😀 = 😀, 😃 = 😃: they share the high surrogate.
    const { ytext } = textWith('Ship it 😀!');
    applyTextDiff(ytext, 'Ship it 😃!', LOCAL_ORIGIN);
    expect(ytext.toString()).toBe('Ship it 😃!');
    const change = diffText('Ship it 😀!', 'Ship it 😃!');
    expect(change).toEqual({ start: 8, deleteCount: 2, insert: '😃' });
    // Same low surrogate at the end.
    expect(diffText('a😀', 'a🈀')).toEqual({ start: 1, deleteCount: 2, insert: '🈀' });
  });
});

describe('sticky.text length limit', () => {
  it('TC-14 a 1,200 character paste into an empty note keeps the first 1,000', () => {
    const pasted = prose(1200);
    expect(clampToLimit(pasted)).toBe(pasted.slice(0, STICKY_TEXT_MAX_CHARS));
    expect(clampEdit('', pasted)).toEqual({ text: pasted.slice(0, STICKY_TEXT_MAX_CHARS), caret: STICKY_TEXT_MAX_CHARS });
  });

  it('TC-15 999 + 1 character reaches exactly 1,000 and is accepted', () => {
    const prev = prose(999);
    const next = `${prev}.`;
    expect(clampToLimit(next)).toBe(next);
    expect(clampEdit(prev, next)).toEqual({ text: next, caret: null });
  });

  it('TC-16 inserting at 1,000 characters adds nothing', () => {
    const prev = prose(STICKY_TEXT_MAX_CHARS);
    expect(clampToLimit(`${prev}x`)).toBe(prev);
    expect(clampToLimit(`${prev}x`)).toHaveLength(STICKY_TEXT_MAX_CHARS);
    // Typing in the middle of a full note does not push the last character out.
    const middle = `${prev.slice(0, 10)}x${prev.slice(10)}`;
    expect(clampEdit(prev, middle)).toEqual({ text: prev, caret: 10 });
    // 1,001 boundary.
    expect(clampToLimit(prose(1001))).toHaveLength(STICKY_TEXT_MAX_CHARS);
  });

  it('pasting into the middle keeps only what fits, before the existing tail', () => {
    const prev = prose(990);
    const next = `${prev.slice(0, 5)}0123456789ABCDEF${prev.slice(5)}`;
    const { text, caret } = clampEdit(prev, next);
    expect(text).toBe(`${prev.slice(0, 5)}0123456789${prev.slice(5)}`);
    expect(text).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(caret).toBe(15);
  });

  it('never splits an emoji at the limit', () => {
    const text = `${'a'.repeat(STICKY_TEXT_MAX_CHARS - 1)}😀`;
    expect(clampToLimit(text)).toBe('a'.repeat(STICKY_TEXT_MAX_CHARS - 1));
  });
});

describe('sticky.text counter', () => {
  it('TC-17 is hidden at 949 characters and visible at 950 and 951', () => {
    expect(STICKY_TEXT_MAX_CHARS - 949).toBe(STICKY_COUNTER_THRESHOLD_CHARS + 1);
    expect(counterVisible(949)).toBe(false);
    expect(counterVisible(950)).toBe(true);
    expect(counterVisible(951)).toBe(true);
    expect(counterVisible(0)).toBe(false);
    expect(counterVisible(STICKY_TEXT_MAX_CHARS)).toBe(true);
  });
});
