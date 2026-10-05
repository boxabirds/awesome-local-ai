import { describe, it, expect } from 'vitest';
import {
  layoutText,
  createCanvasMeasurer,
  type Measurer,
} from '../../src/client/objects/textLayout';
import {
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
} from '../../src/shared/config';

/**
 * Fake measurer: each character is `fontPx * 0.6` wide (same as AVG_GLYPH_RATIO).
 * So "abc" at font size 20 measures 3 * 20 * 0.6 = 36.
 */
const fakeMeasure: Measurer = (text, fontPx) => text.length * fontPx * 0.6;

describe('text layout', () => {
  // TC-07: 'Went well' at M in auto mode → width = measured, height one line.
  it('TC-07 short text auto mode', () => {
    const result = layoutText('Went well', 'M', 'auto', null, fakeMeasure);
    const expectedWidth = 'Went well'.length * TEXT_SIZES.M * 0.6; // 9 * 20 * 0.6 = 108
    expect(result.width).toBeCloseTo(expectedWidth);
    expect(result.height).toBeCloseTo(TEXT_SIZES.M * TEXT_LINE_HEIGHT); // 26
    expect(result.lines).toEqual(['Went well']);
  });

  // TC-08: line measuring 900 → width TEXT_MAX_AUTO_WIDTH_WORLD, wraps to 2 lines, height 2 lines.
  it('TC-08 line wider than max auto width', () => {
    // Create a string long enough to measure > 600 at size M.
    // Each char at M = 20*0.6 = 12 units. Need > 600/12 = 50 chars.
    // Use two words of 30 chars each separated by space = 61 chars → 732 units > 600.
    const word = 'a'.repeat(30);
    const text = `${word} ${word}`;
    const result = layoutText(text, 'M', 'auto', null, fakeMeasure);
    expect(result.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(result.lines.length).toBe(2);
    expect(result.height).toBeCloseTo(2 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });

  // TC-09: line exactly 600 → one line, width 600 (boundary).
  it('TC-09 line exactly at max auto width', () => {
    // At size M, each char = 12 units. 600/12 = 50 chars exactly.
    const text = 'a'.repeat(50);
    const result = layoutText(text, 'M', 'auto', null, fakeMeasure);
    expect(result.width).toBe(600);
    expect(result.lines.length).toBe(1);
    expect(result.height).toBeCloseTo(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });

  // TC-10: fixed width TEXT_MIN_WIDTH_WORLD with three words → one word per line, height 3 lines.
  it('TC-10 fixed width wraps to one word per line', async () => {
    const { TEXT_MIN_WIDTH_WORLD } = await import('../../src/shared/config');
    // At size M, each char = 12 units. "ab" = 24, "ab ab ab" = 8*12=96. Fixed width = 40.
    // Each "ab" is 24 which fits in 40, but "ab ab" is 60 > 40 so wraps.
    const text = 'ab ab ab';
    const result = layoutText(text, 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, fakeMeasure);
    expect(result.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(result.lines.length).toBe(3);
    expect(result.height).toBeCloseTo(3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });

  // TC-11: text with explicit newlines → width = longest line, height = lines × size × LINE_HEIGHT.
  it('TC-11 multi-line text with explicit newlines', () => {
    const text = 'hi\nhello world\nok';
    const result = layoutText(text, 'M', 'auto', null, fakeMeasure);
    // Lines: 'hi'(2), 'hello world'(11), 'ok'(2)
    // Width = max of: 2*12=24, 11*12=132, 2*12=24 → 132
    expect(result.width).toBe(132);
    expect(result.lines.length).toBe(3);
    expect(result.height).toBeCloseTo(3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });

  // TC-32: createCanvasMeasurer in jsdom without canvas → estimate, no throw.
  it('TC-32 createCanvasMeasurer fallback estimate', () => {
    // In jsdom, there is no OffscreenCanvas and canvas.getContext returns null.
    const measurer = createCanvasMeasurer();
    // Should not throw and return a reasonable number.
    const width = measurer('hello', 20);
    expect(typeof width).toBe('number');
    expect(width).toBeGreaterThan(0);
    // Fallback: 5 * 20 * 0.6 = 60
    expect(width).toBeCloseTo(60);
  });
});
