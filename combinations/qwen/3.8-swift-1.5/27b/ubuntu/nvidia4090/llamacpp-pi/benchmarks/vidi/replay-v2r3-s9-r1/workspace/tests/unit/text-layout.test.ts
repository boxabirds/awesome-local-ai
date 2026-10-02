import { describe, it, expect } from 'vitest';
import { layoutText, createCanvasMeasurer, type Measurer } from '../../src/client/objects/textLayout';
import {
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
} from '../../src/shared/config';

/**
 * A deterministic fake measurer: each character is `unitsPerChar` world units
 * wide at the given font size. This makes wrapping and width calculations
 * fully predictable.
 */
function makeFakeMeasurer(unitsPerChar: number): Measurer {
  return (text: string, _fontPx: number) => {
    return text.length * unitsPerChar;
  };
}

/**
 * A measurer where each word has a known width. Words are separated by spaces.
 * The space itself has `spaceWidth` units.
 */
function makeWordMeasurer(wordWidth: number, spaceWidth: number): Measurer {
  return (text: string, _fontPx: number) => {
    if (text.length === 0) return 0;
    const words = text.split(' ');
    let total = 0;
    for (let i = 0; i < words.length; i++) {
      total += words[i].length * wordWidth;
      if (i < words.length - 1) total += spaceWidth;
    }
    return total;
  };
}

describe('text.layout', () => {
  // TC-07: 'Went well' at M in auto mode → width = measured line + padding, height one line
  describe('TC-07: auto width for short text', () => {
    it('width equals measured line width, height is one line', () => {
      const measure = makeFakeMeasurer(10); // each char = 10 units
      // "Went well" is 9 chars → 90 units
      const result = layoutText('Went well', 'M', 'auto', null, measure);
      expect(result.width).toBe(90);
      expect(result.height).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
      expect(result.lines).toEqual(['Went well']);
    });
  });

  // TC-08: line measuring 900 → width TEXT_MAX_AUTO_WIDTH_WORLD, wraps to 2+ lines
  describe('TC-08: auto width wraps beyond max', () => {
    it('clamps width to TEXT_MAX_AUTO_WIDTH_WORLD and wraps', () => {
      // Use a measurer where each char is 10 units. A 90-char line = 900 units.
      const measure = makeFakeMeasurer(10);
      // Create a line of 90 single chars with no spaces (one "word" of 90 chars)
      // That measures 900 units > 600 max.
      const longLine = 'a'.repeat(90);
      const result = layoutText(longLine, 'M', 'auto', null, measure);
      expect(result.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
      // Should wrap into multiple lines
      expect(result.lines.length).toBeGreaterThan(1);
      expect(result.height).toBe(result.lines.length * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    });

    it('wraps a line of words that exceeds max width', () => {
      // Each word is 5 chars × 10 units = 50 units, space = 10 units
      // 600 / (50 + 10) ≈ 10 words per line
      const measure = makeWordMeasurer(10, 10); // char=10, space=10
      // 20 words of 5 chars each: "aaaaa aaaaa aaaaa ..."
      const words = Array(20).fill('aaaaa').join(' ');
      const result = layoutText(words, 'M', 'auto', null, measure);
      expect(result.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
      expect(result.lines.length).toBeGreaterThan(1);
      // Total height = lines × size × lineHeight
      expect(result.height).toBe(result.lines.length * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    });
  });

  // TC-09: line measuring exactly 600 → one line, width 600 (boundary)
  describe('TC-09: line exactly at max auto width', () => {
    it('one line, width exactly TEXT_MAX_AUTO_WIDTH_WORLD', () => {
      // 60 chars × 10 units = 600 units = exactly TEXT_MAX_AUTO_WIDTH_WORLD
      const measure = makeFakeMeasurer(10);
      const line = 'a'.repeat(60);
      const result = layoutText(line, 'M', 'auto', null, measure);
      expect(result.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
      expect(result.lines).toEqual([line]);
      expect(result.height).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    });
  });

  // TC-10: fixed width TEXT_MIN_WIDTH_WORLD with 3 words → wraps per word
  describe('TC-10: fixed width wrapping', () => {
    it('wraps words to fit fixed width', () => {
      // Fixed width = 40. Each word = 3 chars × 10 = 30 units. Space = 10.
      // "abc def ghi" → "abc" = 30, "abc " = 40 (exactly fits), "abc de" = 50 (too wide)
      // So each word gets its own line since "abc " = 40 and adding "def" would be 70
      const measure = makeWordMeasurer(10, 10);
      const result = layoutText('abc def ghi', 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, measure);
      expect(result.width).toBe(TEXT_MIN_WIDTH_WORLD);
      // "abc" = 30 fits in 40, "abc def" = 70 doesn't fit → each word on its own line
      expect(result.lines).toEqual(['abc', 'def', 'ghi']);
      expect(result.height).toBe(3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    });
  });

  // TC-11: text with explicit newlines → width = longest line, height = line count × size × lineHeight
  describe('TC-11: explicit newlines', () => {
    it('width is the longest line, height accounts for all lines', () => {
      const measure = makeFakeMeasurer(10);
      // "Hello" = 50, "World!" = 60, "Hi" = 20
      const text = 'Hello\nWorld!\nHi';
      const result = layoutText(text, 'M', 'auto', null, measure);
      expect(result.width).toBe(60); // "World!" is longest
      expect(result.lines).toEqual(['Hello', 'World!', 'Hi']);
      expect(result.height).toBe(3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    });
  });

  // TC-32: createCanvasMeasurer in an environment without canvas → estimate fallback
  describe('TC-32: canvas measurer fallback', () => {
    it('createCanvasMeasurer does not throw in jsdom (no canvas)', () => {
      expect(() => createCanvasMeasurer()).not.toThrow();
    });

    it('returns a function that produces positive widths for non-empty text', () => {
      const measure = createCanvasMeasurer();
      const w = measure('Hello', 20);
      expect(w).toBeGreaterThan(0);
    });

    it('returns 0 for empty text', () => {
      const measure = createCanvasMeasurer();
      expect(measure('', 20)).toBe(0);
    });
  });

  // Additional edge cases
  describe('edge cases', () => {
    it('empty text → width 0, height 0 (or one line)', () => {
      const measure = makeFakeMeasurer(10);
      const result = layoutText('', 'M', 'auto', null, measure);
      expect(result.width).toBe(0);
      // Height should be at least one line for the cursor
      expect(result.height).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
      expect(result.lines).toEqual(['']);
    });

    it('single character', () => {
      const measure = makeFakeMeasurer(10);
      const result = layoutText('A', 'S', 'auto', null, measure);
      expect(result.width).toBe(10);
      expect(result.height).toBe(TEXT_SIZES.S * TEXT_LINE_HEIGHT);
    });

    it('fixed width larger than content → no wrapping', () => {
      const measure = makeFakeMeasurer(10);
      // "Hi" = 20 units, fixed width = 200
      const result = layoutText('Hi', 'M', 'fixed', 200, measure);
      expect(result.width).toBe(200);
      expect(result.lines).toEqual(['Hi']);
    });
  });
});
