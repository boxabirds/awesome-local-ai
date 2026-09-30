import { describe, it, expect } from 'vitest';
import { layoutText, createCanvasMeasurer } from '@client/objects/textLayout';
import {
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
  TEXT_MIN_WIDTH_WORLD,
} from '@shared/config';

// Fake measurer: fixed world units per character at each font size
// At M (20px): 10 units per char → 'hello' = 50 units
// At L (32px): 16 units per char
function fakeMeasurer(text: string, fontPx: number): number {
  // 0.5 ratio: width = text.length * fontPx * 0.5
  return text.length * fontPx * 0.5;
}

describe('text.layout', () => {
  // TC-07: 'Went well' at M in auto mode → width = measured line + padding, height one line
  describe('TC-07: short text auto mode', () => {
    it('measures width of "Went well" at M', () => {
      const text = 'Went well'; // 9 chars
      const fontPx = TEXT_SIZES.M; // 20
      const expectedWidth = fakeMeasurer(text, fontPx); // 9 * 20 * 0.5 = 90
      const result = layoutText(text, 'M', 'auto', null, fakeMeasurer);
      expect(result.width).toBeCloseTo(expectedWidth, 1);
      // Height = 1 line
      expect(result.height).toBeCloseTo(1 * fontPx * TEXT_LINE_HEIGHT, 1);
      expect(result.lines).toEqual(['Went well']);
    });
  });

  // TC-08: line measuring 900 → width TEXT_MAX_AUTO_WIDTH_WORLD, greedy word wrap into 2 lines, height 2 lines
  describe('TC-08: line wider than max auto width', () => {
    it('wraps a line measuring 900 units into 2 lines', () => {
      // At M (20px): each char = 10 units
      // 900 units / 10 = 90 chars → exceeds 600
      // Let's use a string that when measured is > 600 at M
      // Each char = 20 * 0.5 = 10 units. Need > 60 units to exceed 600.
      // 61 chars = 610 units → exceeds 600
      const word1 = 'a'.repeat(35); // 350 units
      const word2 = 'b'.repeat(35); // 350 units (space = 10, so 35+1+35=71 chars = 710)
      const text = `${word1} ${word2}`; // 71 chars, measures 710 → exceeds 600

      const result = layoutText(text, 'M', 'auto', null, fakeMeasurer);
      expect(result.width).toBeCloseTo(TEXT_MAX_AUTO_WIDTH_WORLD, 0);
      expect(result.lines.length).toBe(2);
      expect(result.height).toBeCloseTo(2 * TEXT_SIZES.M * TEXT_LINE_HEIGHT, 1);
    });
  });

  // TC-09: line measuring exactly 600 → one line, width 600 (boundary)
  describe('TC-09: line at exactly max auto width', () => {
    it('line measuring exactly 600 stays as one line', () => {
      // At M: each char = 10 units. 60 chars = 600 units = exactly TEXT_MAX_AUTO_WIDTH_WORLD
      const text = 'x'.repeat(60);
      const result = layoutText(text, 'M', 'auto', null, fakeMeasurer);
      expect(result.width).toBeCloseTo(TEXT_MAX_AUTO_WIDTH_WORLD, 0);
      expect(result.lines.length).toBe(1);
    });
  });

  // TC-10: fixed width TEXT_MIN_WIDTH_WORLD with three words → one word per line, height 3 lines
  describe('TC-10: fixed width forces word wrapping', () => {
    it('3 words each wider than fixed width → one per line', () => {
      // TEXT_MIN_WIDTH_WORLD = 40
      // At M (20px): each char = 10 units. So 4 chars = 40 = exactly min width
      // A 5-char word = 50 units > 40, so it won't fit with another word
      const text = 'hello world again'; // 'hello'=50, ' '=10, 'world'=50, ' '=10, 'again'=50
      // With fixed width 40: 'hello'(50)>40 → alone, 'world'(50)>40 → alone, 'again'(50)>40 → alone
      const result = layoutText(text, 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, fakeMeasurer);
      expect(result.width).toBe(TEXT_MIN_WIDTH_WORLD);
      expect(result.lines.length).toBe(3);
      expect(result.height).toBeCloseTo(3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT, 1);
    });
  });

  // TC-11: text with explicit newlines → width = longest line, height = line count × size × TEXT_LINE_HEIGHT
  describe('TC-11: multi-line text with explicit newlines', () => {
    it('respects newlines, width = longest line', () => {
      const text = 'hi\nlonger line here\nok';
      const result = layoutText(text, 'M', 'auto', null, fakeMeasurer);
      // Lines: 'hi'(20), 'longer line here'(160), 'ok'(20)
      expect(result.lines).toEqual(['hi', 'longer line here', 'ok']);
      expect(result.width).toBeCloseTo(fakeMeasurer('longer line here', TEXT_SIZES.M), 1);
      expect(result.height).toBeCloseTo(3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT, 1);
    });
  });

  // TC-32: createCanvasMeasurer in environment without canvas → estimate fallback, no throw
  describe('TC-32: createCanvasMeasurer fallback', () => {
    it('returns a function that does not throw in jsdom without canvas', () => {
      // In jsdom without node-canvas, createCanvasMeasurer should use fallback
      const measurer = createCanvasMeasurer('Arial, sans-serif');
      expect(typeof measurer).toBe('function');
      // Should return a positive number
      const width = measurer('hello', 20);
      expect(width).toBeGreaterThan(0);
      expect(Number.isFinite(width)).toBe(true);
    });

    it('fallback estimate is roughly proportional to text length', () => {
      const measurer = createCanvasMeasurer();
      const w1 = measurer('a', 20);
      const w2 = measurer('aa', 20);
      expect(w2).toBeCloseTo(w1 * 2, 0);
    });
  });
});
