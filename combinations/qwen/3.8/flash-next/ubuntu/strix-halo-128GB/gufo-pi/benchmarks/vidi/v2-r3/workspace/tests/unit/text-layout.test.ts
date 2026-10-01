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
 * Fake measurer: 8 world-units per character.
 */
const fakeMeasure: Measurer = (text, _fontPx) => text.length * 8;

describe('text.layout', () => {
  it('TC-07: "Went well" at M in auto mode → width = measured line + padding, height one line', () => {
    const text = 'Went well'; // 9 characters → 9 * 8 = 72
    const result = layoutText(text, 'M', 'auto', null, fakeMeasure);

    // Width should be at least the measured width (72) and less than TEXT_MAX_AUTO_WIDTH_WORLD
    expect(result.width).toBe(72);
    // Height: 1 line × TEXT_SIZES.M × TEXT_LINE_HEIGHT
    const expectedHeight = Math.round(1 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    expect(result.height).toBeCloseTo(expectedHeight, 0);
    expect(result.lines).toEqual(['Went well']);
  });

  it('TC-08: line measuring 900 → width TEXT_MAX_AUTO_WIDTH_WORLD, greedy word wrap into 2 lines, height 2 lines', () => {
    // Create text where one line would measure > 600 (75+ chars at 8 units each)
    // A word of 40 chars = 320 units, two words = 640 > 600, so it wraps into 2 lines
    const word40 = 'A'.repeat(40); // 320 units
    const text = word40 + ' ' + word40; // 81 chars → 648 total; greedy wraps to 2 lines

    const result = layoutText(text, 'M', 'auto', null, fakeMeasure);

    expect(result.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(result.lines.length).toBe(2);
    const expectedHeight = Math.round(2 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    expect(result.height).toBeCloseTo(expectedHeight, 0);
  });

  it('TC-09: line measuring exactly 600 → one line, width 600 (boundary)', () => {
    // 75 characters × 8 = 600 (exactly at the max)
    const text = 'A'.repeat(75);
    const result = layoutText(text, 'M', 'auto', null, fakeMeasure);

    expect(result.width).toBe(600);
    expect(result.lines.length).toBe(1);
  });

  it('TC-10: fixed width TEXT_MIN_WIDTH_WORLD with three words → one word per line, height 3 lines', () => {
    // Each word of 4 chars = 32 units; space = 8 units. "AAAA BBBB CCCC" total = 120 but fixed width is 40
    // With fixed width 40, "AAAA" (32) fits but "AAAA " (40) doesn't fit another word (8 more), so one per line
    const text = 'AAAA BBBB CCCC'; // each word is 4 chars × 8 = 32; space is 8 units
    const result = layoutText(text, 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, fakeMeasure);

    expect(result.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(result.lines.length).toBe(3);
    const expectedHeight = Math.round(3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    expect(result.height).toBeCloseTo(expectedHeight, 0);
  });

  it('TC-11: text with explicit newlines → width = longest line, height = line count × size × TEXT_LINE_HEIGHT', () => {
    const text = 'Hi\nHello World\nOK'; // longest is "Hello World" = 11 chars × 8 = 88
    const result = layoutText(text, 'S', 'auto', null, fakeMeasure);

    expect(result.width).toBe(88);
    expect(result.lines.length).toBe(3);
    const expectedHeight = Math.round(3 * TEXT_SIZES.S * TEXT_LINE_HEIGHT);
    expect(result.height).toBeCloseTo(expectedHeight, 0);
  });

  it('TC-32: createCanvasMeasurer in environment without canvas → estimate fallback, no throw (error path)', () => {
    // In jsdom, canvas is not available; the measurer should estimate
    const measurer = createCanvasMeasurer();
    expect(() => {
      const width = measurer('hello', 20);
      expect(width).toBeGreaterThan(0);
      expect(Number.isFinite(width)).toBe(true);
    }).not.toThrow();
  });
});
