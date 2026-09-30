import { describe, expect, it } from 'vitest';

import {
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
} from '../../src/shared/config';
import {
  layoutText,
  type Measurer,
  createCanvasMeasurer,
} from '../../src/client/objects/textLayout';

/**
 * Unit tests for text.layout (TC-07 to TC-11, TC-32).
 * Uses a deterministic fake measurer (fixed world units per character at each size).
 */

/**
 * A fake measurer that uses a fixed width per character (half the font size)
 * so test expectations are deterministic.
 */
function fakeMeasurer(): Measurer {
  return (text: string, fontPx: number): number => {
    return text.length * fontPx * 0.5;
  };
}

describe('text.layout layoutText auto mode (TC-07)', () => {
  it('TC-07 short text "Went well" at M → width = measured line, height = one line', () => {
    const measure = fakeMeasurer();
    const result = layoutText('Went well', 'M', 'auto', null, measure);
    // 'Went well' = 9 chars, fontPx = 20, measured = 9 * 20 * 0.5 = 90
    const expectedWidth = 9 * TEXT_SIZES.M * 0.5;
    expect(result.width).toBe(expectedWidth);
    expect(result.width).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD);
    const expectedHeight = 1 * TEXT_SIZES.M * TEXT_LINE_HEIGHT;
    expect(result.height).toBe(expectedHeight);
    expect(result.lines).toEqual(['Went well']);
  });
});

describe('text.layout layoutText wrapping (TC-08)', () => {
  it('TC-08 line measuring over 600 → width clamped to TEXT_MAX_AUTO_WIDTH_WORLD, wraps to 2 lines', () => {
    const measure = fakeMeasurer();
    // Need a line that measures > 600. At font 20 (M), each char is 10px wide.
    // 61 chars = 610px > 600. Use 2 words of ~31 chars each.
    const word1 = 'a'.repeat(31);
    const word2 = 'b'.repeat(31);
    const text = `${word1} ${word2}`;
    // Total measured: 63 chars * 10 = 630 > 600 → wrapping occurs
    const result = layoutText(text, 'M', 'auto', null, measure);
    expect(result.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    // Greedy wrap: word1 alone on first line (310 ≤ 600), adding word2 makes 630 > 600 → wrap
    expect(result.lines.length).toBe(2);
    expect(result.lines[0]).toBe(word1);
    expect(result.lines[1]).toBe(word2);
    expect(result.height).toBe(2 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });
});

describe('text.layout boundary at max (TC-09)', () => {
  it('TC-09 line measuring exactly 600 → one line, width 600', () => {
    const measure = fakeMeasurer();
    // Need exactly 600: at font 20, 600 / 10 = 60 chars
    const text = 'a'.repeat(60);
    const result = layoutText(text, 'M', 'auto', null, measure);
    expect(result.width).toBe(600);
    expect(result.lines.length).toBe(1);
    expect(result.height).toBe(1 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });
});

describe('text.layout fixed width (TC-10)', () => {
  it('TC-10 fixed width TEXT_MIN_WIDTH_WORLD with 3 words → one per line, height grows', () => {
    const measure = fakeMeasurer();
    // At font 14 (S size), each char = 7px. TEXT_MIN_WIDTH_WORLD = 40.
    // A word of 5 chars = 35px > 40/3 but fits alone on line. Two words with space would be longer.
    // Let's use S size: each char 7px. 40 / 7 = ~5.7 chars fit.
    // Use 3 words of 3 chars each (3*7=21 per word, 2 words + space = 7*7=49 > 40, so they must go on separate lines)
    const text = 'abc def ghi';
    const result = layoutText(text, 'S', 'fixed', TEXT_MIN_WIDTH_WORLD, measure);
    // Each word is 3 chars * 14 * 0.5 = 21. Two words + space = 7 chars * 7 = 49 > 40
    expect(result.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(result.lines.length).toBe(3);
    expect(result.lines).toEqual(['abc', 'def', 'ghi']);
    expect(result.height).toBe(3 * TEXT_SIZES.S * TEXT_LINE_HEIGHT);
  });
});

describe('text.layout multi-line text (TC-11)', () => {
  it('TC-11 text with newlines → width = longest line, height = lines × size × lineHeight', () => {
    const measure = fakeMeasurer();
    const text = 'short\na very long line here\nok';
    const result = layoutText(text, 'M', 'auto', null, measure);
    // Lines: "short"(5), "a very long line here"(21), "ok"(2)
    // Longest = 21 chars * 20 * 0.5 = 210
    const expectedWidth = 21 * TEXT_SIZES.M * 0.5;
    expect(result.width).toBe(expectedWidth);
    expect(result.lines.length).toBe(3);
    expect(result.height).toBe(3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });
});

describe('text.layout createCanvasMeasurer fallback (TC-32)', () => {
  it('TC-32 in jsdom without canvas → estimate fallback, no throw', () => {
    // jsdom does not support canvas getContext by default
    const measure = createCanvasMeasurer();
    // Should not throw, returns a function
    expect(() => measure('hello', 20)).not.toThrow();
    const result = measure('hello', 20);
    expect(result).toBeGreaterThan(0);
  });
});
