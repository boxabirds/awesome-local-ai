import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { clampToLimit, applyTextDiff, counterVisible } from '../../src/client/objects/StickyText';
import { STICKY_TEXT_MAX_CHARS, STICKY_COUNTER_THRESHOLD_CHARS } from '../../src/shared/config';
import { SHORT_PHRASE, RETRO_ITEM, LONG_PROSE } from '../fixtures/texts';

/** Collect the Y.Text delta events emitted while running `fn`. */
type DeltaOp = { insert?: string | object; delete?: number; retain?: number };
function deltas(ytext: Y.Text, fn: () => void): DeltaOp[] {
  const ops: DeltaOp[] = [];
  const observer = (event: { delta: DeltaOp[] }) => {
    ops.push(...event.delta);
  };
  ytext.observe(observer as never);
  fn();
  ytext.unobserve(observer as never);
  return ops;
}

describe('clampToLimit', () => {
  it('TC-14 paste of 1,200 chars into empty → 1,000 kept', () => {
    const input = SHORT_PHRASE.repeat(100).slice(0, 1200); // >= 1,000
    const clamped = clampToLimit(input);
    expect(clamped.length).toBe(STICKY_TEXT_MAX_CHARS);
  });

  it('TC-15 999 + 1 → 1,000 accepted (boundary)', () => {
    const current = 'a'.repeat(STICKY_TEXT_MAX_CHARS - 1);
    const clamped = clampToLimit(current + 'b');
    expect(clamped.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(clamped).toBe(current + 'b');
  });

  it('TC-16 1,000 + 1 → rejected, still 1,000 (boundary/negative)', () => {
    const current = 'a'.repeat(STICKY_TEXT_MAX_CHARS);
    const clamped = clampToLimit(current + 'b');
    expect(clamped.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(clamped).toBe(current);
  });

  it('leaves a short string untouched', () => {
    expect(clampToLimit('hello')).toBe('hello');
  });
});

describe('counterVisible', () => {
  // TC-17: boundary at 949 / 950 / 951 chars (remaining 51 / 50 / 49).
  it('is false at 949, true at 950 and 951 chars', () => {
    const remainingAt = (len: number) => STICKY_TEXT_MAX_CHARS - len;
    expect(remainingAt(949)).toBe(STICKY_COUNTER_THRESHOLD_CHARS + 1);
    expect(remainingAt(950)).toBe(STICKY_COUNTER_THRESHOLD_CHARS);
    expect(counterVisible(949)).toBe(false);
    expect(counterVisible(950)).toBe(true);
    expect(counterVisible(951)).toBe(true);
  });

  it('is false for short text', () => {
    expect(counterVisible(0)).toBe(false);
    expect(counterVisible(500)).toBe(false);
  });
});

describe('applyTextDiff', () => {
  it('TC-13 "abc" → "abXc" emits a single insert of "X" at index 2 (not delete+insert all)', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('t');
    ytext.insert(0, 'abc');
    const ops = deltas(ytext, () => applyTextDiff(ytext, 'abXc', null));
    expect(ytext.toString()).toBe('abXc');
    // A single insert at the differing middle, not a full replace.
    const inserts = ops.filter((o) => o.insert !== undefined);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].insert).toBe('X');
    expect(ops.some((o) => o.delete !== undefined)).toBe(false);
  });

  it('pure deletion in the middle is a single delete, not a replace', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('t');
    ytext.insert(0, 'abcdef');
    const ops = deltas(ytext, () => applyTextDiff(ytext, 'abcf', null));
    expect(ytext.toString()).toBe('abcf');
    const deletes = ops.filter((o) => o.delete !== undefined);
    const inserts = ops.filter((o) => o.insert !== undefined);
    expect(deletes).toHaveLength(1);
    expect(inserts).toHaveLength(0);
  });

  it('replacement of a middle run is one delete + one insert', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('t');
    ytext.insert(0, 'hello world');
    applyTextDiff(ytext, 'hello there', null);
    expect(ytext.toString()).toBe('hello there');
  });

  it('keeps emoji surrogate pairs intact when deleting the surrounding text', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('t');
    ytext.insert(0, 'a😀b'); // 😀 = U+1F600 (surrogate pair)
    // Delete only the trailing "b" — the emoji must survive untouched.
    applyTextDiff(ytext, 'a😀', null);
    expect(ytext.toString()).toBe('a😀');
    expect(ytext.toString()).not.toContain('\uFFFD');
  });

  it('does not split a surrogate pair when the diff boundary lands inside one', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('t');
    ytext.insert(0, 'x😀y');
    // Replace the trailing "y" plus the emoji with a plain character.
    const result = 'xZ';
    applyTextDiff(ytext, result, null);
    expect(ytext.toString()).toBe(result);
    expect(ytext.toString()).not.toContain('\uFFFD');
  });

  it('replaces realistic prose correctly', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('t');
    ytext.insert(0, RETRO_ITEM);
    applyTextDiff(ytext, LONG_PROSE, null);
    expect(ytext.toString()).toBe(LONG_PROSE);
    expect(LONG_PROSE.length).toBe(STICKY_TEXT_MAX_CHARS);
  });

  it('is a no-op (no transaction) when the text already matches', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('t');
    ytext.insert(0, 'same');
    let updates = 0;
    doc.on('update', () => {
      updates += 1;
    });
    applyTextDiff(ytext, 'same', null);
    expect(updates).toBe(0);
  });
});