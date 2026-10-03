import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { clampToLimit, applyTextDiff, counterVisible } from '../../src/client/objects/StickyText';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import { STICKY_TEXT_MAX_CHARS, STICKY_COUNTER_THRESHOLD_CHARS } from '../../src/shared/config';
import { LONG_PROSE, LONG_PASTE } from '../fixtures/texts';

/** A Y.Text attached to a (throwaway) Y.Doc, as required by yjs 13. */
function makeText(initial = ''): Y.Text {
  const doc = new Y.Doc();
  const text = doc.getText('text');
  if (initial) text.insert(0, initial);
  return text;
}

/** Records Y.Text delta events: an array of delta-chunk arrays. */
function watchDeltas(ytext: Y.Text): () => unknown[][] {
  const deltas: unknown[][] = [];
  ytext.observe((event) => {
    deltas.push(event.delta as unknown[]);
  });
  return () => deltas;
}

describe('sticky.text (unit, real Y.Text)', () => {
  it('TC-13: applyTextDiff abc → abXc is a single insert of X at 2 (not delete+insert all)', () => {
    const ytext = makeText('abc');
    const getDeltas = watchDeltas(ytext);

    applyTextDiff(ytext, 'abXc', LOCAL_ORIGIN);

    expect(ytext.toString()).toBe('abXc');
    const deltas = getDeltas();
    expect(deltas).toHaveLength(1);
    // One minimal op: retain the "ab" prefix, insert "X". No delete, no full replace.
    expect(deltas[0]).toEqual([{ retain: 2 }, { insert: 'X' }]);
  });

  it('TC-13b: pure deletion in the middle is a single delete chunk', () => {
    const ytext = makeText('abcdef');
    const getDeltas = watchDeltas(ytext);

    applyTextDiff(ytext, 'acdef', LOCAL_ORIGIN);

    expect(ytext.toString()).toBe('acdef');
    const deltas = getDeltas();
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toEqual([{ retain: 1 }, { delete: 1 }]);
  });

  it('TC-13c: replacement of a selection is one delete and one insert, minimally', () => {
    const ytext = makeText('hello world');
    const getDeltas = watchDeltas(ytext);

    applyTextDiff(ytext, 'hello there', LOCAL_ORIGIN);

    expect(ytext.toString()).toBe('hello there');
    const deltas = getDeltas();
    expect(deltas).toHaveLength(1);
    // "world" (5) replaced by "there" (5) after the "hello " prefix; nothing else touched
    expect(deltas[0]).toEqual([{ retain: 6 }, { delete: 5 }, { insert: 'there' }]);
  });

  it('TC-13d: emoji surrogate pairs are kept intact', () => {
    const ytext = makeText('a🎉b');
    const getDeltas = watchDeltas(ytext);

    applyTextDiff(ytext, 'a🎉c', LOCAL_ORIGIN);

    expect(ytext.toString()).toBe('a🎉c');
    expect(ytext.toString().includes('🎉')).toBe(true);
    const deltas = getDeltas();
    expect(deltas).toHaveLength(1);
    // The "a🎉" prefix (3 UTF-16 code units) is retained whole: the surrogate
    // pair is never split. Only the final "b" is replaced.
    expect(deltas[0]).toEqual([{ retain: 3 }, { delete: 1 }, { insert: 'c' }]);
  });

  it('TC-13e: no change → no delta events, no transaction', () => {
    const ytext = makeText('abc');
    const getDeltas = watchDeltas(ytext);

    applyTextDiff(ytext, 'abc', LOCAL_ORIGIN);

    expect(getDeltas()).toHaveLength(0);
  });

  it('TC-14: paste of 1,200 chars into empty → 1,000 (STICKY_TEXT_MAX_CHARS) kept', () => {
    expect(LONG_PASTE.length).toBe(1200);
    const clamped = clampToLimit(LONG_PASTE);
    expect(clamped.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(clamped).toBe(LONG_PROSE);
  });

  it('TC-15: 999 chars + 1 char → 1,000 accepted (boundary)', () => {
    const at999 = LONG_PROSE.slice(0, 999);
    expect(at999.length).toBe(999);
    const clamped = clampToLimit(at999 + 'x');
    expect(clamped.length).toBe(1000);
    expect(clamped).toBe(at999 + 'x');
  });

  it('TC-16: 1,000 chars + 1 char → rejected, still 1,000 (negative/boundary)', () => {
    const clamped = clampToLimit(LONG_PROSE + 'x');
    expect(clamped.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(clamped).toBe(LONG_PROSE);
  });

  it('TC-17: counterVisible at 949 / 950 / 951 chars → false / true / true', () => {
    // remaining = 1000 - len; threshold = 50
    expect(STICKY_TEXT_MAX_CHARS - 950).toBe(STICKY_COUNTER_THRESHOLD_CHARS);
    expect(counterVisible(949)).toBe(false); // 51 remaining
    expect(counterVisible(950)).toBe(true); // 50 remaining
    expect(counterVisible(951)).toBe(true); // 49 remaining
    // Ends of the range
    expect(counterVisible(0)).toBe(false);
    expect(counterVisible(STICKY_TEXT_MAX_CHARS)).toBe(true); // 0 remaining
  });
});
