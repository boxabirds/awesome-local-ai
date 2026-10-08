/**
 * Story 9, text layout unit tests (design TC-07 to TC-11, TC-32).
 *
 * The "grow-then-wrap" layout is a pure function of (text, size, mode,
 * measurer), so it is tested with a deterministic fake measurer
 * (proportional to the font size, additive over characters — the properties
 * the greedy word wrap relies on): 10 world units per character at M (20px).
 */
import { describe, expect, it } from 'vitest';
import {
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';
import {
  createCanvasMeasurer,
  estimateTextWidth,
  layoutText,
  type Measurer,
} from '../../src/client/objects/textLayout';

/** 10 world units per character at M (20px); scales linearly with the size. */
const fake: Measurer = (text, fontPx) => text.length * (fontPx / 2);

const LINE_M = TEXT_SIZES.M * TEXT_LINE_HEIGHT; // 26 world units

describe('text layout (design text.wrap / text.sizes)', () => {
  it('TC-07: a short line keeps its measured width: "Went well" → 90, one line', () => {
    const layout = layoutText('Went well', 'M', 'auto', null, fake);
    expect(layout.width).toBe(90); // measured width, no padding
    expect(layout.lines).toEqual(['Went well']);
    expect(layout.height).toBe(LINE_M); // one line: 20 x 1.3
  });

  it('TC-08: a line measured 900 wider than the 600 cap wraps into two lines; width caps at 600', () => {
    const line = 'word '.repeat(18); // 90 chars → measured 900 at M
    expect(line).toHaveLength(90);
    const layout = layoutText(line, 'M', 'auto', null, fake);
    expect(layout.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(layout.lines).toHaveLength(2);
    expect(layout.height).toBe(2 * LINE_M);
  });

  it('TC-09: a line measured exactly 600 fits on one line; width is exactly 600', () => {
    const line = 'ab'.repeat(30); // 60 chars → measured exactly 600 at M; no break opportunities
    const layout = layoutText(line, 'M', 'auto', null, fake);
    expect(layout.width).toBe(600);
    expect(layout.lines).toEqual([line]);
    expect(layout.height).toBe(LINE_M);
  });

  it('TC-10: fixed TEXT_MIN_WIDTH_WORLD wraps one word per line; height = 3 lines; width stays 40', () => {
    const layout = layoutText('abc def ghi', 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, fake);
    expect(layout.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(layout.lines).toEqual(['abc', 'def', 'ghi']);
    expect(layout.height).toBe(3 * LINE_M);
  });

  it('TC-11: explicit newlines create independent lines; width = the longest one; height = 3 lines', () => {
    const layout = layoutText('aa\nbb\nccc', 'M', 'auto', null, fake);
    expect(layout.lines).toEqual(['aa', 'bb', 'ccc']);
    expect(layout.width).toBe(30); // "ccc" is the longest pre-wrap line
    expect(layout.height).toBe(3 * LINE_M);
  });

  it('sizes change the box: the same text at S/M/L/XL keeps its width ratio and line height', () => {
    const text = 'Went well';
    for (const size of ['S', 'M', 'L', 'XL'] as const) {
      const layout = layoutText(text, size, 'auto', null, fake);
      expect(layout.width).toBe(text.length * (TEXT_SIZES[size] / 2));
      expect(layout.height).toBe(TEXT_SIZES[size] * TEXT_LINE_HEIGHT);
    }
  });

  it('empty text: zero width, one line of height (the caret still has a line)', () => {
    const layout = layoutText('', 'M', 'auto', null, fake);
    expect(layout.width).toBe(0);
    expect(layout.lines).toEqual(['']);
    expect(layout.height).toBe(LINE_M);
  });

  it('TC-32: the canvas measurer falls back to the glyph estimate when 2d measurement is unavailable (no throw)', () => {
    const measure = createCanvasMeasurer();
    // Deterministic estimate: char count x font size x ratio.
    expect(measure('hello', 20)).toBe(estimateTextWidth('hello', 20));
    expect(estimateTextWidth('hello', 20)).toBe(5 * 20 * 0.55);
    expect(measure('', 20)).toBe(0);
    expect(Number.isFinite(measure('still fine', 56))).toBe(true);
    // Layout still works with the estimated measurer.
    const layout = layoutText('Went well', 'M', 'auto', null, measure);
    expect(layout.lines).toEqual(['Went well']);
    expect(layout.height).toBe(LINE_M);
  });
});
