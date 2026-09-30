import { describe, expect, it } from 'vitest';
import {
  TEXT_AVG_GLYPH_WIDTH_RATIO,
  TEXT_CARET_ALLOWANCE_WORLD,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';
import { createCanvasMeasurer, layoutText, type Measurer } from '../../src/client/objects/textLayout';

/** Deterministic fake: every character is half the font size wide (10 units at M). */
const fake: Measurer = (text, fontPx) => text.length * fontPx * 0.5;
const lineHeight = (size: keyof typeof TEXT_SIZES) => TEXT_SIZES[size] * TEXT_LINE_HEIGHT;

describe('text.layout', () => {
  it('TC-07 "Went well" at M (90 wide) → width 90 + caret allowance, one line', () => {
    const box = layoutText('Went well', 'M', 'auto', null, fake);
    expect(fake('Went well', TEXT_SIZES.M)).toBe(90);
    expect(box.width).toBe(90 + TEXT_CARET_ALLOWANCE_WORLD);
    expect(box.lines).toEqual(['Went well']);
    expect(box.height).toBeCloseTo(lineHeight('M'), 9);
  });

  it('TC-08 a line measuring 900 → width TEXT_MAX_AUTO_WIDTH_WORLD, wrapped into 2 lines', () => {
    // 90 words of "abcd " style: 18 words × 5 chars = 90 chars = 900 units at M.
    const words = Array.from({ length: 18 }, () => 'abcd').join(' ') + ' ';
    const text = words.trimEnd() + ' '; // 90 chars
    expect(fake(text, TEXT_SIZES.M)).toBe(900);
    const box = layoutText(text, 'M', 'auto', null, fake);
    expect(box.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(box.lines).toHaveLength(2);
    for (const l of box.lines) expect(fake(l.trimEnd(), TEXT_SIZES.M)).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(box.lines.join('')).toBe(text);
    expect(box.height).toBeCloseTo(2 * lineHeight('M'), 9);
  });

  it('TC-09 a line measuring exactly 600 → one line, width 600 (boundary)', () => {
    const text = 'x'.repeat(60);
    expect(fake(text, TEXT_SIZES.M)).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    const box = layoutText(text, 'M', 'auto', null, fake);
    expect(box.lines).toEqual([text]);
    expect(box.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(box.height).toBeCloseTo(lineHeight('M'), 9);
    // Just under the maximum still grows with the text.
    expect(layoutText('x'.repeat(50), 'M', 'auto', null, fake).width).toBe(500 + TEXT_CARET_ALLOWANCE_WORLD);
  });

  it('TC-10 fixed TEXT_MIN_WIDTH_WORLD with three words → one word per line, height 3 lines', () => {
    const box = layoutText('abc de fgh', 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, fake);
    expect(box.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(box.lines.map((l) => l.trimEnd())).toEqual(['abc', 'de', 'fgh']);
    expect(box.height).toBeCloseTo(3 * lineHeight('M'), 9);
    // Wider fixed width → fewer lines; the width is what was set.
    const wide = layoutText('abc de fgh', 'M', 'fixed', 70, fake);
    expect(wide).toMatchObject({ width: 70 });
    expect(wide.lines.map((l) => l.trimEnd())).toEqual(['abc de', 'fgh']);
  });

  it('a word wider than the width is broken by characters', () => {
    const box = layoutText('abcdefghij', 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, fake);
    expect(box.lines).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('TC-11 explicit newlines: width = longest line, height = line count × size × TEXT_LINE_HEIGHT', () => {
    const box = layoutText('Went well\nPairing\n\nCI', 'L', 'auto', null, fake);
    expect(box.lines).toEqual(['Went well', 'Pairing', '', 'CI']);
    expect(box.width).toBe(fake('Went well', TEXT_SIZES.L) + TEXT_CARET_ALLOWANCE_WORLD);
    expect(box.height).toBeCloseTo(4 * TEXT_SIZES.L * TEXT_LINE_HEIGHT, 9);
  });

  it('empty text is one empty line (the box a new text object starts with)', () => {
    const box = layoutText('', 'M', 'auto', null, fake);
    expect(box).toEqual({ width: TEXT_CARET_ALLOWANCE_WORLD, height: lineHeight('M'), lines: [''] });
  });

  it('size changes recompute the box: XL is wider and taller than M', () => {
    const m = layoutText('Went well', 'M', 'auto', null, fake);
    const xl = layoutText('Went well', 'XL', 'auto', null, fake);
    expect(xl.width).toBeGreaterThan(m.width);
    expect(xl.height).toBeCloseTo(lineHeight('XL'), 9);
  });

  it('TC-32 createCanvasMeasurer without a canvas falls back to the character estimate and never throws', () => {
    expect(typeof document).toBe('undefined');
    const measure = createCanvasMeasurer();
    expect(() => measure('Went well', TEXT_SIZES.M)).not.toThrow();
    expect(measure('Went well', TEXT_SIZES.M)).toBeCloseTo(9 * TEXT_SIZES.M * TEXT_AVG_GLYPH_WIDTH_RATIO, 9);
    const box = layoutText('Went well', 'M', 'auto', null, measure);
    expect(box.width).toBeGreaterThan(0);
  });
});
