/**
 * sticky.text unit tests (TC-13 .. TC-17): the pure text logic — minimal
 * Y.Text diff, length clamp and counter rule — against a real Y.Doc.
 *
 * TC-13 observes the Y.Text delta events: story 3 relies on the diff being
 * minimal (a single insert for a single character typed), because a
 * delete-all + insert-all would destroy what another user is typing.
 */

import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';

import { STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';
import { applyTextDiff, clampToLimit, counterVisible } from '../../src/client/objects/StickyText';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import { PROSE_1000, PROSE_1200 } from '../fixtures/texts';

/** The shape of a Y.Text delta: the retain/insert/delete ops of one change. */
interface DeltaOp {
  readonly retain?: number;
  readonly insert?: string;
  readonly delete?: number;
}

/** A doc-backed Y.Text seeded with `initial`, plus its recorded deltas. */
function seededText(initial: string): {
  doc: Y.Doc;
  ytext: Y.Text;
  deltas: DeltaOp[][];
  updates: { origin: unknown }[];
} {
  const doc = new Y.Doc();
  const ytext = doc.getText('note');
  const deltas: DeltaOp[][] = [];
  const updates: { origin: unknown }[] = [];
  ytext.observe((event) => {
    deltas.push(
      event.delta.map((op) => ({
        retain: 'retain' in op ? op.retain : undefined,
        insert: 'insert' in op ? (op.insert as string) : undefined,
        delete: 'delete' in op ? op.delete : undefined,
      })),
    );
  });
  doc.on('update', (_update: Uint8Array, origin: unknown) => updates.push({ origin }));
  if (initial.length > 0) ytext.insert(0, initial);
  deltas.length = 0;
  updates.length = 0;
  return { doc, ytext, deltas, updates };
}

describe('applyTextDiff', () => {
  it('TC-13: a single inserted character is a single insert at that index', () => {
    const { ytext, deltas, updates } = seededText('abc');
    applyTextDiff(ytext, 'abXc', LOCAL_ORIGIN);
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toEqual([{ retain: 2 }, { insert: 'X' }]);
    expect(ytext.toString()).toBe('abXc');
    expect(updates).toHaveLength(1);
    expect(updates[0]!.origin).toBe(LOCAL_ORIGIN);
  });

  it('TC-13: a deletion in the middle is a single delete', () => {
    const { ytext, deltas } = seededText('abXc');
    applyTextDiff(ytext, 'abc', LOCAL_ORIGIN);
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toEqual([{ retain: 2 }, { delete: 1 }]);
    expect(ytext.toString()).toBe('abc');
  });

  it('TC-13: replacing a selection is one delete and one insert', () => {
    const { ytext, deltas } = seededText('abc');
    applyTextDiff(ytext, 'aXc', LOCAL_ORIGIN);
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toEqual([{ retain: 1 }, { delete: 1 }, { insert: 'X' }]);
    expect(ytext.toString()).toBe('aXc');
  });

  it('TC-13: no change writes nothing (no delta, no update)', () => {
    const { ytext, deltas, updates } = seededText('abc');
    applyTextDiff(ytext, 'abc', LOCAL_ORIGIN);
    expect(deltas).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it('TC-13: typing next to an emoji inserts past the whole surrogate pair', () => {
    const { ytext, deltas } = seededText('a😀b');
    applyTextDiff(ytext, 'a😀b!', LOCAL_ORIGIN);
    // Code units: 'a' + 2 for the emoji + 'b', so the insert is at index 4;
    // the pair is never cut in half.
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toEqual([{ retain: 4 }, { insert: '!' }]);
    expect(ytext.toString()).toBe('a😀b!');
  });

  it('TC-13: swapping one emoji for another replaces whole pairs, never halves', () => {
    // 👍 and 👎 share their high surrogate, so a naive diff boundary would
    // fall between the two halves; the diff must back up to the pair start.
    const { ytext, deltas } = seededText('a👍');
    applyTextDiff(ytext, 'a👎', LOCAL_ORIGIN);
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toEqual([{ retain: 1 }, { delete: 2 }, { insert: '👎' }]);
    expect(ytext.toString()).toBe('a👎');
  });

  it('TC-13: replacing an emoji deletes and inserts whole surrogate pairs', () => {
    const { ytext, deltas } = seededText('a😀b');
    applyTextDiff(ytext, 'aXb', LOCAL_ORIGIN);
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toEqual([{ retain: 1 }, { delete: 2 }, { insert: 'X' }]);
    expect(ytext.toString()).toBe('aXb');
  });

  it('TC-15: the 1,000th character is written (boundary)', () => {
    const base = clampToLimit(PROSE_1000.slice(0, STICKY_TEXT_MAX_CHARS - 1));
    expect(base).toHaveLength(STICKY_TEXT_MAX_CHARS - 1);
    const { ytext } = seededText(base);
    const next = clampToLimit(`${base}x`);
    expect(next).toHaveLength(STICKY_TEXT_MAX_CHARS);
    applyTextDiff(ytext, next, LOCAL_ORIGIN);
    expect(ytext.toString()).toHaveLength(STICKY_TEXT_MAX_CHARS);
  });

  it('TC-16: text beyond 1,000 characters never reaches the Y.Text (negative)', () => {
    const { ytext, updates } = seededText(PROSE_1000);
    const next = clampToLimit(`${PROSE_1000}x`);
    expect(next).toBe(PROSE_1000); // clamped back to exactly 1,000
    applyTextDiff(ytext, next, LOCAL_ORIGIN);
    expect(ytext.toString()).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(updates).toHaveLength(0); // no-op: nothing was written
  });
});

describe('clampToLimit', () => {
  it('TC-14: a 1,200 character paste keeps exactly the first 1,000', () => {
    expect(PROSE_1200).toHaveLength(1200);
    const clamped = clampToLimit(PROSE_1200);
    expect(clamped).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(clamped).toBe(PROSE_1200.slice(0, STICKY_TEXT_MAX_CHARS));
  });

  it('TC-15: 999 + 1 is accepted in full (boundary)', () => {
    const text = clampToLimit(PROSE_1000.slice(0, STICKY_TEXT_MAX_CHARS - 1)) + '!';
    expect(text).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(clampToLimit(text)).toBe(text);
  });

  it('TC-16: 1,000 + 1 is cut back to 1,000 (negative/boundary)', () => {
    const over = `${PROSE_1000}oops`;
    const clamped = clampToLimit(over);
    expect(clamped).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(clamped).toBe(PROSE_1000);
  });

  it('leaves anything up to the limit untouched', () => {
    expect(clampToLimit('')).toBe('');
    expect(clampToLimit('a')).toBe('a');
    expect(clampToLimit(PROSE_1000)).toBe(PROSE_1000);
  });

  it('honours an explicit max (used by tests, defaults to the product limit)', () => {
    expect(clampToLimit('abcdef', 3)).toBe('abc');
  });
});

describe('counterVisible', () => {
  // TC-17: remaining characters 51 / 50 / 49 → false / true / true.
  it('TC-17: shows at the threshold boundary and hides above it', () => {
    expect(counterVisible(949)).toBe(false);
    expect(counterVisible(950)).toBe(true);
    expect(counterVisible(951)).toBe(true);
  });

  it('is hidden for short notes and shown at the limit', () => {
    expect(counterVisible(0)).toBe(false);
    expect(counterVisible(STICKY_TEXT_MAX_CHARS)).toBe(true);
  });
});
