import { describe, expect, test } from 'vitest';
import {
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES
} from '../../src/shared/config';
import { createCanvasMeasurer, layoutText, type Measurer } from '../../src/client/objects/textLayout';

// Deterministic fake measurer: fixed world units per character at each font px
// (TC design: "fixed world units per character at each TEXT_SIZES value").
function fakeMeasurer(): Measurer {
  const unitsPerPx = 0.5;
  return (text: string, fontPx: number) => text.length * fontPx * unitsPerPx;
}

describe('text.layout', () => {
  test('TC-07 short single line in auto mode: width = measured line + padding, height one line', () => {
    const measure = fakeMeasurer();
    const result = layoutText('Went well', 'M', 'auto', null, measure);
    const lineWidth = measure('Went well', TEXT_SIZES.M);
    expect(result.lines).toEqual(['Went well']);
    expect(result.width).toBeGreaterThan(lineWidth);
    expect(result.width).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD);
    // Padding is a small constant per side; width must stay close to the line.
    expect(result.width - lineWidth).toBeLessThanOrEqual(lineWidth * 0.5);
    expect(result.height).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });

  test('TC-08 line wider than the max auto width is capped and word-wrapped', () => {
    const measure = fakeMeasurer();
    const fontPx = TEXT_SIZES.M;
    // 90 characters → 900 world units; two words of 440 and 450 units.
    const line = 'a'.repeat(44) + ' ' + 'b'.repeat(45);
    expect(measure(line, fontPx)).toBe(900);
    const result = layoutText(line, 'M', 'auto', null, measure);
    expect(result.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(result.lines.length).toBe(2);
    expect(result.lines[0]).toBe('a'.repeat(44));
    expect(result.lines[1]).toBe('b'.repeat(45));
    expect(result.height).toBe(2 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });

  test('TC-09 line measuring exactly the max auto width stays one line at exactly 600', () => {
    const measure = fakeMeasurer();
    const fontPx = TEXT_SIZES.M;
    const line = 'a'.repeat(Math.round(TEXT_MAX_AUTO_WIDTH_WORLD / (fontPx * 0.5)));
    expect(measure(line, fontPx)).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    const result = layoutText(line, 'M', 'auto', null, measure);
    expect(result.lines.length).toBe(1);
    expect(result.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(result.height).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });

  test('TC-10 fixed width at the minimum wraps one word per line', () => {
    const measure = fakeMeasurer();
    // 'aaa bbb ccc' at M: each word is 3 chars × 20 × 0.5 = 30 units.
    const result = layoutText('aaa bbb ccc', 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, measure);
    expect(result.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(result.lines).toEqual(['aaa', 'bbb', 'ccc']);
    expect(result.height).toBe(3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });

  test('TC-11 explicit newlines: width = longest line, height = line count × size × line height', () => {
    const measure = fakeMeasurer();
    const text = 'a longer line\nshort\nmid line here';
    const result = layoutText(text, 'L', 'auto', null, measure);
    const longest = measure('mid line here', TEXT_SIZES.L);
    expect(result.lines).toEqual(['a longer line', 'short', 'mid line here']);
    expect(result.width).toBeGreaterThan(longest);
    expect(result.height).toBe(3 * TEXT_SIZES.L * TEXT_LINE_HEIGHT);
    const fixed = layoutText(text, 'S', 'fixed', 250, measure);
    expect(fixed.lines).toEqual(['a longer line', 'short', 'mid line here']);
    expect(fixed.width).toBe(250);
    expect(fixed.height).toBe(3 * TEXT_SIZES.S * TEXT_LINE_HEIGHT);
  });

  test('TC-32 createCanvasMeasurer falls back to an estimate without canvas and never throws', () => {
    const measure = createCanvasMeasurer();
    expect(typeof measure('hello', 20)).toBe('number');
    expect(Number.isFinite(measure('hello', 20))).toBe(true);
    expect(measure('', 20)).toBe(0);
    expect(measure('hello', 20)).toBe(measure('hello', 20));
    // Wider text measures wider.
    expect(measure('hello world, a longer sentence', 20)).toBeGreaterThan(measure('hi', 20));
    // Per-character scaling at a fixed px.
    expect(measure('hh', 20)).toBeCloseTo(measure('h', 20) * 2, 5);
  });
});
