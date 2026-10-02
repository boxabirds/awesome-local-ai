// Unit tests for sticky text logic (sticky.text contract).
// TC-13 to TC-17.

import { describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';
import {
  applyTextDiff,
  clampToLimit,
  counterVisible,
} from '../../src/client/objects/StickyText';

// Realistic English text fixtures
const SHORT_TEXT = 'Faster onboarding';
const MEDIUM_TEXT =
  'We should improve our onboarding flow to reduce friction for new users who are trying to get started with the product for the first time.';
// Generate a ~1200 char paragraph of English prose (not repeated single chars)
const LONG_PARAGRAPH = (
  'The quick brown fox jumps over the lazy dog. ' +
  'Pack my box with five dozen liquor jugs. ' +
  'How vexingly quick daft zebras jump. ' +
  'The five boxing wizards jump quickly. ' +
  'Sphinx of black quartz judge my vow. '
).repeat(8).slice(0, 1200);

/** Create a Y.Text attached to a fresh doc. */
function newText(initial?: string): Y.Text {
  const doc = new Y.Doc();
  const t = doc.getText('test');
  if (initial) t.insert(0, initial);
  return t;
}

interface DeltaOp {
  insert?: string;
  delete?: number;
  retain?: number;
}

/** Apply a diff and capture the non-retain delta operations. */
function captureDiff(t: Y.Text, next: string): DeltaOp[] {
  let ops: DeltaOp[] = [];
  const h = (event: Y.YTextEvent) => {
    for (const d of event.delta as DeltaOp[]) {
      // Filter out pure retain operations
      if (d.retain !== undefined && d.insert === undefined && d.delete === undefined) continue;
      ops.push(d);
    }
  };
  t.observe(h);
  applyTextDiff(t, next, 'test');
  t.unobserve(h);
  return ops;
}

describe('sticky.text', () => {
  // TC-13: applyTextDiff 'abc' → 'abXc' produces a single insert of 'X' at index 2
  test('TC-13 applyTextDiff produces minimal insert (not delete-all + insert-all)', () => {
    const t = newText('abc');
    const ops = captureDiff(t, 'abXc');

    expect(t.toString()).toBe('abXc');
    // Should be a single insert of 'X' (no delete)
    expect(ops).toHaveLength(1);
    expect(ops[0].insert).toBe('X');
    expect(ops[0].delete).toBeUndefined();
  });

  test('TC-13b applyTextDiff pure deletion in middle', () => {
    const t = newText('abcde');
    const ops = captureDiff(t, 'acde');

    expect(t.toString()).toBe('acde');
    // Should be a single delete of 1 char
    expect(ops).toHaveLength(1);
    expect(ops[0].delete).toBe(1);
    expect(ops[0].insert).toBeUndefined();
  });

  test('TC-13c applyTextDiff replacement of a selection', () => {
    const t = newText('hello world');
    const ops = captureDiff(t, 'hello earth');

    expect(t.toString()).toBe('hello earth');
    const totalDeleted = ops.reduce((sum, d) => sum + (d.delete ?? 0), 0);
    const totalInserted = ops.reduce(
      (sum, d) => sum + (typeof d.insert === 'string' ? d.insert.length : 0),
      0,
    );
    expect(totalDeleted).toBe(5);
    expect(totalInserted).toBe(5);
  });

  test('TC-13d applyTextDiff keeps emoji surrogate pairs intact', () => {
    const t = newText('hi \u{1F389} party');
    const ops = captureDiff(t, 'hi \u{1F38A} party');

    expect(t.toString()).toBe('hi \u{1F38A} party');
    const totalDeleted = ops.reduce((sum, d) => sum + (d.delete ?? 0), 0);
    const totalInserted = ops.reduce(
      (sum, d) => sum + (typeof d.insert === 'string' ? d.insert.length : 0),
      0,
    );
    // Surrogate pair is 2 code units
    expect(totalDeleted).toBe(2);
    expect(totalInserted).toBe(2);
  });

  // TC-14: paste of 1,200 chars into empty → 1,000 kept
  test('TC-14 clampToLimit: 1200 chars → 1000 kept', () => {
    const result = clampToLimit(LONG_PARAGRAPH.slice(0, 1200));
    expect(result.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(result).toBe(LONG_PARAGRAPH.slice(0, 1000));
  });

  // TC-15: 999 + 1 → 1,000 accepted (boundary)
  test('TC-15 clampToLimit: 999 chars + 1 = 1000 accepted', () => {
    const text999 = MEDIUM_TEXT.repeat(10).slice(0, 999);
    const result = clampToLimit(text999 + 'a');
    expect(result.length).toBe(1000);
  });

  // TC-16: 1,000 + 1 → rejected, still 1,000
  test('TC-16 clampToLimit: 1000 chars + 1 = still 1000', () => {
    const text1000 = MEDIUM_TEXT.repeat(10).slice(0, 1000);
    const result = clampToLimit(text1000 + 'a');
    expect(result.length).toBe(1000);
    expect(result).toBe(text1000);
  });

  // TC-17: counterVisible at 949 / 950 / 951 chars → false / true / true
  test('TC-17a counterVisible at 949 chars → false (remaining 51 > 50)', () => {
    expect(counterVisible(949)).toBe(false);
  });

  test('TC-17b counterVisible at 950 chars → true (remaining 50 <= 50)', () => {
    expect(counterVisible(950)).toBe(true);
  });

  test('TC-17c counterVisible at 951 chars → true (remaining 49 <= 50)', () => {
    expect(counterVisible(951)).toBe(true);
  });

  // Additional boundary tests
  test('counterVisible at 0 chars → false', () => {
    expect(counterVisible(0)).toBe(false);
  });

  test('counterVisible at 1000 chars → true', () => {
    expect(counterVisible(1000)).toBe(true);
  });

  test('clampToLimit with empty string → empty', () => {
    expect(clampToLimit('')).toBe('');
  });

  test('clampToLimit with short string → unchanged', () => {
    expect(clampToLimit(SHORT_TEXT)).toBe(SHORT_TEXT);
  });
});
