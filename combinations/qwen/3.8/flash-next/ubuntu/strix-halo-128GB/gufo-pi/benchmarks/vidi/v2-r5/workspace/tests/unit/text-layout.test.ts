import { describe, expect, it } from 'vitest';
import {
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
} from '../../src/shared/config';
import { layoutText, createCanvasMeasurer, type Measurer } from '../../src/client/objects/textLayout';

/**
 * Fake measurer: each character is `charWidth` world units at 1px font.
 * At a given fontPx, width = text.length * charWidth * fontPx / 10.
 * So at M (20px), a character is 2 units wide.
 */
const fakeMeasurer = (charWidth: number = 10): Measurer =>
  (text: string, fontPx: number) => text.length * charWidth * (fontPx / 10);

describe('text.layout', () => {
  it('TC-07 "Went well" at M in auto mode → width = measured + padding, height one line', () => {
    const text = 'Went well';
    const measure = fakeMeasurer();
    const result = layoutText(text, 'M', 'auto', null, measure);
    const expectedLineWidth = measure(text, TEXT_SIZES.M);
    expect(result.width).toBeCloseTo(expectedLineWidth, 1);
    expect(result.height).toBeCloseTo(TEXT_SIZES.M * TEXT_LINE_HEIGHT, 1);
    expect(result.lines).toEqual(['Went well']);
  });

  it('TC-08 line measuring >600 → width TEXT_MAX_AUTO_WIDTH_WORLD, wraps to 2 lines, height 2 lines', () => {
    // Use a text that would measure > 600 at M (20px) with our fake measurer
    // At M, each char is 20 world units. 31 chars → 620 > 600
    const text = 'aaaaaaaaaaaaaaaaaaaaa aaaaaaaaaaaaa'; // 21 + 1 space + 15 = 37 chars → 740 units
    const measure = fakeMeasurer();
    const result = layoutText(text, 'M', 'auto', null, measure);
    expect(result.width).toBeCloseTo(TEXT_MAX_AUTO_WIDTH_WORLD, 0);
    expect(result.lines.length).toBeGreaterThanOrEqual(2);
    expect(result.height).toBeCloseTo(result.lines.length * TEXT_SIZES.M * TEXT_LINE_HEIGHT, 1);
  });

  it('TC-09 line measuring exactly 600 → one line, width 600', () => {
    // At M (20px), with fakeMeasurer(10), each char = 20 units. 30 chars = 600 exactly.
    const text = 'a'.repeat(30);
    const measure = fakeMeasurer();
    const result = layoutText(text, 'M', 'auto', null, measure);
    expect(result.width).toBeCloseTo(TEXT_MAX_AUTO_WIDTH_WORLD, 0);
    expect(result.lines).toEqual([text]);
    expect(result.height).toBeCloseTo(TEXT_SIZES.M * TEXT_LINE_HEIGHT, 1);
  });

  it('TC-10 fixed width TEXT_MIN_WIDTH_WORLD with three words → one word per line, height 3 lines', () => {
    // At M (20px), each char = 20 units. "a bb ccc" → widths: 20, 40, 60
    // At fixed width 40 (TEXT_MIN_WIDTH_WORLD): "a" fits (20≤40), "bb" fits (40≤40), "ccc" (60>40) → "ccc" wraps?
    // Actually greedy: take words fitting: "a" fits, "a bb" = 20+20+40 = 80 > 40 → wrap → line 1 "a"
    // Then "bb" fits (40≤40), "bb ccc" = 40+20+60 = 120 > 40 → wrap → line 2 "bb"
    // Then "ccc" = 60 > 40 → put on line anyway → line 3 "ccc"
    const text = 'a bb ccc';
    const measure = fakeMeasurer();
    const result = layoutText(text, 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, measure);
    expect(result.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(result.lines.length).toBeGreaterThanOrEqual(3);
    expect(result.height).toBeCloseTo(result.lines.length * TEXT_SIZES.M * TEXT_LINE_HEIGHT, 1);
  });

  it('TC-11 explicit newlines → width = longest line, height = line count × size × TEXT_LINE_HEIGHT', () => {
    const text = 'short\nlonger line here\nx';
    const measure = fakeMeasurer();
    const result = layoutText(text, 'M', 'auto', null, measure);
    // Lines: "short" (5 chars=100), "longer line here" (17 chars=340), "x" (1 char=20)
    const longestLine = 'longer line here';
    expect(result.width).toBeCloseTo(measure(longestLine, TEXT_SIZES.M), 1);
    expect(result.lines).toEqual(['short', 'longer line here', 'x']);
    expect(result.height).toBeCloseTo(3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT, 1);
  });

  it('TC-32 createCanvasMeasurer in environment without canvas → estimate fallback, no throw', () => {
    // In node/jsdom without canvas, the measurer should still work (estimate)
    const measure = createCanvasMeasurer();
    const width = measure('hello', 20);
    expect(typeof width).toBe('number');
    expect(width).toBeGreaterThan(0);
  });
});
