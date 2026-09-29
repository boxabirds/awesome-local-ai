import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { clampToLimit, applyTextDiff, counterVisible } from '@/client/objects/StickyText';
import { LOCAL_ORIGIN } from '@/shared/board-model';
import { LONG_PROSE } from '../fixtures/texts';

/**
 * Y.Text must be attached to a Y.Doc before it can be read or mutated, so
 * every test works against a real, attached Y.Text inside a real Y.Doc.
 */
function makeText(initial = ''): Y.Text {
  const doc = new Y.Doc();
  const text = new Y.Text();
  doc.getMap('t').set('text', text);
  if (initial) {
    doc.transact(() => text.insert(0, initial), LOCAL_ORIGIN);
  }
  return text;
}

type DeltaOp = { retain?: number; insert?: string; delete?: number };

/**
 * Captures the Quill-format delta ops emitted by a mutation via observe.
 * A full replace (delete-all + insert-all) would show up as a big delete
 * followed by a big insert; the minimal diff must not.
 */
function captureDelta(text: Y.Text, mutate: () => void): DeltaOp[] {
  const ops: DeltaOp[] = [];
  const handler = (evt: Y.YTextEvent) => {
    for (const op of evt.delta) {
      ops.push({
        retain: typeof op.retain === 'number' ? op.retain : undefined,
        insert: typeof op.insert === 'string' ? op.insert : undefined,
        delete: op.delete,
      });
    }
  };
  text.observe(handler);
  try {
    mutate();
  } finally {
    text.unobserve(handler);
  }
  return ops;
}

describe('sticky.text (unit)', () => {
  it('TC-13a: inserting inside a word produces a single insert at the right position', () => {
    const text = makeText('abc');
    const ops = captureDelta(text, () => applyTextDiff(text, 'abXc', LOCAL_ORIGIN));
    expect(ops).toEqual([{ retain: 2 }, { insert: 'X' }]);
    expect(text.toString()).toBe('abXc');
  });

  it('TC-13b: deleting in the middle produces a single delete (no replace-all)', () => {
    const text = makeText('hello world');
    const ops = captureDelta(text, () => applyTextDiff(text, 'helloworld', LOCAL_ORIGIN));
    expect(ops).toEqual([{ retain: 5 }, { delete: 1 }]);
    expect(text.toString()).toBe('helloworld');
  });

  it('TC-13c: replacing a selection is one delete + one insert of the selection only', () => {
    const text = makeText('the quick brown fox');
    const ops = captureDelta(text, () => applyTextDiff(text, 'the fast brown fox', LOCAL_ORIGIN));
    expect(ops).toEqual([{ retain: 4 }, { delete: 5 }, { insert: 'fast' }]);
    expect(text.toString()).toBe('the fast brown fox');
  });

  it('TC-13d: emoji surrogate pairs stay intact across insert and delete', () => {
    const text = makeText('a🎉b');
    let ops = captureDelta(text, () => applyTextDiff(text, 'a🎉🎉b', LOCAL_ORIGIN));
    expect(ops).toEqual([{ retain: 3 }, { insert: '🎉' }]);
    expect(text.toString()).toBe('a🎉🎉b');

    ops = captureDelta(text, () => applyTextDiff(text, 'ab', LOCAL_ORIGIN));
    expect(ops).toEqual([{ retain: 1 }, { delete: 4 }]);
    expect(text.toString()).toBe('ab');
  });

  it('TC-13e: identical text is a no-op (zero ops)', () => {
    const text = makeText('same');
    const ops = captureDelta(text, () => applyTextDiff(text, 'same', LOCAL_ORIGIN));
    expect(ops).toHaveLength(0);
  });

  it('TC-14: pasting 1,200 chars into an empty note keeps exactly 1,000', () => {
    const pasted = LONG_PROSE + ' ' + LONG_PROSE.slice(0, 199);
    expect(pasted.length).toBe(1200);
    const clamped = clampToLimit(pasted);
    expect(clamped.length).toBe(1000);
    expect(clamped).toBe(LONG_PROSE);
    const text = makeText('');
    applyTextDiff(text, clamped, LOCAL_ORIGIN);
    expect(text.toString()).toBe(LONG_PROSE);
  });

  it('TC-15: 999 chars + 1 char is accepted (1,000 boundary)', () => {
    const current = LONG_PROSE.slice(0, 999);
    const next = clampToLimit(current + 'x');
    expect(next.length).toBe(1000);
    const text = makeText(current);
    applyTextDiff(text, next, LOCAL_ORIGIN);
    expect(text.toString().length).toBe(1000);
    expect(text.toString()).toBe(current + 'x');
  });

  it('TC-16 (negative/boundary): 1,000 chars + 1 char is rejected, still 1,000', () => {
    const text = makeText(LONG_PROSE);
    const next = clampToLimit(LONG_PROSE + 'x');
    expect(next).toBe(LONG_PROSE);
    const ops = captureDelta(text, () => applyTextDiff(text, next, LOCAL_ORIGIN));
    expect(ops).toHaveLength(0);
    expect(text.toString().length).toBe(1000);
    expect(text.toString()).toBe(LONG_PROSE);
  });

  it('TC-17: counterVisible at 949 / 950 / 951 chars (remaining 51 / 50 / 49)', () => {
    expect(counterVisible(949)).toBe(false);
    expect(counterVisible(950)).toBe(true);
    expect(counterVisible(951)).toBe(true);
    expect(counterVisible(0)).toBe(false);
    expect(counterVisible(1000)).toBe(true);
  });

  it('clampToLimit honours an explicit max and never extends short text', () => {
    expect(clampToLimit('abcdef', 3)).toBe('abc');
    expect(clampToLimit('ab', 3)).toBe('ab');
    expect(clampToLimit('')).toBe('');
  });
});
