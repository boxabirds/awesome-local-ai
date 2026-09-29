import { describe, it, expect } from 'vitest';
import {
  layoutText,
  createCanvasMeasurer,
  TEXT_PADDING_WORLD,
  type Measurer,
} from '@/client/objects/textLayout';
import {
  TEXT_GLYPH_WIDTH_RATIO,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '@/shared/config';

/**
 * Story 9 layout unit tests use a deterministic fake measurer: a fixed
 * number of world units per character, independent of font size — so every
 * expectation below is exact arithmetic.
 */
const W = 10; // world units per character
const fake = (unitsPerChar: number = W): Measurer => (text: string) => text.length * unitsPerChar;

describe('story 9: text layout (text.layout)', () => {
  describe('TC-07: auto mode, single line', () => {
    it('width = measured line + 2 * padding; height one line at the size preset', () => {
      const layout = layoutText('Went well', 'M', 'auto', null, fake());
      const measured = 'Went well'.length * W;
      expect(layout.width).toBe(measured + 2 * TEXT_PADDING_WORLD);
      expect(layout.height).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
      expect(layout.lines).toEqual(['Went well']);
    });
  });

  describe('TC-08: auto mode, line wider than the cap', () => {
    it('caps at TEXT_MAX_AUTO_WIDTH_WORLD and greedy word-wraps into 2 lines', () => {
      // 40 two-letter words: 40*2 + 39 spaces = 119 chars = 1,190 world
      // units — well past the 600 cap. At 600 a line holds 20 words
      // (20*2 + 19 = 59 chars = 590 units).
      const line = Array.from({ length: 40 }, () => 'ab').join(' ');
      const layout = layoutText(line, 'M', 'auto', null, fake());
      expect(layout.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
      expect(layout.lines).toHaveLength(2);
      expect(layout.lines[0]).toBe(Array.from({ length: 20 }, () => 'ab').join(' '));
      expect(layout.lines[1]).toBe(Array.from({ length: 20 }, () => 'ab').join(' '));
      expect(layout.height).toBe(2 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    });

    it('breaks a single word longer than the box character by character', () => {
      // 90 chars = 900 units > 600: 60 per line, then the remaining 30.
      const layout = layoutText('x'.repeat(90), 'M', 'auto', null, fake());
      expect(layout.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
      expect(layout.lines).toEqual(['x'.repeat(60), 'x'.repeat(30)]);
    });
  });

  describe('TC-09: boundary — line measuring exactly the cap', () => {
    it('stays one line at width TEXT_MAX_AUTO_WIDTH_WORLD', () => {
      // 60 chars = 600 units: longest + 2*padding = 608 -> capped to 600;
      // the line still fits (600 <= 600), so no wrap.
      const layout = layoutText('y'.repeat(60), 'M', 'auto', null, fake());
      expect(layout.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
      expect(layout.lines).toEqual(['y'.repeat(60)]);
      expect(layout.height).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    });
  });

  describe('TC-10: fixed mode at the minimum width', () => {
    it('one word per line at TEXT_MIN_WIDTH_WORLD (3 words -> 3 lines)', () => {
      // 'abc' = 30 units fits the 40-unit box; 'abc def' = 70 does not.
      const layout = layoutText('abc def ghi', 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, fake());
      expect(layout.width).toBe(TEXT_MIN_WIDTH_WORLD);
      expect(layout.lines).toEqual(['abc', 'def', 'ghi']);
      expect(layout.height).toBe(3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    });

    it('a non-positive/stale fixed width falls back to the minimum', () => {
      const layout = layoutText('abc def ghi', 'M', 'fixed', -5, fake());
      expect(layout.width).toBe(TEXT_MIN_WIDTH_WORLD);
      const layoutNull = layoutText('abc def ghi', 'M', 'fixed', null, fake());
      expect(layoutNull.width).toBe(TEXT_MIN_WIDTH_WORLD);
    });
  });

  describe('TC-11: explicit newlines', () => {
    it('width follows the longest line; height is line count * size * line height', () => {
      const text = 'short\nlonger line\nok';
      const longest = 'longer line'.length * W;
      const layout = layoutText(text, 'L', 'auto', null, fake());
      expect(layout.width).toBe(longest + 2 * TEXT_PADDING_WORLD);
      expect(layout.lines).toEqual(['short', 'longer line', 'ok']);
      expect(layout.height).toBe(3 * TEXT_SIZES.L * TEXT_LINE_HEIGHT);
    });

    it('an empty line is preserved as a rendered line', () => {
      const layout = layoutText('a\n\nb', 'M', 'auto', null, fake());
      expect(layout.lines).toEqual(['a', '', 'b']);
      expect(layout.height).toBe(3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    });
  });

  describe('empty content', () => {
    it('yields a degenerate 0x0 box with no lines', () => {
      expect(layoutText('', 'M', 'auto', null, fake())).toEqual({ width: 0, height: 0, lines: [] });
      expect(layoutText('', 'M', 'fixed', 100, fake())).toEqual({ width: 0, height: 0, lines: [] });
    });
  });
});

describe('TC-32: createCanvasMeasurer without canvas (error path)', () => {
  it('falls back to the glyph-ratio estimate and never throws', () => {
    const measure = createCanvasMeasurer();
    // This vitest project runs unit tests in node: no document, no
    // OffscreenCanvas — the estimate must be used.
    const w = measure('abcd', 20);
    expect(w).toBe(4 * 20 * TEXT_GLYPH_WIDTH_RATIO);
    expect(measure('', 20)).toBe(0);
  });
});
