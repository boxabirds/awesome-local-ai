import { describe, it, expect } from 'vitest';
import { createCanvasMeasurer, layoutText, type Measurer } from '../../src/client/objects/textLayout';
import {
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_LINE_HEIGHT,
  TEXT_SIZES,
  TEXT_PADDING_X_WORLD,
  TEXT_AVG_GLYPH_WIDTH_RATIO,
} from '../../src/shared/config';

/**
 * Deterministic fake measurer: fontPx / 2 world units per character.
 * At size M (20px) that is 10 units per character, so 'Went well' measures 90.
 */
const fake: Measurer = (text, fontPx) => text.length * (fontPx / 2);

const LINE_M = TEXT_SIZES.M * TEXT_LINE_HEIGHT; // one line at M

describe('text layout (story 9)', () => {
  // TC-07
  it('TC-07: short line in auto mode → width = measured + padding, height one line', () => {
    const result = layoutText('Went well', 'M', 'auto', null, fake);
    expect(result.lines).toEqual(['Went well']);
    expect(result.width).toBe(90 + TEXT_PADDING_X_WORLD);
    expect(result.height).toBe(LINE_M);
  });

  // TC-08
  it('TC-08: line measuring ~900 wraps at the max auto width, 2 lines, width capped', () => {
    // 60 chars (600 units) + space + 29 chars (290 units) = 900 units total.
    const line = 'a'.repeat(60) + ' ' + 'b'.repeat(29);
    expect(fake(line, TEXT_SIZES.M)).toBe(900);
    const result = layoutText(line, 'M', 'auto', null, fake);
    expect(result.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(result.lines).toHaveLength(2);
    expect(result.height).toBe(2 * LINE_M);
    // First wrapped line is the 60-char word (measures exactly the cap)
    expect(fake(result.lines[0], TEXT_SIZES.M)).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
  });

  // TC-09
  it('TC-09: line measuring exactly the max auto width stays one line, width = max (boundary)', () => {
    const line = 'c'.repeat(60); // 600 units at M
    expect(fake(line, TEXT_SIZES.M)).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    const result = layoutText(line, 'M', 'auto', null, fake);
    expect(result.lines).toEqual([line]);
    expect(result.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(result.height).toBe(LINE_M);
  });

  // TC-10
  it('TC-10: fixed minimum width with three words → one word per line, height grows', () => {
    const text = 'abcde fghij klmno'; // each word measures 50 > 40 at M
    const result = layoutText(text, 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, fake);
    expect(result.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(result.lines).toEqual(['abcde', 'fghij', 'klmno']);
    expect(result.height).toBe(3 * LINE_M);
  });

  // TC-11
  it('TC-11: explicit newlines → width = longest line, height = lines × size × line height', () => {
    const result = layoutText('abc\ndefg', 'M', 'auto', null, fake);
    expect(result.lines).toEqual(['abc', 'defg']);
    expect(result.width).toBe(40 + TEXT_PADDING_X_WORLD); // 'defg' is longest
    expect(result.height).toBe(2 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });

  it('sizes scale the layout', () => {
    const atS = layoutText('Went well', 'S', 'auto', null, fake);
    const atXL = layoutText('Went well', 'XL', 'auto', null, fake);
    expect(atS.width).toBe(9 * 7 + TEXT_PADDING_X_WORLD); // 14/2 = 7 per char
    expect(atXL.width).toBe(9 * 28 + TEXT_PADDING_X_WORLD); // 56/2 = 28 per char
    expect(atS.height).toBe(TEXT_SIZES.S * TEXT_LINE_HEIGHT);
    expect(atXL.height).toBe(TEXT_SIZES.XL * TEXT_LINE_HEIGHT);
  });

  it('empty text → one (empty) line, minimal box', () => {
    const result = layoutText('', 'M', 'auto', null, fake);
    expect(result.lines).toEqual(['']);
    expect(result.width).toBe(TEXT_PADDING_X_WORLD);
    expect(result.height).toBe(LINE_M);
  });

  it('blank lines are preserved', () => {
    const result = layoutText('a\n\nb', 'M', 'auto', null, fake);
    expect(result.lines).toEqual(['a', '', 'b']);
    expect(result.height).toBe(3 * LINE_M);
  });

  // TC-32
  it('TC-32: createCanvasMeasurer without canvas → estimate fallback, no throw', () => {
    const measure = createCanvasMeasurer();
    // Node/jsdom have no 2d context: estimate = chars × fontPx × ratio
    expect(measure('hello', 20)).toBe(5 * 20 * TEXT_AVG_GLYPH_WIDTH_RATIO);
    expect(measure('', 20)).toBe(0);
    expect(() => createCanvasMeasurer('Inter, system-ui, sans-serif')).not.toThrow();
  });
});
