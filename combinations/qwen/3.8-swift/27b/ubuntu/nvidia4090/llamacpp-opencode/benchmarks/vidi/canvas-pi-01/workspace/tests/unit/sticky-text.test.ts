// sticky.text pure logic (story 2, TC-13 to TC-17) — unit tests.

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { applyTextDiff, clampToLimit, counterVisible } from '../../src/client/objects/StickyText';
import { STICKY_COUNTER_THRESHOLD_CHARS, STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';
import { SHORT_PHRASE, THOUSAND_CHAR_PARAGRAPH, TWO_THOUSAND_CHARS_PARAGRAPH } from '../fixtures/texts';

type TextDelta = { retain?: number; insert?: string; delete?: number };

/** Y.Text inside a real Y.Doc (yjs requires types to belong to a document). */
function text(initial: string): Y.Text {
  const doc = new Y.Doc();
  const ytext = doc.getText('t');
  if (initial.length > 0) {
    ytext.insert(0, initial);
  }
  return ytext;
}

function observeDeltas(ytext: Y.Text): TextDelta[][] {
  const deltas: TextDelta[][] = [];
  ytext.observe((event) => {
    deltas.push(event.changes.delta as TextDelta[]);
  });
  return deltas;
}

describe('sticky.text', () => {
  it('TC-13 applyTextDiff abc → abXc: single insert of "X" at index 2, not delete-all + insert-all', () => {
    const ytext = text('abc');
    const deltas = observeDeltas(ytext);
    applyTextDiff(ytext, 'abXc', 'test');
    expect(ytext.toString()).toBe('abXc');
    const flat = deltas.flat();
    // "ab" retained, "X" inserted at 2, "c" retained. No delete anywhere.
    expect(flat).toEqual([{ retain: 2 }, { insert: 'X' }]);
    expect(flat.every((d) => d.delete === undefined)).toBe(true);
  });

  it('TC-13b pure insertion: single insert, no delete', () => {
    const ytext = text('abc');
    const deltas = observeDeltas(ytext);
    applyTextDiff(ytext, 'abbc', 'test');
    expect(ytext.toString()).toBe('abbc');
    const flat = deltas.flat();
    expect(flat).toEqual([{ retain: 2 }, { insert: 'b' }]);
  });

  it('TC-13b2 pure deletion in the middle: single delete, no insert', () => {
    const ytext = text('abcd');
    const deltas = observeDeltas(ytext);
    applyTextDiff(ytext, 'acd', 'test');
    expect(ytext.toString()).toBe('acd');
    const flat = deltas.flat();
    expect(flat).toEqual([{ retain: 1 }, { delete: 1 }]);
  });

  it('TC-13c replacement of a selection: delete + insert, prefix/suffix retained', () => {
    const ytext = text('the quick fox');
    const deltas = observeDeltas(ytext);
    applyTextDiff(ytext, 'the slow fox', 'test');
    expect(ytext.toString()).toBe('the slow fox');
    const flat = deltas.flat();
    // "the " retained, "quick"→"slow" (delete 5, insert 4), " fox" retained.
    expect(flat).toEqual([{ retain: 4 }, { delete: 5 }, { insert: 'slow' }]);
  });

  it('TC-13d emoji surrogate pairs stay intact (no split surrogates in the doc)', () => {
    const ytext = text('ab');
    const deltas = observeDeltas(ytext);
    applyTextDiff(ytext, 'a🎉b', 'test');
    expect(ytext.toString()).toBe('a🎉b');
    const flat = deltas.flat();
    // Pure insertion at index 1: the pair is kept whole, never split.
    expect(flat).toEqual([{ retain: 1 }, { insert: '🎉' }]);
    // No lone surrogates anywhere in the inserted text (valid UTF-16):
    // a round-trip through UTF-8 would replace lone surrogates with U+FFFD.
    expect(
      flat.every((d) => {
        const ins = d.insert ?? '';
        return ins.length === 0 || Buffer.from(ins, 'utf-8').toString('utf-8') === ins;
      }),
    ).toBe(true);
  });

  it('TC-13e no-op: applying the same text emits no operations', () => {
    const ytext = text(SHORT_PHRASE);
    const deltas = observeDeltas(ytext);
    applyTextDiff(ytext, SHORT_PHRASE, 'test');
    expect(ytext.toString()).toBe(SHORT_PHRASE);
    expect(deltas).toHaveLength(0);
  });

  it('TC-14 pasting 1,200 chars into an empty note keeps exactly 1,000', () => {
    const kept = clampToLimit(TWO_THOUSAND_CHARS_PARAGRAPH);
    expect(TWO_THOUSAND_CHARS_PARAGRAPH).toHaveLength(1200);
    expect(kept).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(kept).toBe(THOUSAND_CHAR_PARAGRAPH);
  });

  it('TC-15 999 chars + 1 → 1,000 accepted (boundary)', () => {
    const at999 = THOUSAND_CHAR_PARAGRAPH.slice(0, 999);
    expect(at999).toHaveLength(999);
    const kept = clampToLimit(at999 + 'x');
    expect(kept).toHaveLength(1000);
    expect(kept.endsWith('x')).toBe(true);
  });

  it('TC-16 1,000 chars + 1 → rejected, still 1,000 (negative boundary)', () => {
    const kept = clampToLimit(THOUSAND_CHAR_PARAGRAPH + 'x');
    expect(kept).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(kept).toBe(THOUSAND_CHAR_PARAGRAPH);
  });

  it('TC-17 counterVisible: 949 → false, 950 → true, 951 → true (threshold boundary)', () => {
    expect(counterVisible(STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS - 1)).toBe(false); // 949
    expect(counterVisible(STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS)).toBe(true); // 950
    expect(counterVisible(STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS + 1)).toBe(true); // 951
    expect(counterVisible(0)).toBe(false);
    expect(counterVisible(STICKY_TEXT_MAX_CHARS)).toBe(true);
  });
});
