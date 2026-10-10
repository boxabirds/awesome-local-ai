import { describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_TEXT_MAX_CHARS
} from '../../src/shared/config';
import { applyTextDiff, clampToLimit, counterVisible } from '../../src/client/objects/StickyText';
import { PROSE_1000, PROSE_1200 } from '../fixtures/texts';

function trackedText(initial: string): { ytext: Y.Text; deltas: Array<Array<Record<string, unknown>>> } {
  const doc = new Y.Doc();
  const ytext = doc.getText('t');
  if (initial.length > 0) ytext.insert(0, initial);
  const deltas: Array<Array<Record<string, unknown>>> = [];
  ytext.observe((event) => {
    deltas.push(event.delta as Array<Record<string, unknown>>);
  });
  return { ytext, deltas };
}

describe('sticky.text minimal diff', () => {
  test('TC-13: insert into middle produces a single insert op, not replace-all', () => {
    const { ytext, deltas } = trackedText('abc');
    applyTextDiff(ytext, 'abXc', null);
    expect(ytext.toString()).toBe('abXc');
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toEqual([{ retain: 2 }, { insert: 'X' }]);
  });

  test('TC-13b: deletion in the middle produces a single delete op', () => {
    const { ytext, deltas } = trackedText('abcdef');
    applyTextDiff(ytext, 'abef', null);
    expect(ytext.toString()).toBe('abef');
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toEqual([{ retain: 2 }, { delete: 2 }]);
  });

  test('TC-13c: replacement of a selection produces delete+insert around common affixes', () => {
    const { ytext, deltas } = trackedText('the quick fox');
    applyTextDiff(ytext, 'the brown fox', null);
    expect(ytext.toString()).toBe('the brown fox');
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toEqual([
      { retain: 4 },
      { delete: 5 },
      { insert: 'brown' }
    ]);
  });

  test('TC-13d: no change emits no event', () => {
    const { ytext, deltas } = trackedText('same');
    applyTextDiff(ytext, 'same', null);
    expect(deltas).toHaveLength(0);
  });

  test('TC-13e: surrogate pairs stay intact when surrounding text changes', () => {
    const before = 'Ship 🚀 the demo 🎉 on Friday';
    const after = 'Ship 🚀 the demo 🎊 on Friday!';
    const { ytext } = trackedText(before);
    applyTextDiff(ytext, after, null);
    expect(ytext.toString()).toBe(after);
    // Code points preserved exactly:
    expect(Array.from(ytext.toString())).toEqual(Array.from(after));
  });

  test('TC-13f: multi-line retro item change diffs only the edited line', () => {
    const before = 'line one\nline two\nline three';
    const after = 'line one\nline 2\nline three';
    const { ytext, deltas } = trackedText(before);
    applyTextDiff(ytext, after, null);
    expect(ytext.toString()).toBe(after);
    const ops = deltas[0];
    const total = ops.reduce((size, op) => size + (op.delete as number | undefined ?? 0), 0);
    const inserted = ops.reduce((size, op) => size + ((op.insert as string | undefined)?.length ?? 0), 0);
    expect(total).toBeLessThan(after.length);
    expect(inserted).toBeLessThan(after.length);
  });
});

describe('sticky.text length limit', () => {
  test('TC-14: paste of 1,200 chars into empty note keeps exactly the first 1,000', () => {
    expect(PROSE_1200).toHaveLength(1200);
    const clamped = clampToLimit(PROSE_1200);
    expect(clamped).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(clamped).toBe(PROSE_1200.slice(0, 1000));

    const { ytext } = trackedText('');
    applyTextDiff(ytext, clamped, null);
    expect(ytext.toString()).toBe(PROSE_1200.slice(0, 1000));
  });

  test('TC-15: 999 chars + 1 char is accepted (boundary)', () => {
    const base = PROSE_1000.slice(0, 999);
    const next = clampToLimit(base + '!');
    expect(next).toHaveLength(1000);
    expect(next.endsWith('!')).toBe(true);
  });

  test('TC-16: 1,000 chars + 1 char is rejected (negative/boundary)', () => {
    expect(PROSE_1000).toHaveLength(1000);
    expect(clampToLimit(PROSE_1000 + 'x')).toBe(PROSE_1000);
    // Typing a character in the middle still cannot grow past the limit.
    const inserted = clampToLimit(PROSE_1000.slice(0, 500) + 'Z' + PROSE_1000.slice(500));
    expect(inserted).toHaveLength(1000);
  });

  test('clampToLimit respects a custom max', () => {
    expect(clampToLimit('abcdef', 3)).toBe('abc');
  });
});

describe('sticky.text counter visibility', () => {
  test('TC-17: counter appears at 950 chars and stays visible past the boundary', () => {
    expect(STICKY_COUNTER_THRESHOLD_CHARS).toBe(50);
    expect(counterVisible(949)).toBe(false); // 51 remaining
    expect(counterVisible(950)).toBe(true); // 50 remaining
    expect(counterVisible(951)).toBe(true); // 49 remaining
    expect(counterVisible(1000)).toBe(true); // 0 remaining
    expect(counterVisible(0)).toBe(false);
  });
});
