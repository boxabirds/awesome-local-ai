import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_TEXT_MAX_CHARS,
} from '../../src/shared/config';
import {
  applyTextDiff,
  clampToLimit,
  counterVisible,
} from '../../src/client/objects/StickyText';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import { PROSE_1000, PROSE_1200, RETRO_ITEM, SHORT_NOTE } from '../fixtures/texts';

type DeltaOp = { retain?: number; insert?: string; delete?: number };

/** The note text, attached to a real document exactly as the board stores it. */
function attached(initial = ''): { doc: Y.Doc; ytext: Y.Text } {
  const doc = new Y.Doc();
  const ytext = doc.getText('text');
  if (initial.length > 0) doc.transact(() => ytext.insert(0, initial), LOCAL_ORIGIN);
  return { doc, ytext };
}

/** The `Y.Text` delta events a change produced, flattened into operations. */
function deltasOf(ytext: Y.Text, change: () => void): DeltaOp[][] {
  const deltas: DeltaOp[][] = [];
  const observer = (event: Y.YTextEvent): void => {
    deltas.push(event.delta as DeltaOp[]);
  };
  ytext.observe(observer);
  change();
  ytext.unobserve(observer);
  return deltas;
}

function flatten(deltas: DeltaOp[][]): DeltaOp[] {
  return deltas.flat();
}

describe('fixtures', () => {
  it('are exactly the documented lengths and read like English', () => {
    expect(PROSE_1000).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(PROSE_1200).toHaveLength(1200);
    expect(PROSE_1200.startsWith(PROSE_1000)).toBe(true);
    expect(PROSE_1000.split(' ').length).toBeGreaterThan(100);
    expect(RETRO_ITEM.split('\n')).toHaveLength(3);
    expect(RETRO_ITEM.length).toBeGreaterThan(100);
    expect(RETRO_ITEM.length).toBeLessThan(130);
  });
});

describe('applyTextDiff (TC-13)', () => {
  it('TC-13: turning abc into abXc is a single insert of X at index 2', () => {
    const { ytext } = attached('abc');
    const deltas = deltasOf(ytext, () => applyTextDiff(ytext, 'abXc', LOCAL_ORIGIN));

    expect(deltas).toHaveLength(1);
    const ops = flatten(deltas);
    // Not delete-all + insert-all: that would destroy a concurrent typist (story 3).
    expect(ops.filter((op) => op.delete !== undefined)).toHaveLength(0);
    expect(ops.filter((op) => op.insert !== undefined)).toEqual([{ insert: 'X' }]);
    const retainedBefore = ops
      .slice(0, ops.findIndex((op) => op.insert !== undefined))
      .reduce((total, op) => total + (op.retain ?? 0), 0);
    expect(retainedBefore).toBe(2);
    expect(ytext.toString()).toBe('abXc');
  });

  it('a deletion in the middle is a single delete, with no insert', () => {
    const { ytext } = attached('abcde');
    const deltas = deltasOf(ytext, () => applyTextDiff(ytext, 'abde', LOCAL_ORIGIN));
    const ops = flatten(deltas);
    expect(ops.filter((op) => op.insert !== undefined)).toHaveLength(0);
    expect(ops.filter((op) => op.delete !== undefined)).toEqual([{ delete: 1 }]);
    expect(ytext.toString()).toBe('abde');
  });

  it('replacing a selection is one delete and one insert', () => {
    const { ytext } = attached('the quick brown fox');
    const deltas = deltasOf(ytext, () =>
      applyTextDiff(ytext, 'the quick red fox', LOCAL_ORIGIN),
    );
    const ops = flatten(deltas);
    expect(ops.filter((op) => op.insert !== undefined)).toEqual([{ insert: 'red' }]);
    expect(ops.filter((op) => op.delete !== undefined)).toEqual([{ delete: 5 }]);
    expect(ytext.toString()).toBe('the quick red fox');
  });

  it('a multi-line note keeps its newlines', () => {
    const { ytext } = attached('');
    applyTextDiff(ytext, RETRO_ITEM, LOCAL_ORIGIN);
    expect(ytext.toString()).toBe(RETRO_ITEM);
    applyTextDiff(ytext, `${RETRO_ITEM}\nShip it`, LOCAL_ORIGIN);
    expect(ytext.toString()).toBe(`${RETRO_ITEM}\nShip it`);
    expect(ytext.toString().split('\n')).toHaveLength(4);
  });

  it('surrogate pairs are inserted and removed whole, never split', () => {
    const { ytext } = attached('ship 🚀 away');
    const deltas = deltasOf(ytext, () =>
      applyTextDiff(ytext, 'ship 🚀🚀 away', LOCAL_ORIGIN),
    );
    const ops = flatten(deltas);
    expect(ops.filter((op) => op.insert !== undefined)).toEqual([{ insert: '🚀' }]);
    expect(ops.filter((op) => op.delete !== undefined)).toHaveLength(0);
    expect(ytext.toString()).toBe('ship 🚀🚀 away');

    // Replacing an emoji deletes both of its code units, not half a character.
    const { ytext: other } = attached('a😀b');
    const replace = deltasOf(other, () => applyTextDiff(other, 'aXb', LOCAL_ORIGIN));
    const deleteOps = flatten(replace).filter((op) => op.delete !== undefined);
    expect(deleteOps).toEqual([{ delete: 2 }]);
    expect(other.toString()).toBe('aXb');
    expect(other.toString()).not.toContain('\uFFFD');
  });

  it('an unchanged value writes nothing', () => {
    const { doc, ytext } = attached(SHORT_NOTE);
    let updates = 0;
    const listener = (): void => {
      updates += 1;
    };
    doc.on('update', listener);
    applyTextDiff(ytext, SHORT_NOTE, LOCAL_ORIGIN);
    doc.off('update', listener);
    expect(updates).toBe(0);
  });

  it('leaves text the client did not touch alone (concurrent typing, story 3)', () => {
    const { doc, ytext } = attached('');
    doc.transact(() => ytext.insert(0, 'Faster onboarding'), LOCAL_ORIGIN);
    // Another client appended while we were typing in front.
    applyTextDiff(ytext, 'Fast onboarding', LOCAL_ORIGIN);
    expect(ytext.toString()).toBe('Fast onboarding');
  });
});

