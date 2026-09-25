import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { applyTextDiff, clampToLimit, counterVisible, limitEdit } from '../../src/client/objects/StickyText';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import { STICKY_COUNTER_THRESHOLD_CHARS, STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';
import { SHORT_TEXT, prose } from '../fixtures/texts';

type Delta = { insert?: unknown; delete?: number; retain?: number }[];

/** Y.Text holding `initial`, plus the deltas and transaction count of every later change. */
function textWith(initial: string) {
  const doc = new Y.Doc();
  const ytext = doc.getText('t');
  ytext.insert(0, initial);
  const deltas: Delta[] = [];
  const origins: unknown[] = [];
  ytext.observe((e, tr) => {
    deltas.push(e.delta as Delta);
    origins.push(tr.origin);
  });
  return { ytext, deltas, origins };
}

describe('applyTextDiff (sticky.text)', () => {
  it('TC-13 abc → abXc is a single insert of X at 2, not a full replace', () => {
    const { ytext, deltas, origins } = textWith('abc');
    applyTextDiff(ytext, 'abXc', LOCAL_ORIGIN);
    expect(ytext.toString()).toBe('abXc');
    expect(deltas).toEqual([[{ retain: 2 }, { insert: 'X' }]]);
    expect(origins).toEqual([LOCAL_ORIGIN]);
  });

  it('deletes only the removed middle part', () => {
    const { ytext, deltas } = textWith(SHORT_TEXT);
    applyTextDiff(ytext, 'Faster boarding', LOCAL_ORIGIN);
    expect(ytext.toString()).toBe('Faster boarding');
    expect(deltas).toEqual([[{ retain: 7 }, { delete: 2 }]]);
  });

  it('replaces a selection with one delete and one insert in one transaction', () => {
    const { ytext, deltas } = textWith(SHORT_TEXT);
    applyTextDiff(ytext, 'Smoother onboarding', LOCAL_ORIGIN);
    expect(ytext.toString()).toBe('Smoother onboarding');
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toHaveLength(2);
    expect(deltas[0]).toContainEqual({ insert: 'Smooth' });
    expect(deltas[0]).toContainEqual({ delete: 4 });
  });

  it('keeps emoji surrogate pairs intact', () => {
    const { ytext } = textWith('Ship it 🚀 now');
    // Replacing one emoji with another that shares the high surrogate.
    applyTextDiff(ytext, 'Ship it 🚁 now', LOCAL_ORIGIN);
    expect(ytext.toString()).toBe('Ship it 🚁 now');
    const { ytext: t2, deltas } = textWith('🚀🚀');
    applyTextDiff(t2, '🚀', LOCAL_ORIGIN);
    expect(t2.toString()).toBe('🚀');
    const inserted = deltas.flat().flatMap((d) => (typeof d.insert === 'string' ? [d.insert] : []));
    for (const s of inserted) expect(s).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
  });

  it('emits nothing when the text is unchanged', () => {
    const { ytext, deltas } = textWith(SHORT_TEXT);
    applyTextDiff(ytext, SHORT_TEXT, LOCAL_ORIGIN);
    expect(deltas).toEqual([]);
  });
});

describe('text limit (sticky.text_limit)', () => {
  it('TC-14 pasting 1,200 characters into an empty note keeps the first 1,000', () => {
    const pasted = prose(1200);
    expect(clampToLimit(pasted)).toBe(pasted.slice(0, STICKY_TEXT_MAX_CHARS));
    expect(clampToLimit(pasted)).toHaveLength(STICKY_TEXT_MAX_CHARS);
    const edit = limitEdit('', pasted);
    expect(edit.value).toBe(pasted.slice(0, STICKY_TEXT_MAX_CHARS));
    expect(edit.caret).toBe(STICKY_TEXT_MAX_CHARS);
  });

  it('TC-15 999 + 1 character is accepted (1,000)', () => {
    const prev = prose(999);
    const next = prev + 'x';
    expect(clampToLimit(next)).toBe(next);
    expect(limitEdit(prev, next)).toEqual({ value: next, caret: null });
  });

  it('TC-16 1,000 + 1 character is rejected (still 1,000)', () => {
    const prev = prose(1000);
    expect(clampToLimit(prev + 'x')).toBe(prev);
    expect(limitEdit(prev, prev + 'x').value).toBe(prev);
    // Typing in the middle of a full note drops the typed character, not the end of the text.
    const middle = prev.slice(0, 10) + 'x' + prev.slice(10);
    expect(limitEdit(prev, middle)).toEqual({ value: prev, caret: 10 });
  });

  it('a paste in the middle keeps as much of the pasted text as fits', () => {
    const prev = prose(990);
    const pasted = 'ABCDEFGHIJKLMNOPQRST';
    const next = prev.slice(0, 5) + pasted + prev.slice(5);
    const edit = limitEdit(prev, next);
    expect(edit.value).toBe(prev.slice(0, 5) + 'ABCDEFGHIJ' + prev.slice(5));
    expect(edit.value).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(edit.caret).toBe(15);
  });

  it('never cuts an emoji in half', () => {
    const next = 'a'.repeat(999) + '🚀';
    expect(clampToLimit(next)).toBe('a'.repeat(999));
    expect(clampToLimit('🚀🚀', 3)).toBe('🚀');
  });

  it('honours a custom limit', () => {
    expect(clampToLimit(SHORT_TEXT, 6)).toBe('Faster');
  });
});

describe('counterVisible (character counter)', () => {
  it('TC-17 hidden at 949, shown at 950 and 951 characters', () => {
    expect(STICKY_TEXT_MAX_CHARS - 950).toBe(STICKY_COUNTER_THRESHOLD_CHARS);
    expect(counterVisible(949)).toBe(false);
    expect(counterVisible(950)).toBe(true);
    expect(counterVisible(951)).toBe(true);
    expect(counterVisible(0)).toBe(false);
    expect(counterVisible(STICKY_TEXT_MAX_CHARS)).toBe(true);
  });
});
