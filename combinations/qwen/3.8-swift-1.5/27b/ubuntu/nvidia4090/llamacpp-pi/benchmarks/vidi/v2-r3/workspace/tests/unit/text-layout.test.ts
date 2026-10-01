import { describe, it, expect } from 'vitest';
import {
  layoutText,
  createCanvasMeasurer,
  type Measurer,
} from '../../src/client/objects/textLayout';
import {
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
} from '../../src/shared/config';

/**
 * Story 9 (text.auto_width, text.fixed_width): grow-then-wrap layout
 * determinism. Tests use a fake measurer (fixed units per character) so the
 * expected line breaks are exact; the canvas measurer itself is covered by
 * TC-32 (returns a function, estimate fallback without a DOM).
 */

/** Fake measurer: 1 unit per character per 2 px of font size (M → 10/char). */
const fakeMeasure: Measurer = (text, fontPx) => text.length * (fontPx / 2);

const M = 'M' as const;

describe('story 9: text layout (grow-then-wrap)', () => {
  // TC-07
  it('TC-07: short line "Went well" at M in auto mode → width = measured line, height = one line', () => {
    const r = layoutText('Went well', M, 'auto', 0, fakeMeasure);
    // 9 chars × 10 units/char (M = 20px) = 90.
    expect(r.width).toBe(90);
    expect(r.height).toBe(TEXT_SIZES[M] * TEXT_LINE_HEIGHT); // 26
    expect(r.lines).toEqual(['Went well']);
  });

  // TC-08
  it('TC-08: an over-long line in auto mode → width capped at TEXT_MAX_AUTO_WIDTH_WORLD, 2 lines (greedy wrap)', () => {
    // Word lengths 20+19+19+10 with spaces: total 72 chars = 720 units > 600.
    // Greedy packing at 60 chars: 20+1+19+1+19 = 60 chars → exactly 600 units
    // on line 1; the last word wraps to line 2.
    const w20 = 'a'.repeat(20);
    const w19 = 'b'.repeat(19);
    const w19b = 'c'.repeat(19);
    const w10 = 'd'.repeat(10);
    const line = [w20, w19, w19b, w10].join(' ');
    expect(fakeMeasure(line, TEXT_SIZES[M])).toBeGreaterThan(TEXT_MAX_AUTO_WIDTH_WORLD);

    const r = layoutText(line, M, 'auto', 0, fakeMeasure);
    expect(r.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0]).toBe(`${w20} ${w19} ${w19b}`);
    expect(r.lines[1]).toBe(w10);
    expect(r.height).toBe(2 * TEXT_SIZES[M] * TEXT_LINE_HEIGHT);
  });

  // TC-09
  it('TC-09: a line measuring exactly TEXT_MAX_AUTO_WIDTH_WORLD → 1 line, width exactly the cap', () => {
    // 60 chars × 10 units = exactly 600.
    const line = 'x'.repeat(60);
    expect(fakeMeasure(line, TEXT_SIZES[M])).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    const r = layoutText(line, M, 'auto', 0, fakeMeasure);
    expect(r.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(r.lines).toEqual([line]);
    expect(r.height).toBe(TEXT_SIZES[M] * TEXT_LINE_HEIGHT);
  });

  // TC-10
  it('TC-10: 3 words at fixed width TEXT_MIN_WIDTH_WORLD → 1 word per line, height 3 lines', () => {
    const r = layoutText('abcd efg h', M, 'fixed', TEXT_MIN_WIDTH_WORLD, fakeMeasure);
    // 'abcd' = 40 = the cap (fits alone); 'abcd efg' = 45 > 40 → each word alone.
    expect(r.lines).toEqual(['abcd', 'efg', 'h']);
    expect(r.height).toBe(3 * TEXT_SIZES[M] * TEXT_LINE_HEIGHT);
    // Fixed mode: the width is exactly the fixed width.
    expect(r.width).toBe(TEXT_MIN_WIDTH_WORLD);
  });

  // TC-11
  it('TC-11: multi-line "aaa\\nbbb ccc" → 2 lines, width = longest line', () => {
    const r = layoutText('aaa\nbbb ccc', M, 'auto', 0, fakeMeasure);
    expect(r.lines).toEqual(['aaa', 'bbb ccc']);
    expect(r.width).toBe(70); // 'bbb ccc' = 7 chars × 10
    expect(r.height).toBe(2 * TEXT_SIZES[M] * TEXT_LINE_HEIGHT);
  });

  it('explicit newlines at other sizes wrap independently per line', () => {
    // L = 32px → 16 units/char with the fake measurer.
    const r = layoutText('hello world\nhi', 'L', 'auto', 0, fakeMeasure);
    // 'hello world' = 11 chars × 16 = 176 ≤ 600 → one line.
    expect(r.lines).toEqual(['hello world', 'hi']);
    expect(r.width).toBe(176);
    expect(r.height).toBe(2 * TEXT_SIZES.L * TEXT_LINE_HEIGHT);
  });

  it('a single word longer than the cap keeps its own line (overflow, no split)', () => {
    const word = 'z'.repeat(80); // 800 units > 600
    const r = layoutText(word, M, 'auto', 0, fakeMeasure);
    expect(r.lines).toEqual([word]);
    expect(r.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
  });

  it('empty text → one (empty) line, zero width', () => {
    const r = layoutText('', M, 'auto', 0, fakeMeasure);
    expect(r.lines).toEqual(['']);
    expect(r.width).toBe(0);
    expect(r.height).toBe(TEXT_SIZES[M] * TEXT_LINE_HEIGHT);
  });

  // TC-32
  it('TC-32: createCanvasMeasurer() → a function; the estimate fallback works without a DOM', () => {
    const measure = createCanvasMeasurer();
    expect(typeof measure).toBe('function');
    // In node/jsdom there is no canvas 2d context: the named estimate
    // (character count × ratio × font size) must return a finite positive
    // width for non-empty text and 0 for empty text.
    const w = measure('hello', 20);
    expect(Number.isFinite(w)).toBe(true);
    expect(w).toBeGreaterThan(0);
    expect(measure('', 20)).toBe(0);
    // Monotonic in length and font size.
    expect(measure('helloooooo', 20)).toBeGreaterThan(w);
    expect(measure('hello', 40)).toBeGreaterThan(w);
  });
});
