import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { applyTextDiff, clampToLimit, counterVisible } from '../../src/client/objects/StickyText';
import { STICKY_COUNTER_THRESHOLD_CHARS, STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';
import { PROSE_1000, PROSE_1200, RETRO_ITEM, SHORT_PHRASE } from '../fixtures/texts';

const ORIGIN = Symbol('test');

/** A Y.Text attached to a doc, plus a recorder of every delta the doc emits for it. */
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
  let updates = 0;
  doc.on('update', () => {
    updates += 1;
  });
  return { ytext, deltas, origins, updates: () => updates };
}

/** Simulates the textarea: typing `insert` at the end, then clamping, as the editor does. */
function typeAtEnd(current: string, insert: string): string {
  return clampToLimit(current + insert);
}

describe('sticky.text applyTextDiff', () => {
  it('TC-13 abc → abXc is a single insert of X at index 2', () => {
    const t = textWith('abc');
    applyTextDiff(t.ytext, 'abXc', ORIGIN);
    expect(t.ytext.toString()).toBe('abXc');
    expect(t.deltas).toEqual([[{ retain: 2 }, { insert: 'X' }]]);
    expect(t.origins).toEqual([ORIGIN]);
    expect(t.updates()).toBe(1);
  });

  it('deletes only the removed middle range', () => {
    const t = textWith(SHORT_PHRASE);
    applyTextDiff(t.ytext, 'Faster boarding', ORIGIN);
    expect(t.ytext.toString()).toBe('Faster boarding');
    expect(t.deltas).toEqual([[{ retain: 7 }, { delete: 2 }]]);
  });

  it('replaces a selection with one delete and one insert in one transaction', () => {
    const t = textWith(RETRO_ITEM);
    const next = RETRO_ITEM.replace('two merges', 'three merges');
    applyTextDiff(t.ytext, next, ORIGIN);
    expect(t.ytext.toString()).toBe(next);
    expect(t.updates()).toBe(1);
    const delta = t.deltas[0] as Array<Record<string, unknown>>;
    const inserted = delta.filter((op) => 'insert' in op).map((op) => op.insert).join('');
    const deleted = delta.filter((op) => 'delete' in op).reduce((n, op) => n + (op.delete as number), 0);
    expect(inserted.length + deleted).toBeLessThan('three'.length * 2);
  });

  it('keeps emoji surrogate pairs intact when one emoji replaces another', () => {
    const t = textWith('Vote 👍 here');
    applyTextDiff(t.ytext, 'Vote 👎 here', ORIGIN);
    expect(t.ytext.toString()).toBe('Vote 👎 here');
    const delta = t.deltas[0] as Array<Record<string, unknown>>;
    // The whole emoji (2 code units) is replaced, never half of a pair.
    expect(delta[0]).toEqual({ retain: 5 });
    expect(delta.slice(1)).toHaveLength(2);
    expect(delta.slice(1)).toEqual(expect.arrayContaining([{ insert: '👎' }, { delete: 2 }]));
  });

  it('does nothing when the text is unchanged', () => {
    const t = textWith(SHORT_PHRASE);
    applyTextDiff(t.ytext, SHORT_PHRASE, ORIGIN);
    expect(t.updates()).toBe(0);
  });

  it('handles repeated characters around the edit (abb → abbb)', () => {
    const t = textWith('abb');
    applyTextDiff(t.ytext, 'abbb', ORIGIN);
    expect(t.ytext.toString()).toBe('abbb');
    expect(t.updates()).toBe(1);
  });
});

describe('sticky.text length limit', () => {
  it('TC-14 a 1,200 character paste into an empty note keeps the first 1,000', () => {
    expect(PROSE_1200).toHaveLength(1200);
    const kept = clampToLimit(PROSE_1200);
    expect(kept).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(kept).toBe(PROSE_1200.slice(0, STICKY_TEXT_MAX_CHARS));
  });

  it('TC-15 999 + 1 character is accepted (1,000)', () => {
    const base = PROSE_1000.slice(0, STICKY_TEXT_MAX_CHARS - 1);
    expect(typeAtEnd(base, 'x')).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(typeAtEnd(base, 'x').endsWith('x')).toBe(true);
  });

  it('TC-16 1,000 + 1 character is rejected; still 1,000', () => {
    expect(typeAtEnd(PROSE_1000, 'x')).toBe(PROSE_1000);
  });

  it('leaves text under the limit untouched and honours an explicit max', () => {
    expect(clampToLimit(SHORT_PHRASE)).toBe(SHORT_PHRASE);
    expect(clampToLimit(SHORT_PHRASE, 6)).toBe('Faster');
  });

  it('never cuts an emoji in half at the limit', () => {
    const text = `${'a'.repeat(STICKY_TEXT_MAX_CHARS - 1)}😀`;
    const kept = clampToLimit(text);
    expect(kept).toHaveLength(STICKY_TEXT_MAX_CHARS - 1);
  });
});

describe('sticky.text counter', () => {
  it('TC-17 counter shows at 950 and 951 characters, not at 949', () => {
    const threshold = STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS;
    expect(counterVisible(threshold - 1)).toBe(false);
    expect(counterVisible(threshold)).toBe(true);
    expect(counterVisible(threshold + 1)).toBe(true);
    expect(counterVisible(0)).toBe(false);
    expect(counterVisible(STICKY_TEXT_MAX_CHARS)).toBe(true);
  });
});
