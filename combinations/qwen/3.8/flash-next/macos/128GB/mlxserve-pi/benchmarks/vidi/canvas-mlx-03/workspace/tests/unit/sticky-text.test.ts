import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  clampToLimit,
  applyTextDiff,
  counterVisible,
} from '../../src/client/objects/StickyText.ts';
import {
  STICKY_TEXT_MAX_CHARS,
  STICKY_COUNTER_THRESHOLD_CHARS,
} from '../../src/shared/config.ts';
import { LONG_TEXT_1000, PASTE_1200 } from '../fixtures/texts.ts';

// A Y.Text seeded with `initial`, plus a capture of the delta ops from the next
// applyTextDiff call (single transaction expected).
function capture(
  initial: string,
  next: string,
): { text: Y.Text; delta: unknown[]; len: number } {
  const doc = new Y.Doc();
  const text = doc.getText('t');
  text.insert(0, initial);
  let delta: unknown[] = [];
  const h = (e: Y.YTextEvent) => {
    delta = delta.concat(e.delta);
  };
  text.observe(h);
  applyTextDiff(text, next, 'unit-origin');
  text.unobserve(h);
  return { text, delta, len: text.toString().length };
}

describe('sticky.text (pure logic)', () => {
  it('TC-13 applyTextDiff "abc" -> "abXc" emits a single insert of "X" at index 2', () => {
    const { text, delta } = capture('abc', 'abXc');
    expect(text.toString()).toBe('abXc');
    // A minimal insert: retain 2 then insert "X". NOT delete-all + insert-all.
    expect(delta).toEqual([{ retain: 2 }, { insert: 'X' }]);
  });

  it('TC-13b applyTextDiff "abcdef" -> "abef" deletes only the removed run', () => {
    const { text, delta } = capture('abcdef', 'abef');
    expect(text.toString()).toBe('abef');
    expect(delta).toEqual([{ retain: 2 }, { delete: 2 }]);
  });

  it('TC-13c applyTextDiff "abc" -> "aXc" replaces only the middle char', () => {
    const { text, delta } = capture('abc', 'aXc');
    expect(text.toString()).toBe('aXc');
    expect(delta).toEqual([{ retain: 1 }, { delete: 1 }, { insert: 'X' }]);
  });

  it('TC-13d applyTextDiff keeps emoji surrogate pairs intact', () => {
    const { text, delta } = capture('a\u{1F600}b', 'a\u{1F600}Xb');
    expect(text.toString()).toBe('a\u{1F600}Xb');
    // The single surrogate pair is not split: exactly one insert.
    expect(delta.filter((op) => 'insert' in (op as object))).toHaveLength(1);
    // And deleting the whole emoji removes both code units cleanly.
    const del = capture('a\u{1F600}b', 'ab');
    expect(del.text.toString()).toBe('ab');
  });

  it('TC-14 clampToLimit keeps the first 1,000 of a 1,200 char paste', () => {
    const result = clampToLimit(PASTE_1200);
    expect(result.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(result).toBe(PASTE_1200.slice(0, STICKY_TEXT_MAX_CHARS));
  });

  it('TC-15 at 999 chars, one more is accepted (boundary)', () => {
    const base = LONG_TEXT_1000.slice(0, 999);
    const result = clampToLimit(base + 'x');
    expect(result.length).toBe(1000);
    expect(result.endsWith('x')).toBe(true);
  });

  it('TC-16 at 1,000 chars, one more is rejected (boundary)', () => {
    const result = clampToLimit(LONG_TEXT_1000 + 'x');
    expect(result.length).toBe(1000);
    expect(result).toBe(LONG_TEXT_1000);
  });

  it('TC-17 counterVisible at the threshold boundary (51 / 50 / 49 remaining)', () => {
    const th = STICKY_COUNTER_THRESHOLD_CHARS; // 50
    const max = STICKY_TEXT_MAX_CHARS; // 1000
    expect(counterVisible(max - th - 1)).toBe(false); // 949 -> remaining 51
    expect(counterVisible(max - th)).toBe(true); // 950 -> remaining 50
    expect(counterVisible(max - th + 1)).toBe(true); // 951 -> remaining 49
  });
});
