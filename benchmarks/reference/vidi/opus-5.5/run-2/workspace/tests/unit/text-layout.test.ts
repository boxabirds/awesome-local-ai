/** Story 9 text.layout unit tests (TC-07 to TC-11, TC-32) with a deterministic fake measurer. */
import { describe, expect, it } from 'vitest';
import { createCanvasMeasurer, estimateMeasurer, layoutText, type Measurer } from '../../src/client/objects/textLayout';
import {
  TEXT_AUTO_WIDTH_PADDING_WORLD,
  TEXT_AVG_GLYPH_WIDTH_RATIO,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';

/** Every character is half the font size wide: 10 world units at M (20). */
const fake: Measurer = (text, fontPx) => (text.length * fontPx) / 2;
const LINE_M = TEXT_SIZES.M * TEXT_LINE_HEIGHT;

describe('text.layout', () => {
  it('TC-07 "Went well" measured 90 at M → width 90 + padding, one line high', () => {
    expect(fake('Went well', TEXT_SIZES.M)).toBe(90);
    const box = layoutText('Went well', 'M', 'auto', null, fake);
    expect(box.width).toBe(90 + TEXT_AUTO_WIDTH_PADDING_WORLD);
    expect(box.lines).toEqual(['Went well']);
    expect(box.height).toBeCloseTo(LINE_M);
  });

  it('TC-08 a line measuring 900 → width TEXT_MAX_AUTO_WIDTH_WORLD, wrapped into 2 lines', () => {
    const text = `${'a'.repeat(44)} ${'b'.repeat(45)}`;
    expect(fake(text, TEXT_SIZES.M)).toBe(900);
    const box = layoutText(text, 'M', 'auto', null, fake);
    expect(box.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(box.lines).toEqual([`${'a'.repeat(44)} `, 'b'.repeat(45)]);
    expect(box.height).toBeCloseTo(2 * LINE_M);
  });

  it('TC-09 a line measuring exactly 600 → one line, width 600', () => {
    const text = `${'a'.repeat(29)} ${'b'.repeat(30)}`;
    expect(fake(text, TEXT_SIZES.M)).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    const box = layoutText(text, 'M', 'auto', null, fake);
    expect(box.lines).toHaveLength(1);
    expect(box.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    // One more character wraps.
    expect(layoutText(`${text}b`, 'M', 'auto', null, fake).lines).toHaveLength(2);
  });

  it('TC-10 fixed width TEXT_MIN_WIDTH_WORLD with three words → one word per line', () => {
    const box = layoutText('one two six', 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, fake);
    expect(box.lines.map((l) => l.trim())).toEqual(['one', 'two', 'six']);
    expect(box.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(box.height).toBeCloseTo(3 * LINE_M);
    // A single word wider than the line breaks between characters.
    expect(layoutText('abcdefghij', 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, fake).lines).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('TC-11 explicit newlines: width = longest line, height = lines × size × TEXT_LINE_HEIGHT', () => {
    const box = layoutText('ab\nabcdef\n\nabc', 'L', 'auto', null, fake);
    expect(box.lines).toEqual(['ab', 'abcdef', '', 'abc']);
    expect(box.width).toBe(fake('abcdef', TEXT_SIZES.L) + TEXT_AUTO_WIDTH_PADDING_WORLD);
    expect(box.height).toBeCloseTo(4 * TEXT_SIZES.L * TEXT_LINE_HEIGHT);
  });

  it('empty text is one (caret) line high', () => {
    const box = layoutText('', 'XL', 'auto', null, fake);
    expect(box.lines).toEqual(['']);
    expect(box.height).toBeCloseTo(TEXT_SIZES.XL * TEXT_LINE_HEIGHT);
  });

  it('TC-32 without a canvas the measurer falls back to the character-count estimate', () => {
    expect(typeof OffscreenCanvas).toBe('undefined');
    const measure = createCanvasMeasurer();
    expect(() => measure('Went well', TEXT_SIZES.M)).not.toThrow();
    expect(measure('Went well', TEXT_SIZES.M)).toBeCloseTo(9 * TEXT_SIZES.M * TEXT_AVG_GLYPH_WIDTH_RATIO);
    expect(measure).toBe(estimateMeasurer);
    const box = layoutText('x'.repeat(300), 'M', 'auto', null, measure);
    expect(box.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(box.lines.length).toBeGreaterThan(1);
  });
});
