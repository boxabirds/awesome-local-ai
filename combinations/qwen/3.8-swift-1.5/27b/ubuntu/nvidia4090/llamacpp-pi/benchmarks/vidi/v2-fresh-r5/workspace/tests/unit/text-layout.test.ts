/**
 * Unit tests for text layout (TC-07 to TC-11, TC-32).
 * Uses a deterministic fake measurer (fixed world units per character).
 */
import { describe, it, expect } from 'vitest';
import { layoutText, createCanvasMeasurer, type Measurer } from '../../src/client/objects/textLayout';
import {
  TEXT_SIZES,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_LINE_HEIGHT,
} from '../../src/shared/config';

/**
 * Fake measurer: each character is exactly `unitsPerChar` world units wide.
 */
function fakeMeasurer(unitsPerChar: number): Measurer {
  return (text: string, _fontPx: number): number => {
    return text.length * unitsPerChar;
  };
}

describe('text layout', () => {
  // TC-07: 'Went well' at M in auto mode
  describe('TC-07: short text in auto mode', () => {
    it('width = measured line, height one line', () => {
      // "Went well" is 9 chars. At 10 units/char = 90 world units.
      const measure = fakeMeasurer(10);
      const result = layoutText('Went well', 'M', 'auto', null, measure);

      expect(result.width).toBe(90);
      expect(result.height).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
      expect(result.lines).toEqual(['Went well']);
    });
  });

  // TC-08: line measuring 900 → wraps
  describe('TC-08: line longer than max auto width', () => {
    it('wraps to multiple lines at TEXT_MAX_AUTO_WIDTH_WORLD', () => {
      // Each char is 10 units. Max width = 600. So 60 chars fit per line.
      // Use words: "word" = 4 chars = 40 units, "word " = 5 chars = 50 units
      // 15 words: "word word word ..." = 15*4 + 14 = 74 chars = 740 units > 600
      const measure = fakeMeasurer(10);
      const longText = Array(15).fill('word').join(' '); // 740 units
      const result = layoutText(longText, 'M', 'auto', null, measure);

      expect(result.width).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD);
      expect(result.width).toBeGreaterThan(0);
      expect(result.lines.length).toBeGreaterThan(1);
      expect(result.height).toBe(result.lines.length * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    });

    it('wraps a word-based line correctly', () => {
      // "word " repeated: each "word" is 4 chars = 40 units, space = 10 units
      // So "word word word..." Let's say each word+space = 50 units
      // 600 / 50 = 12 words per line
      const measure = fakeMeasurer(10);
      // 25 words of 4 chars each = "word word word ..." (25*4 + 24 spaces = 124 chars = 1240 units)
      const words = Array(25).fill('word').join(' ');
      const result = layoutText(words, 'M', 'auto', null, measure);

      expect(result.width).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD);
      expect(result.lines.length).toBeGreaterThan(1);
      // Each line should be <= 600 units
      for (const line of result.lines) {
        expect(measure(line, TEXT_SIZES.M)).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD);
      }
    });
  });

  // TC-09: line exactly 600 → one line, width 600
  describe('TC-09: line exactly at max auto width (boundary)', () => {
    it('one line, width exactly TEXT_MAX_AUTO_WIDTH_WORLD', () => {
      // 60 chars × 10 units = 600 units = exactly TEXT_MAX_AUTO_WIDTH_WORLD
      const measure = fakeMeasurer(10);
      const text = 'a'.repeat(60);
      const result = layoutText(text, 'M', 'auto', null, measure);

      expect(result.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
      expect(result.lines).toEqual([text]);
      expect(result.height).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    });
  });

  // TC-10: fixed width TEXT_MIN_WIDTH_WORLD with three words
  describe('TC-10: fixed width with word wrap', () => {
    it('wraps words to fit fixed width', () => {
      // Fixed width = 40. Each char = 10 units. So 4 chars fit per line.
      // "hi hi hi" → "hi" (2 chars = 20), "hi" (20), "hi" (20)
      // With spaces: "hi hi" = 5 chars = 50 > 40, so each word on its own line
      const measure = fakeMeasurer(10);
      const result = layoutText('hi hi hi', 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, measure);

      expect(result.width).toBe(TEXT_MIN_WIDTH_WORLD);
      expect(result.lines.length).toBe(3);
      expect(result.height).toBe(3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    });
  });

  // TC-11: text with explicit newlines
  describe('TC-11: explicit newlines', () => {
    it('width = longest line, height = line count × size × line height', () => {
      const measure = fakeMeasurer(10);
      // "hello" (5 chars = 50) \n "world!" (6 chars = 60) \n "hi" (2 chars = 20)
      const text = 'hello\nworld!\nhi';
      const result = layoutText(text, 'M', 'auto', null, measure);

      expect(result.width).toBe(60); // longest line is "world!" = 60
      expect(result.lines).toEqual(['hello', 'world!', 'hi']);
      expect(result.height).toBe(3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    });
  });

  // TC-32: createCanvasMeasurer in an environment without canvas
  describe('TC-32: createCanvasMeasurer fallback', () => {
    it('returns a working measurer without throwing (jsdom has no canvas)', () => {
      // In jsdom, canvas.getContext('2d') returns null
      const measure = createCanvasMeasurer();
      expect(() => measure('hello', 20)).not.toThrow();
      const result = measure('hello', 20);
      expect(result).toBeGreaterThan(0);
      expect(Number.isFinite(result)).toBe(true);
    });

    it('estimate is proportional to text length', () => {
      const measure = createCanvasMeasurer();
      const short = measure('hi', 20);
      const long = measure('hello world', 20);
      expect(long).toBeGreaterThan(short);
    });
  });
});
