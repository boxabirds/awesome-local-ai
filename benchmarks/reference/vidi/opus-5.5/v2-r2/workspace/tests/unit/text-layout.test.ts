import { describe, expect, it } from 'vitest';
import {
  TEXT_ESTIMATE_GLYPH_WIDTH_RATIO,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';
import {
  type Measurer,
  TEXT_BOX_PADDING_WORLD,
  createCanvasMeasurer,
  layoutText,
} from '../../src/client/objects/textLayout';

/** Deterministic fake: half the font size per character (10 units per character at M). */
const fake: Measurer = (text, fontPx) => text.length * fontPx * 0.5;
const LINE_M = TEXT_SIZES.M * TEXT_LINE_HEIGHT;

describe('text.layout layoutText', () => {
  it('TC-07 "Went well" measured 90 at M → width 90 + padding, one line', () => {
    expect(fake('Went well', TEXT_SIZES.M)).toBe(90);
    const box = layoutText('Went well', 'M', 'auto', null, fake);
    expect(box.width).toBe(90 + TEXT_BOX_PADDING_WORLD);
    expect(box.height).toBeCloseTo(LINE_M);
    expect(box.lines).toEqual(['Went well']);
  });

  it('TC-08 a line measuring 900 → width TEXT_MAX_AUTO_WIDTH_WORLD, wraps to 2 lines', () => {
    const text = `${'x'.repeat(59)} ${'y'.repeat(30)}`;
    expect(fake(text, TEXT_SIZES.M)).toBe(900);
    const box = layoutText(text, 'M', 'auto', null, fake);
    expect(box.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(box.lines).toEqual([`${'x'.repeat(59)} `, 'y'.repeat(30)]);
    expect(box.height).toBeCloseTo(2 * LINE_M);
  });

  it('TC-09 a line measuring exactly 600 → one line, width 600', () => {
    const text = `${'a'.repeat(30)} ${'b'.repeat(29)}`;
    expect(fake(text, TEXT_SIZES.M)).toBe(600);
    const box = layoutText(text, 'M', 'auto', null, fake);
    expect(box.lines).toHaveLength(1);
    expect(box.width).toBe(600);
    expect(box.height).toBeCloseTo(LINE_M);
  });

  it('just over the maximum wraps', () => {
    const text = `${'a'.repeat(30)} ${'b'.repeat(30)}`;
    expect(layoutText(text, 'M', 'auto', null, fake).lines).toHaveLength(2);
  });

  it('TC-10 fixed TEXT_MIN_WIDTH_WORLD with three words → one word per line, height 3 lines', () => {
    const box = layoutText('ab cd ef', 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, fake);
    expect(box.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(box.lines.map((l) => l.trim())).toEqual(['ab', 'cd', 'ef']);
    expect(box.height).toBeCloseTo(3 * LINE_M);
  });

  it('fixed width: a word wider than the box breaks between characters', () => {
    const box = layoutText('abcdefghij', 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, fake);
    expect(box.lines).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('TC-11 explicit newlines → width = longest line, height = lines × size × TEXT_LINE_HEIGHT', () => {
    const box = layoutText('To improve\nab\n\nabcdef', 'L', 'auto', null, fake);
    expect(box.lines).toEqual(['To improve', 'ab', '', 'abcdef']);
    expect(box.width).toBe(fake('To improve', TEXT_SIZES.L) + TEXT_BOX_PADDING_WORLD);
    expect(box.height).toBeCloseTo(4 * TEXT_SIZES.L * TEXT_LINE_HEIGHT);
  });

  it('empty text is one empty line', () => {
    const box = layoutText('', 'S', 'auto', null, fake);
    expect(box.lines).toEqual(['']);
    expect(box.height).toBeCloseTo(TEXT_SIZES.S * TEXT_LINE_HEIGHT);
    expect(box.width).toBe(TEXT_BOX_PADDING_WORLD);
  });

  it('size changes the line height and the measured width', () => {
    const m = layoutText('Went well', 'M', 'auto', null, fake);
    const xl = layoutText('Went well', 'XL', 'auto', null, fake);
    expect(xl.width).toBeGreaterThan(m.width);
    expect(xl.height).toBeCloseTo(TEXT_SIZES.XL * TEXT_LINE_HEIGHT);
  });

  it('TC-32 without a canvas the measurer estimates by character count and never throws', () => {
    const measure = createCanvasMeasurer();
    expect(() => measure('Went well', TEXT_SIZES.M)).not.toThrow();
    expect(measure('Went well', TEXT_SIZES.M)).toBeCloseTo(9 * TEXT_SIZES.M * TEXT_ESTIMATE_GLYPH_WIDTH_RATIO);
    const box = layoutText('Went well', 'M', 'auto', null, measure);
    expect(box.width).toBeGreaterThan(0);
  });
});
