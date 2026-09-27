import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { YTextEvent } from 'yjs';

import {
  applyTextDiff,
  clampToLimit,
  counterVisible,
} from '../../src/client/objects/StickyText';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import { STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';
import { SHORT_TEXT, THOUSAND_TEXT } from '../fixtures/texts';

/** A live Y.Text attached to a doc (Y.Text only reads/writes when integrated). */
function attach(initial = ''): { doc: Y.Doc; ytext: Y.Text } {
  const doc = new Y.Doc();
  const ytext = new Y.Text(initial);
  doc.getMap('objects').set('t', ytext);
  return { doc, ytext };
}

interface Op {
  insert?: string | object;
  delete?: number;
  retain?: number;
}

/** Run `run` and collect the delta of every transaction the ytext observed. */
function captureDeltas(ytext: Y.Text, run: () => void): Op[][] {
  const deltas: Op[][] = [];
  const handler = (event: YTextEvent) => deltas.push(event.delta as Op[]);
  ytext.observe(handler);
  try {
    run();
  } finally {
    ytext.unobserve(handler);
  }
  return deltas;
}

function summarise(ops: Op[]): { inserts: string; deletes: number; insertOps: number; deleteOps: number } {
  let inserts = '';
  let deletes = 0;
  let insertOps = 0;
  let deleteOps = 0;
  for (const op of ops) {
    if (typeof op.insert === 'string') {
      inserts += op.insert;
      insertOps += 1;
    }
    if (op.delete !== undefined) {
      deletes += op.delete;
      deleteOps += 1;
    }
  }
  return { inserts, deletes, insertOps, deleteOps };
}

describe('sticky.text — applyTextDiff', () => {
  it('TC-13 emits a single insert, not delete-all + insert-all', () => {
    const { ytext } = attach('abc');
    const deltas = captureDeltas(ytext, () => applyTextDiff(ytext, 'abXc', LOCAL_ORIGIN));

    expect(ytext.toString()).toBe('abXc');
    expect(deltas).toHaveLength(1);
    const s = summarise(deltas[0]);
    // Exactly one inserted run, no deletions at all.
    expect(s.inserts).toBe('X');
    expect(s.insertOps).toBe(1);
    expect(s.deletes).toBe(0);
    // And it is retained to the exact index (a retain of 2 before the insert).
    const firstRetain = deltas[0][0]?.retain;
    expect(firstRetain).toBe(2);
  });

  it('a pure deletion in the middle emits a single delete and no insert', () => {
    const { ytext } = attach('abcd');
    const deltas = captureDeltas(ytext, () => applyTextDiff(ytext, 'acd', LOCAL_ORIGIN));
    expect(ytext.toString()).toBe('acd');
    const s = summarise(deltas[0]);
    expect(s.deletes).toBe(1);
    expect(s.deleteOps).toBe(1);
    expect(s.inserts).toBe('');
    expect(s.insertOps).toBe(0);
  });

  it('replacing a selection emits at most one delete and one insert', () => {
    const { ytext } = attach('hello world');
    const deltas = captureDeltas(ytext, () => applyTextDiff(ytext, 'hello there', LOCAL_ORIGIN));
    expect(ytext.toString()).toBe('hello there');
    const s = summarise(deltas[0]);
    expect(s.deleteOps).toBeLessThanOrEqual(1);
    expect(s.insertOps).toBeLessThanOrEqual(1);
    expect(s.deletes).toBe(5); // only "world" is removed, not the whole text
    expect(s.inserts).toBe('there');
  });

  it('keeps emoji surrogate pairs intact', () => {
    const { ytext } = attach('a😀b');
    applyTextDiff(ytext, 'a😀bc', LOCAL_ORIGIN);
    expect(ytext.toString()).toBe('a😀bc');
    // Round-trips as valid UTF-16 (no lone surrogate at the join).
    expect([...ytext.toString()]).toEqual(['a', '😀', 'b', 'c']);
  });

  it('appends realistic prose with one insert op', () => {
    const { ytext } = attach('');
    const deltas = captureDeltas(ytext, () => applyTextDiff(ytext, SHORT_TEXT, LOCAL_ORIGIN));
    expect(ytext.toString()).toBe(SHORT_TEXT);
    const s = summarise(deltas[0]);
    expect(s.inserts).toBe(SHORT_TEXT);
    expect(s.insertOps).toBe(1);
    expect(s.deletes).toBe(0);
  });

  it('is a no-op (no update) when the text is unchanged', () => {
    const { doc, ytext } = attach('same');
    let updates = 0;
    doc.on('update', () => (updates += 1));
    applyTextDiff(ytext, 'same', LOCAL_ORIGIN);
    expect(updates).toBe(0);
  });

  it('writes inside a single LOCAL_ORIGIN transaction', () => {
    const { doc, ytext } = attach('x');
    const origins: unknown[] = [];
    doc.on('update', (_u: Uint8Array, origin: unknown) => origins.push(origin));
    applyTextDiff(ytext, 'xyz', LOCAL_ORIGIN);
    expect(origins).toEqual([LOCAL_ORIGIN]);
  });
});

describe('sticky.text — clampToLimit', () => {
  it('TC-14 cuts a 1,200 character paste down to exactly 1,000', () => {
    const pasted = THOUSAND_TEXT + ' and a great deal more text than the note can hold at once.';
    expect(pasted.length).toBeGreaterThan(STICKY_TEXT_MAX_CHARS);
    const clamped = clampToLimit(pasted);
    expect(clamped).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(clamped).toBe(THOUSAND_TEXT); // the first 1,000 characters survive
  });

  it('TC-15 accepts one more character up to the limit (999 -> 1,000)', () => {
    const near = THOUSAND_TEXT.slice(0, STICKY_TEXT_MAX_CHARS - 1);
    expect(near).toHaveLength(STICKY_TEXT_MAX_CHARS - 1);
    const result = clampToLimit(`${near}z`);
    expect(result).toHaveLength(STICKY_TEXT_MAX_CHARS);
  });

  it('TC-16 rejects one character over the limit (1,000 -> 1,000)', () => {
    const result = clampToLimit(`${THOUSAND_TEXT}z`);
    expect(result).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(result).toBe(THOUSAND_TEXT);
  });

  it('leaves short text untouched', () => {
    expect(clampToLimit(SHORT_TEXT)).toBe(SHORT_TEXT);
    expect(clampToLimit('')).toBe('');
  });

  it('never leaves a lone surrogate pair at the cut', () => {
    // 999 code units then a two-unit emoji: cutting at 1,000 would split the pair.
    const input = `${'a'.repeat(STICKY_TEXT_MAX_CHARS - 1)}😀`;
    const clamped = clampToLimit(input);
    expect(clamped.length).toBeLessThanOrEqual(STICKY_TEXT_MAX_CHARS);
    // The final code unit is not a dangling high surrogate.
    expect(/[\uD800-\uDBFF]$/.test(clamped)).toBe(false);
  });

  it('honours an explicit max argument', () => {
    expect(clampToLimit('abcdef', 3)).toBe('abc');
  });
});

describe('sticky.text — counterVisible', () => {
  it('TC-17 boundary at 949 / 950 / 951 (remaining 51 / 50 / 49)', () => {
    expect(counterVisible(949)).toBe(false);
    expect(counterVisible(950)).toBe(true);
    expect(counterVisible(951)).toBe(true);
  });

  it('is hidden for short text and visible at the limit', () => {
    expect(counterVisible(0)).toBe(false);
    expect(counterVisible(SHORT_TEXT.length)).toBe(false);
    expect(counterVisible(STICKY_TEXT_MAX_CHARS)).toBe(true);
  });
});
