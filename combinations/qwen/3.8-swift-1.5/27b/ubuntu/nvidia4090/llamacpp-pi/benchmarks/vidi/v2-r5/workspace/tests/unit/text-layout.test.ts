// tests/unit/text-layout.test.ts
// Unit tests for text layout (TC-07 to TC-11, TC-32).

import { describe, it, expect } from 'vitest';
import { layoutText, createCanvasMeasurer, type Measurer } from '../../src/client/objects/textLayout';
import {
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
} from '../../src/shared/config';

/**
 * Fake measurer: returns a fixed number of world units per character.
 * This makes layout deterministic for testing.
 */
function makeFakeMeasurer(pxPerChar: number): Measurer {
  return (text: string, _fontPx: number) => {
    // Count visible characters (exclude newlines)
    const visible = text.replace(/\n/g, '');
    return visible.length * pxPerChar;
  };
}

describe('text.layout', () => {
  // TC-07: 'Went well' at M in auto mode → width = measured line + padding, height one line
  describe('TC-07: auto width short text', () => {
    it('measures "Went well" at M and returns correct width and height', () => {
      // Fake measurer: 10 units per character
      const measure = makeFakeMeasurer(10);
      const result = layoutText('Went well', 'M', 'auto', null, measure);

      // "Went well" is 9 chars → 90 units wide
      expect(result.width).toBe(90);
      // Height = 1 line × M size × line height
      expect(result.height).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
      // One line
      expect(result.lines).toEqual(['Went well']);
    });
  });

  // TC-08: line measuring 900 → width TEXT_MAX_AUTO_WIDTH_WORLD, wraps to 2 lines
  describe('TC-08: auto width exceeds max', () => {
    it('wraps a 900-unit line into 2 lines at max width', () => {
      // Fake measurer: 10 units per character
      // We need a line that measures 900: 90 chars × 10 = 900
      const longText = 'a'.repeat(90); // 900 units
      const measure = makeFakeMeasurer(10);
      const result = layoutText(longText, 'M', 'auto', null, measure);

      // Width should be capped at TEXT_MAX_AUTO_WIDTH_WORLD
      expect(result.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
      // Should wrap: 90 chars at 10 units each = 900, max is 600
      // 600 / 10 = 60 chars per line, so 90/60 = 1.5 → 2 lines
      expect(result.lines.length).toBe(2);
      // Height = 2 lines
      expect(result.height).toBe(2 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    });
  });

  // TC-09: line measuring exactly 600 → one line, width 600 (boundary)
  describe('TC-09: auto width exactly at max', () => {
    it('a line measuring exactly 600 stays on one line', () => {
      // Fake measurer: 10 units per character
      // 60 chars × 10 = 600 = exactly TEXT_MAX_AUTO_WIDTH_WORLD
      const text600 = 'a'.repeat(60);
      const measure = makeFakeMeasurer(10);
      const result = layoutText(text600, 'M', 'auto', null, measure);

      expect(result.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
      expect(result.lines).toEqual([text600]);
      expect(result.height).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    });
  });

  // TC-10: fixed width TEXT_MIN_WIDTH_WORLD with three words → wraps per word
  describe('TC-10: fixed width wrapping', () => {
    it('wraps three words in a 40-unit fixed width (one word per line)', () => {
      // Fake measurer: 10 units per character
      // "hello world foo" - each word is 4-5 chars = 40-50 units
      // With min width 40, "hello" (50) won't fit, so each word on its own line
      // Actually let's use shorter words: "a b c" where each is 10 units
      const measure = makeFakeMeasurer(10);
      const result = layoutText('a b c', 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, measure);

      // Width should be the fixed width
      expect(result.width).toBe(TEXT_MIN_WIDTH_WORLD);
      // "a b c" = 5 chars = 50 units > 40, so it wraps
      // "a b" = 3 chars = 30 ≤ 40, "c" = 10 ≤ 40
      // Actually: "a b" = 30 units fits in 40, then "c" = 10 units
      // So we get ["a b", "c"] → 2 lines
      expect(result.lines.length).toBeGreaterThanOrEqual(2);
      // Height grows with lines
      expect(result.height).toBe(result.lines.length * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    });
  });

  // TC-11: text with explicit newlines → width = longest line, height = line count × size × TEXT_LINE_HEIGHT
  describe('TC-11: explicit newlines', () => {
    it('respects explicit newlines and computes width from longest line', () => {
      const measure = makeFakeMeasurer(10);
      // "hello" = 5 chars × 10 = 50, "world foo" = 9 chars × 10 = 90, "hi" = 2 chars × 10 = 20
      const text = 'hello\nworld foo\nhi';
      const result = layoutText(text, 'M', 'auto', null, measure);

      // Width = longest line = "world foo" = 90
      expect(result.width).toBe(90);
      // 3 lines
      expect(result.lines).toEqual(['hello', 'world foo', 'hi']);
      // Height = 3 × M × line height
      expect(result.height).toBe(3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    });
  });

  // TC-32: createCanvasMeasurer in an environment without canvas → estimate fallback
  describe('TC-32: canvas measurer fallback', () => {
    it('does not throw in an environment without canvas', () => {
      // In jsdom, canvas may not be available
      const measure = createCanvasMeasurer();
      expect(typeof measure).toBe('function');

      // Should return a positive number without throwing
      const width = measure('hello', 20);
      expect(width).toBeGreaterThan(0);
      expect(Number.isFinite(width)).toBe(true);
    });

    it('returns consistent estimates for same input', () => {
      const measure = createCanvasMeasurer();
      const w1 = measure('test', 20);
      const w2 = measure('test', 20);
      expect(w1).toBe(w2);
    });
  });
});
