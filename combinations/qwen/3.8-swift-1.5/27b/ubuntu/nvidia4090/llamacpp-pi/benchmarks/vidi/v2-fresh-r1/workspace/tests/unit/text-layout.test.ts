// Unit tests for text layout (text.layout contract).
// TC-07 to TC-11, TC-32. Pure functions with a fake measurer.

import { describe, expect, test } from 'vitest';
import {
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_PADDING_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';
import { createCanvasMeasurer, layoutText, type Measurer } from '../../src/client/objects/textLayout';

/** Fake measurer: N world units per word (spaces ignored). */
function wordMeasurer(unitsPerWord: number): Measurer {
  return (text: string) => {
    const words = text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
    return words * unitsPerWord;
  };
}

const M = TEXT_SIZES.M;
const oneLineH = M * TEXT_LINE_HEIGHT;

describe('text.layout', () => {
  // TC-07: 'Went well' measured 90 at M → width 90 + padding, height one line.
  test('TC-07 auto short: width = measured line + padding, height one line', () => {
    const measure = wordMeasurer(45); // 'Went well' → 90
    const box = layoutText('Went well', 'M', 'auto', null, measure);
    expect(box.lines).toEqual(['Went well']);
    expect(box.width).toBe(90 + TEXT_PADDING_WORLD);
    expect(box.height).toBe(oneLineH);
  });

  // TC-08: line measuring 900 → width TEXT_MAX_AUTO_WIDTH_WORLD, wraps to 2 lines.
  test('TC-08 auto over max: caps at TEXT_MAX_AUTO_WIDTH_WORLD and wraps to 2 lines', () => {
    const measure = wordMeasurer(300); // 'one two three' → 900
    const box = layoutText('one two three', 'M', 'auto', null, measure);
    expect(box.lines).toEqual(['one two', 'three']);
    expect(box.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(box.height).toBe(2 * oneLineH);
  });

  // TC-09: line measuring exactly 600 → one line, width 600 (boundary).
  test('TC-09 auto exactly max: one line, width capped at the boundary', () => {
    const measure: Measurer = (t) => (t.trim() === '' ? 0 : TEXT_MAX_AUTO_WIDTH_WORLD);
    const box = layoutText('boundary', 'M', 'auto', null, measure);
    expect(box.lines).toEqual(['boundary']);
    expect(box.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(box.height).toBe(oneLineH);
  });

  // TC-10: fixed 40 with 3 words → one word per line, height 3 lines.
  test('TC-10 fixed width: wraps per word, height grows, width = fixed exactly', () => {
    const measure = wordMeasurer(25); // each word 25 > 40/2 → one per line
    const box = layoutText('red green blue', 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, measure);
    expect(box.lines).toEqual(['red', 'green', 'blue']);
    expect(box.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(box.height).toBe(3 * oneLineH);
  });

  // TC-11: explicit newlines → width = longest line, height = lines × size × LH.
  test('TC-11 multi-line with Enter: width = longest line, height = line count', () => {
    const measure: Measurer = (t) => t.length * 10;
    const box = layoutText('Short\nLonger line here', 'M', 'auto', null, measure);
    expect(box.lines).toEqual(['Short', 'Longer line here']);
    expect(box.width).toBe(16 * 10 + TEXT_PADDING_WORLD);
    expect(box.height).toBe(2 * oneLineH);
  });

  // TC-32: createCanvasMeasurer without canvas → estimate fallback, no throw.
  test('TC-32 canvas measurer falls back to an estimate without throwing', () => {
    const measure = createCanvasMeasurer();
    expect(() => measure('hello world', M)).not.toThrow();
    const w = measure('hello world', M);
    expect(w).toBeGreaterThan(0);
    expect(Number.isFinite(w)).toBe(true);
    // Estimate scales with length and font size.
    expect(measure('a much longer piece of text', M)).toBeGreaterThan(w);
    expect(measure('hello world', M * 2)).toBeGreaterThan(w);
  });

  // Extra: empty text → one line, minimum width.
  test('empty text: one line at the minimum width', () => {
    const measure = wordMeasurer(45);
    const box = layoutText('', 'M', 'auto', null, measure);
    expect(box.lines).toEqual(['']);
    expect(box.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(box.height).toBe(oneLineH);
  });

  // Extra: a single word wider than the cap stays on its own line (no word split).
  test('a word wider than the cap is not split', () => {
    const measure = wordMeasurer(400);
    const box = layoutText('longword other', 'M', 'auto', null, measure);
    // 'longword' (400) fits; 'longword other' (800) does not.
    expect(box.lines).toEqual(['longword', 'other']);
    expect(box.width).toBe(400 + TEXT_PADDING_WORLD);
  });
});
