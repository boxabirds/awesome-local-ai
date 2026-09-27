// Unit tests for the pure sticky-text logic (sticky.text, TC-13 to TC-17).

import * as Y from 'yjs';
import type { YTextEvent } from 'yjs';
import { describe, expect, it } from 'vitest';
import {
  applyTextDiff,
  clampToLimit,
  counterVisible,
} from '../../src/client/objects/StickyText';
import { STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';
import { PROSE_1000, PROSE_1200, proseOfLength } from '../fixtures/texts';

/** A Y.Text bound to a fresh document (yjs requires a bound type to write). */
function newBoundText(initial = ''): Y.Text {
  const doc = new Y.Doc();
  const ytext = doc.getText('text');
  if (initial) ytext.insert(0, initial);
  return ytext;
}

type DeltaOp = { retain?: number; insert?: string; delete?: number };

/** Delta ops with retain markers stripped (retains only mark positions). */
function stripRetains(delta: DeltaOp[]): DeltaOp[] {
  return delta.filter((o) => o.retain === undefined);
}

/** Records the delta ops Y.Text received (TextEvent.delta). */
function deltaSpy(ytext: Y.Text) {
  const ops: DeltaOp[][] = [];
  const handler = (e: YTextEvent): void => {
    ops.push(e.delta as DeltaOp[]);
  };
  ytext.observe(handler);
  return {
    ops,
    off: () => ytext.unobserve(handler),
  };
}

describe('sticky.text', () => {
  it('TC-13: applyTextDiff "abc" → "abXc" is a single insert of "X" at 2 (not delete+insert-all)', () => {
    const ytext = newBoundText('abc');
    const spy = deltaSpy(ytext);

    applyTextDiff(ytext, 'abXc', 'origin');

    expect(ytext.toString()).toBe('abXc');
    expect(spy.ops).toHaveLength(1);
    // Exactly one insert op of 'X', retained position 2 — no delete anywhere.
    const delta = spy.ops[0];
    expect(delta).toEqual([{ retain: 2 }, { insert: 'X' }]);
    expect(stripRetains(delta)).toEqual([{ insert: 'X' }]);
    spy.off();
  });

  it('TC-13 (extra): pure deletion in the middle is a single delete op', () => {
    const ytext = newBoundText('abcde');
    const spy = deltaSpy(ytext);

    applyTextDiff(ytext, 'acde', 'origin');

    expect(ytext.toString()).toBe('acde');
    const delta = spy.ops[0];
    expect(spy.ops).toHaveLength(1);
    expect(delta).toEqual([{ retain: 1 }, { delete: 1 }]);
    spy.off();
  });

  it('TC-13 (extra): replacement of a selection region is one delete + one insert', () => {
    const ytext = newBoundText('abcd');
    const spy = deltaSpy(ytext);

    // The selected 'b' is replaced by 'XY' -> 'aXYcd'.
    applyTextDiff(ytext, 'aXYcd', 'origin');

    expect(ytext.toString()).toBe('aXYcd');
    const delta = spy.ops[0];
    expect(delta).toEqual([{ retain: 1 }, { delete: 1 }, { insert: 'XY' }]);
    spy.off();
  });

  it('TC-13 (extra): emoji surrogate pairs are kept intact', () => {
    const ytext = newBoundText('a😀');
    const spy = deltaSpy(ytext);

    applyTextDiff(ytext, 'a😁', 'origin');

    expect(ytext.toString()).toBe('a😁');
    // No lone surrogates may survive: the result must be valid UTF-16 text
    // with exactly one emoji code point.
    expect([...ytext.toString()]).toHaveLength(2);
    expect([...ytext.toString()][1].codePointAt(0)).toBe(0x1f601);
    spy.off();
  });

  it('TC-13 (extra): equal values produce no delta at all', () => {
    const ytext = newBoundText(PROSE_1000);
    const spy = deltaSpy(ytext);

    applyTextDiff(ytext, PROSE_1000, 'origin');

    expect(spy.ops).toHaveLength(0);
    spy.off();
  });

  it('TC-14: clamping a 1,200-char paste keeps exactly the first 1,000', () => {
    expect(PROSE_1200).toHaveLength(1200);
    const kept = clampToLimit(PROSE_1200);
    expect(kept).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(kept).toBe(PROSE_1000);
  });

  it('TC-15: 999 + 1 → 1,000 accepted (boundary)', () => {
    const base = proseOfLength(999);
    const next = base + PROSE_1000[999]; // the 1000th character
    expect(next).toHaveLength(1000);
    expect(clampToLimit(next)).toBe(next);
  });

  it('TC-16 (negative): 1,000 + 1 → rejected, still 1,000', () => {
    const next = PROSE_1000 + 'x';
    expect(next).toHaveLength(1001);
    expect(clampToLimit(next)).toBe(PROSE_1000);
  });

  it('TC-17: counterVisible at 949 / 950 / 951 chars → false / true / true', () => {
    expect(counterVisible(949)).toBe(false); // 51 remaining
    expect(counterVisible(950)).toBe(true); // 50 remaining (threshold)
    expect(counterVisible(951)).toBe(true); // 49 remaining
    // Ends of the range.
    expect(counterVisible(0)).toBe(false);
    expect(counterVisible(STICKY_TEXT_MAX_CHARS)).toBe(true);
  });
});
