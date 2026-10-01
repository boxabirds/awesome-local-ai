import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { clampToLimit, applyTextDiff, counterVisible } from '../../src/client/objects/StickyText';
import { STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';

// Generate a deterministic long text (not random, for test stability)
function makeLongText(n: number): string {
  const words = ['the', 'quick', 'brown', 'fox', 'jumps', 'over', 'lazy', 'dog', 'pack', 'my', 'box', 'with', 'five', 'dozen', 'liquor', 'jugs', 'how', 'vexingly', 'daft', 'zebras'];
  let result = '';
  let i = 0;
  while (result.length < n) {
    result += words[i % words.length];
    if (result.length < n) result += ' ';
    i++;
  }
  return result.slice(0, n);
}

function createTextWithContent(content: string): Y.Text {
  const doc = new Y.Doc();
  const ytext = doc.getText('text');
  ytext.insert(0, content);
  return ytext;
}

describe('sticky-text unit tests', () => {
  // TC-13: applyTextDiff 'abc' → 'abXc' produces a single insert of 'X' at index 2
  it('TC-13: applyTextDiff produces minimal diff (single insert)', () => {
    const ytext = createTextWithContent('abc');

    const deltas: Array<{ retain?: number; insert?: string; delete?: number }> = [];
    ytext.observe((event) => {
      deltas.push(...(event.delta as Array<{ retain?: number; insert?: string; delete?: number }>));
    });

    applyTextDiff(ytext, 'abXc', 'test');
    expect(ytext.toString()).toBe('abXc');

    // Should be retain(2) + insert('X') — a minimal diff, not delete-all + insert-all
    expect(deltas).toHaveLength(2);
    expect(deltas[0].retain).toBe(2);
    expect(deltas[1].insert).toBe('X');
  });

  it('TC-13: applyTextDiff pure deletion in middle', () => {
    const ytext = createTextWithContent('abcde');

    const deltas: Array<{ retain?: number; insert?: string; delete?: number }> = [];
    ytext.observe((event) => {
      deltas.push(...(event.delta as Array<{ retain?: number; insert?: string; delete?: number }>));
    });

    applyTextDiff(ytext, 'acde', 'test');
    expect(ytext.toString()).toBe('acde');

    // Should be retain(1) + delete(1) — a minimal diff
    expect(deltas).toHaveLength(2);
    expect(deltas[0].retain).toBe(1);
    expect(deltas[1].delete).toBe(1);
  });

  it('TC-13: applyTextDiff replacement of a selection', () => {
    const ytext = createTextWithContent('hello world');

    const deltas: Array<{ retain?: number; insert?: string; delete?: number }> = [];
    ytext.observe((event) => {
      deltas.push(...(event.delta as Array<{ retain?: number; insert?: string; delete?: number }>));
    });

    applyTextDiff(ytext, 'hello there', 'test');
    expect(ytext.toString()).toBe('hello there');

    // "world" → "there": delete 5, insert 5
    const totalDelete = deltas.reduce((sum, d) => sum + (d.delete || 0), 0);
    const totalInsert = deltas.reduce((sum, d) => sum + (typeof d.insert === 'string' ? d.insert.length : 0), 0);
    expect(totalDelete).toBe(5);
    expect(totalInsert).toBe(5);
  });

  it('TC-13: applyTextDiff keeps surrogate pairs intact', () => {
    const ytext = createTextWithContent('a\u{1F389}b');

    applyTextDiff(ytext, 'a\u{1F389}c', 'test');
    expect(ytext.toString()).toBe('a\u{1F389}c');
  });

  // TC-14: paste of 1,200 chars into empty → 1,000 kept
  it('TC-14: clampToLimit keeps first 1000 chars of 1200', () => {
    const long = makeLongText(1200);
    expect(long.length).toBe(1200);
    const clamped = clampToLimit(long);
    expect(clamped.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(clamped).toBe(long.slice(0, 1000));
  });

  // TC-15: 999 + 1 → 1,000 accepted
  it('TC-15: clampToLimit accepts 1000 chars (boundary)', () => {
    const text = makeLongText(1000);
    expect(text.length).toBe(1000);
    const clamped = clampToLimit(text);
    expect(clamped.length).toBe(1000);
    expect(clamped).toBe(text);
  });

  // TC-16: 1,000 + 1 → rejected, still 1,000
  it('TC-16: clampToLimit rejects 1001 chars (boundary)', () => {
    const text = makeLongText(1001);
    expect(text.length).toBe(1001);
    const clamped = clampToLimit(text);
    expect(clamped.length).toBe(1000);
    expect(clamped).toBe(text.slice(0, 1000));
  });

  // TC-17: counterVisible at 949 / 950 / 951 chars
  it('TC-17: counterVisible at 949 chars → false (remaining 51)', () => {
    expect(counterVisible(949)).toBe(false);
  });

  it('TC-17: counterVisible at 950 chars → true (remaining 50)', () => {
    expect(counterVisible(950)).toBe(true);
  });

  it('TC-17: counterVisible at 951 chars → true (remaining 49)', () => {
    expect(counterVisible(951)).toBe(true);
  });

  it('TC-17: counterVisible at 0 chars → false', () => {
    expect(counterVisible(0)).toBe(false);
  });

  it('TC-17: counterVisible at 1000 chars → true (remaining 0)', () => {
    expect(counterVisible(1000)).toBe(true);
  });
});
