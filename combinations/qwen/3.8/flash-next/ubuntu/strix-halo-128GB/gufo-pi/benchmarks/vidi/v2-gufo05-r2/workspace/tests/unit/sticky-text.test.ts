import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';

import { STICKY_COUNTER_THRESHOLD_CHARS, STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';
import { applyTextDiff, clampToLimit, counterVisible } from '../../src/client/objects/StickyText';
import {
  PROSE_1000,
  PROSE_1001,
  PROSE_1200,
  PROSE_949,
  PROSE_950,
  PROSE_951,
  PROSE_999,
} from '../fixtures/texts';

type DeltaOp = { insert?: string; delete?: number; retain?: number; attributes?: unknown };

/** Apply an edit and capture the single delta Y.Text emitted. */
function captureDelta(ytext: Y.Text, next: string): DeltaOp[] {
  let ops: DeltaOp[] = [];
  const observer = (event: Y.YTextEvent) => {
    ops = (event.delta as DeltaOp[]).slice();
  };
  ytext.observe(observer);
  applyTextDiff(ytext, next, null);
  ytext.unobserve(observer);
  return ops;
}

function newText(value: string): Y.Text {
  const doc = new Y.Doc();
  const ytext = doc.getText('note');
  if (value) ytext.insert(0, value);
  return ytext;
}

describe('sticky.text — applyTextDiff (minimal edits)', () => {
  it('TC-13: typing one character in the middle is a single insert, not replace-all', () => {
    const ytext = newText('abc');
    const ops = captureDelta(ytext, 'abXc');
    expect(ytext.toString()).toBe('abXc');
    // Exactly one insert of "X"; no deletes.
    const inserts = ops.filter((op) => op.insert !== undefined);
    const deletes = ops.filter((op) => op.delete !== undefined);
    expect(deletes).toHaveLength(0);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.insert).toBe('X');
    // It is positioned at index 2 (retain 2 before the insert).
    const firstRetain = ops.find((op) => op.retain !== undefined)?.retain;
    expect(firstRetain).toBe(2);
  });

  it('deleting a run in the middle is a single delete, not replace-all', () => {
    const ytext = newText('abcdef');
    const ops = captureDelta(ytext, 'abef');
    expect(ytext.toString()).toBe('abef');
    const inserts = ops.filter((op) => op.insert !== undefined);
    const deletes = ops.filter((op) => op.delete !== undefined);
    expect(inserts).toHaveLength(0);
    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.delete).toBe(2);
  });

  it('replacing a selection is one delete plus one insert', () => {
    const ytext = newText('hello world');
    const ops = captureDelta(ytext, 'hello there');
    expect(ytext.toString()).toBe('hello there');
    const inserts = ops.filter((op) => op.insert !== undefined);
    const deletes = ops.filter((op) => op.delete !== undefined);
    expect(inserts.length).toBeLessThanOrEqual(1);
    expect(deletes.length).toBeLessThanOrEqual(1);
  });

  it('no change emits no operations', () => {
    const ytext = newText('same text');
    const ops = captureDelta(ytext, 'same text');
    expect(ytext.toString()).toBe('same text');
    // Only retains (if any), no insert/delete.
    expect(ops.some((op) => op.insert !== undefined || op.delete !== undefined)).toBe(false);
  });

  it('surrogate pairs (emoji) stay intact when swapped', () => {
    const ytext = newText('a😀b');
    applyTextDiff(ytext, 'a😃b', null);
    const result = ytext.toString();
    expect(result).toBe('a😃b');
    // No lone surrogate left behind.
    for (let i = 0; i < result.length; i += 1) {
      const code = result.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = result.charCodeAt(i + 1);
        expect(next).toBeGreaterThanOrEqual(0xdc00);
        expect(next).toBeLessThanOrEqual(0xdfff);
      }
    }
  });

  it('appending to a long note is a single insert at the end', () => {
    const ytext = newText(PROSE_999);
    const ops = captureDelta(ytext, PROSE_999 + '!');
    expect(ytext.toString()).toBe(PROSE_999 + '!');
    expect(ops.filter((op) => op.delete !== undefined)).toHaveLength(0);
    const inserts = ops.filter((op) => op.insert !== undefined);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.insert).toBe('!');
  });
});

describe('sticky.text — clampToLimit', () => {
  it('TC-14: pasting 1,200 characters keeps exactly the first 1,000', () => {
    expect(PROSE_1200.length).toBe(1200);
    const clamped = clampToLimit('');
    expect(clamped).toBe('');
    const result = clampToLimit(PROSE_1200);
    expect(result.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(result).toBe(PROSE_1200.slice(0, STICKY_TEXT_MAX_CHARS));
    expect(result).toBe(PROSE_1000);
  });

  it('TC-15: 999 + 1 char is accepted (exactly 1,000)', () => {
    expect(PROSE_999.length).toBe(999);
    const result = clampToLimit(PROSE_999 + 'x');
    expect(result.length).toBe(1000);
    expect(result.endsWith('x')).toBe(true);
  });

  it('TC-16: 1,000 + 1 char is rejected beyond the limit (still 1,000)', () => {
    expect(PROSE_1001.length).toBe(1001);
    const result = clampToLimit(PROSE_1001);
    expect(result.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(result).toBe(PROSE_1000);
  });

  it('does not truncate text already within the limit', () => {
    expect(clampToLimit(PROSE_999)).toBe(PROSE_999);
  });
});

describe('sticky.text — counterVisible', () => {
  it('TC-17: appears at remaining 50 or fewer (949 / 950 / 951 → false / true / true)', () => {
    expect(STICKY_COUNTER_THRESHOLD_CHARS).toBe(50);
    expect(PROSE_949.length).toBe(949);
    expect(PROSE_950.length).toBe(950);
    expect(PROSE_951.length).toBe(951);
    expect(counterVisible(PROSE_949.length)).toBe(false); // 51 remaining
    expect(counterVisible(PROSE_950.length)).toBe(true); // 50 remaining
    expect(counterVisible(PROSE_951.length)).toBe(true); // 49 remaining
  });

  it('is false for short text and true at the limit', () => {
    expect(counterVisible(0)).toBe(false);
    expect(counterVisible(100)).toBe(false);
    expect(counterVisible(1000)).toBe(true);
  });
});
