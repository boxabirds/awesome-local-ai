// text.layout unit tests (story 9, TC-07 to TC-11, TC-32).
//
// Deterministic fake measurer: 10 world units per character, independent of
// font size, so wrapping maths is exact (spec: Mock vs real boundaries).

import { describe, expect, it } from 'vitest';
import { TEXT_LINE_HEIGHT, TEXT_MAX_AUTO_WIDTH_WORLD, TEXT_MIN_WIDTH_WORLD, TEXT_SIZES } from '../../src/shared/config';
import { createCanvasMeasurer, layoutText, type Measurer } from '../../src/client/objects/textLayout';

const m10 = (text: string): number => text.length * 10;
const measure10: Measurer = m10;

const LINE_M = TEXT_SIZES.M * TEXT_LINE_HEIGHT; // 26

describe('text.layout (fake measurer, 10 units/char)', () => {
  it('TC-07 "Went well" at M auto → width = measured line (90), height one line', () => {
    const result = layoutText('Went well', 'M', 'auto', null, measure10);
    expect(result.width).toBe(90);
    expect(result.height).toBe(LINE_M);
    expect(result.lines).toEqual(['Went well']);
  });

  it('TC-08 line measuring 900 → width TEXT_MAX_AUTO_WIDTH_WORLD, wrapped to 2 lines, height 2 lines', () => {
    const word = 'w'.repeat(90); // 900 units
    expect(m10(word)).toBe(900);
    const result = layoutText(word, 'M', 'auto', null, measure10);
    expect(result.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(result.lines).toHaveLength(2);
    expect(result.height).toBe(2 * LINE_M);
    // Every wrapped line fits the max width.
    for (const line of result.lines) {
      expect(m10(line)).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD);
    }
    // Wrapping loses nothing.
    expect(result.lines.join('')).toBe(word);
  });

  it('TC-09 line measuring exactly 600 → one line, width 600 (boundary)', () => {
    const word = 'x'.repeat(60); // 600 units
    const result = layoutText(word, 'M', 'auto', null, measure10);
    expect(result.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(result.lines).toEqual([word]);
    expect(result.height).toBe(LINE_M);
  });

  it('TC-10 greedy word wrap: a 12-word line over 600 wraps at word boundaries (10 + 2)', () => {
    const line = Array.from({ length: 12 }, () => 'aaaaa').join(' '); // 71 chars = 710
    const result = layoutText(line, 'M', 'auto', null, measure10);
    // width = the longest wrapped line (10 words = 59 chars = 590)
    expect(result.width).toBe(590);
    expect(result.width).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(result.lines.map((l) => l.split(' ').length)).toEqual([10, 2]);
    for (const l of result.lines) {
      expect(m10(l)).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD);
    }
    expect(result.lines.join(' ')).toBe(line);
  });

  it('TC-10b fixed width TEXT_MIN_WIDTH_WORLD with three words → one word per line, height 3 lines (boundary)', () => {
    const result = layoutText('aaaa bbbb cccc', 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, measure10);
    expect(result.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(result.lines).toEqual(['aaaa', 'bbbb', 'cccc']);
    expect(result.height).toBe(3 * LINE_M);
  });

  it('TC-11 explicit newlines → width = longest line, height = line count × size × TEXT_LINE_HEIGHT', () => {
    const result = layoutText('abc\ndefg\nhi', 'M', 'auto', null, measure10);
    expect(result.lines).toEqual(['abc', 'defg', 'hi']);
    // longest line is 'defg' = 4 chars = 40
    expect(result.width).toBe(40);
    expect(result.height).toBe(3 * LINE_M);
  });

  it('TC-11b empty text → one (empty) line, zero width, one line of height', () => {
    const result = layoutText('', 'M', 'auto', null, measure10);
    expect(result.lines).toEqual(['']);
    expect(result.width).toBe(0);
    expect(result.height).toBe(LINE_M);
  });

  it('TC-32 createCanvasMeasurer without canvas → estimate fallback, no throw (error path)', () => {
    const measure = createCanvasMeasurer();
    // The node test environment has no canvas: the estimate is
    // length × fontPx × TEXT_AVG_GLYPH_WIDTH_RATIO.
    const width = measure('hello', 20);
    expect(Number.isFinite(width)).toBe(true);
    expect(width).toBe(5 * 20 * 0.6);
    // Never throws on odd input.
    expect(() => measure('', 14)).not.toThrow();
    expect(() => measure('a'.repeat(5000), 56)).not.toThrow();
  });
});