describe('clampToLimit (TC-14, TC-15, TC-16)', () => {
  it('TC-14: pasting 1,200 characters into an empty note keeps exactly the first 1,000', () => {
    expect(STICKY_TEXT_MAX_CHARS).toBe(1000);
    const clamped = clampToLimit(PROSE_1200);
    expect(clamped).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(clamped).toBe(PROSE_1000);

    const { ytext } = attached('');
    applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
    expect(ytext.toString()).toBe(PROSE_1000);
    expect(ytext.toString()).toHaveLength(STICKY_TEXT_MAX_CHARS);
  });

  it('TC-15: 999 characters plus one is accepted (boundary)', () => {
    const at999 = PROSE_1000.slice(0, STICKY_TEXT_MAX_CHARS - 1);
    expect(at999).toHaveLength(999);
    const next = clampToLimit(`${at999}!`);
    expect(next).toHaveLength(STICKY_TEXT_MAX_CHARS);
    const { ytext } = attached(at999);
    applyTextDiff(ytext, next, LOCAL_ORIGIN);
    expect(ytext.toString()).toHaveLength(STICKY_TEXT_MAX_CHARS);
  });

  it('TC-16: one character past 1,000 is rejected and the note does not grow', () => {
    const { doc, ytext } = attached(PROSE_1000);
    let updates = 0;
    const listener = (): void => {
      updates += 1;
    };
    doc.on('update', listener);
    const next = clampToLimit(`${PROSE_1000}!`);
    expect(next).toHaveLength(STICKY_TEXT_MAX_CHARS);
    applyTextDiff(ytext, next, LOCAL_ORIGIN);
    doc.off('update', listener);
    expect(ytext.toString()).toBe(PROSE_1000);
    expect(ytext.toString()).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(updates).toBe(0);
  });

  it('leaves anything at or under the limit untouched, and honours a custom max', () => {
    expect(clampToLimit('')).toBe('');
    expect(clampToLimit(SHORT_NOTE)).toBe(SHORT_NOTE);
    expect(clampToLimit(PROSE_1000)).toBe(PROSE_1000);
    expect(clampToLimit('abcdef', 3)).toBe('abc');
  });
});

describe('counterVisible (TC-17)', () => {
  it('TC-17: appears at 950 characters and stays visible to the limit', () => {
    expect(STICKY_COUNTER_THRESHOLD_CHARS).toBe(50);
    // 51, 50 and 49 characters left.
    expect(counterVisible(949)).toBe(false);
    expect(counterVisible(950)).toBe(true);
    expect(counterVisible(951)).toBe(true);
    expect(counterVisible(STICKY_TEXT_MAX_CHARS)).toBe(true);
  });

  it('is hidden for a fresh or short note', () => {
    expect(counterVisible(0)).toBe(false);
    expect(counterVisible(SHORT_NOTE.length)).toBe(false);
    expect(counterVisible(1)).toBe(false);
  });
});
