import { describe, expect, it } from 'vitest';
import { layoutText, createCanvasMeasurer } from '../../src/client/objects/textLayout';
import {
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
} from '../../src/shared/config';

/**
 * A fake measurer that returns a deterministic width:
 * each character occupies exactly 10px at font size 20 (M).
 * We parameterize per font-size for flexibility.
 */
function fakeMeasurer(perChar: number = 10): (text: string, fontPx: number) => number {
  return (text: string, fontPx: number) => {
    // Scale perChar relative to M size (20px) as baseline
    const scale = fontPx / TEXT_SIZES.M;
    return text.length * perChar * scale;
  };
}

describe('text layout (TC-07 to TC-11, TC-32)', () => {
  describe('TC-07 "Went well" at M in auto mode', () => {
    it('width = measured line, height = one line', () => {
      const text = 'Went well';
      const { width, height } = layoutText(text, 'M', 'auto', null, fakeMeasurer());
      // "Went well" is 9 chars, each 10px at scale 1 (fontPx=20, baseline=20)
      const expectedWidth = 9 * 10;
      expect(width).toBeCloseTo(expectedWidth, 1);
      // Height = 1 line × font size × line height
      const expectedHeight = TEXT_SIZES.M * TEXT_LINE_HEIGHT;
      expect(height).toBeCloseTo(expectedHeight, 1);
    });
  });

  describe('TC-08 line measuring 900 wraps', () => {
    it('width capped at TEXT_MAX_AUTO_WIDTH_WORLD, text wraps to 2+ lines', () => {
      // 90 chars with spaces that exceed max auto width
      const words = Array(18).fill('AAAAAAAAAA'); // 18 × 10 chars = 180 chars
      const text = words.join(' ');
      const { width, height } = layoutText(text, 'M', 'auto', null, fakeMeasurer());
      // Width should not exceed max auto width
      expect(width).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD);
      // Should be multiple lines since words need to wrap
      const lineHeight = TEXT_SIZES.M * TEXT_LINE_HEIGHT;
      const heightLines = height / lineHeight;
      expect(heightLines).toBeGreaterThan(1);
    });
  });

  describe('TC-09 line measuring exactly 600', () => {
    it('one line, width 600 (boundary)', () => {
      // 60 chars at 10px = 600 = exactly max
      const text = 'B'.repeat(60);
      const { width, height } = layoutText(text, 'M', 'auto', null, fakeMeasurer());
      expect(width).toBeCloseTo(TEXT_MAX_AUTO_WIDTH_WORLD, 1);
      // Should be one line (fits exactly)
      const expectedHeight = TEXT_SIZES.M * TEXT_LINE_HEIGHT;
      expect(height).toBeCloseTo(expectedHeight, 1);
    });
  });

  describe('TC-10 fixed width TEXT_MIN_WIDTH_WORLD', () => {
    it('three words → one word per line, height 3 lines', () => {
      // 3 words that each need more than one-third of the width
      // At minimum width, assume one word per line if they don't fit
      // Using long words to force one-per-line
      const text = 'Extraordinarily Large Word';
      const { width, height } = layoutText(text, 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, fakeMeasurer());
      expect(width).toBe(TEXT_MIN_WIDTH_WORLD);
      // Each word alone exceeds the width → each on its own line
      const words = text.split(' ');
      expect(height).toBeGreaterThanOrEqual(words.length * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    });
  });

  describe('TC-11 text with explicit newlines', () => {
    it('width = longest line, height = line count × size × lineHeight', () => {
      const text = 'Hi\nLonger line here\nBye';
      const { width, height } = layoutText(text, 'M', 'auto', null, fakeMeasurer());
      // "Longer line here" is 16 chars → 160px width
      const longest = 'Longer line here';
      expect(width).toBeCloseTo(longest.length * 10, 1);
      // 3 lines
      const lines = text.split('\n');
      expect(height).toBeCloseTo(lines.length * TEXT_SIZES.M * TEXT_LINE_HEIGHT, 1);
    });
  });

  describe('TC-32 createCanvasMeasurer in jsdom (no canvas)', () => {
    it('does not throw, returns a function', () => {
      // jsdom has no OffscreenCanvas, but may have a canvas element without context
      const measure = createCanvasMeasurer();
      expect(typeof measure).toBe('function');
      // Should return a number (either from canvas or fallback)
      const result = measure('hello', 20);
      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThan(0);
    });
  });

  describe('edge cases', () => {
    it('empty string returns minimum reasonable box', () => {
      const { width, height } = layoutText('', 'M', 'auto', null, fakeMeasurer());
      expect(width).toBeGreaterThan(0);
      expect(height).toBeGreaterThan(0);
    });

    it('fixed width that exceeds auto max still uses fixed', () => {
      const text = 'Hello';
      const { width } = layoutText(text, 'M', 'fixed', 700, fakeMeasurer());
      expect(width).toBe(700);
    });

    it('single character in auto mode', () => {
      const { width, height } = layoutText('X', 'M', 'auto', null, fakeMeasurer());
      // Width should be at least the minimum (TEXT_SIZES.M * AVG_GLYPH_RATIO = 11)
      expect(width).toBeGreaterThanOrEqual(10);
      expect(height).toBeCloseTo(TEXT_SIZES.M * TEXT_LINE_HEIGHT, 1);
    });
  });
});