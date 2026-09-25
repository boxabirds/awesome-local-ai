import { describe, expect, it } from 'vitest';
import {
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_PADDING_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';
import { createCanvasMeasurer, estimateMeasurer, layoutText, type Measurer } from '../../src/client/objects/textLayout';

/** Deterministic fake: every character is 10 world units wide at size M, scaled with the font size. */
const PER_CHAR_AT_M = 10;
const fake: Measurer = (text, fontPx) => text.length * PER_CHAR_AT_M * (fontPx / TEXT_SIZES.M);
const lineM = TEXT_SIZES.M * TEXT_LINE_HEIGHT;

describe('layoutText', () => {
  it('TC-07 a short line is as wide as its words plus padding, one line high', () => {
    const r = layoutText('Went well', 'M', 'auto', null, fake);
    expect(fake('Went well', TEXT_SIZES.M)).toBe(90);
    expect(r.width).toBe(90 + TEXT_PADDING_WORLD);
    expect(r.height).toBeCloseTo(lineM);
    expect(r.lines).toEqual(['Went well']);
  });

  it('TC-08 a line measuring 900 wraps at the maximum auto width into 2 lines', () => {
    // 18 words of 4 letters + space: 90 characters = 900 units.
    const text = Array.from({ length: 18 }, () => 'abcd').join(' ');
    expect(fake(text, TEXT_SIZES.M)).toBe(890);
    const r = layoutText(text + ' ', 'M', 'auto', null, fake);
    expect(r.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(r.lines).toHaveLength(2);
    for (const l of r.lines) expect(fake(l.trimEnd(), TEXT_SIZES.M)).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(r.height).toBeCloseTo(2 * lineM);
    expect(r.lines.join('')).toBe(text + ' ');
  });

  it('TC-09 a line measuring exactly the maximum stays on one line, width = the maximum', () => {
    const text = 'x'.repeat(TEXT_MAX_AUTO_WIDTH_WORLD / PER_CHAR_AT_M);
    const r = layoutText(text, 'M', 'auto', null, fake);
    expect(r.lines).toEqual([text]);
    expect(r.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    const over = layoutText(text + 'x', 'M', 'auto', null, fake);
    expect(over.lines).toHaveLength(2);
  });

  it('TC-10 at the minimum fixed width three words go one per line and the height grows', () => {
    const r = layoutText('abc def ghi', 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, fake);
    expect(r.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(r.lines.map((l) => l.trimEnd())).toEqual(['abc', 'def', 'ghi']);
    expect(r.height).toBeCloseTo(3 * lineM);
    // Below the minimum is treated as the minimum.
    expect(layoutText('abc', 'M', 'fixed', 10, fake).width).toBe(TEXT_MIN_WIDTH_WORLD);
  });

  it('a word wider than the line breaks between characters', () => {
    const r = layoutText('abcdefghij', 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, fake);
    expect(r.lines).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('TC-11 explicit newlines: width = longest line, height = line count × size × line height', () => {
    const r = layoutText('Went well\nTo improve\n\nOK', 'L', 'auto', null, fake);
    expect(r.lines).toEqual(['Went well', 'To improve', '', 'OK']);
    expect(r.width).toBe(Math.ceil(fake('To improve', TEXT_SIZES.L) + TEXT_PADDING_WORLD));
    expect(r.height).toBeCloseTo(4 * TEXT_SIZES.L * TEXT_LINE_HEIGHT);
  });

  it('empty text is one empty line', () => {
    const r = layoutText('', 'M', 'auto', null, fake);
    expect(r.lines).toEqual(['']);
    expect(r.width).toBe(TEXT_PADDING_WORLD);
    expect(r.height).toBeCloseTo(lineM);
  });

  it('TC-32 without a canvas the measurer falls back to the character estimate and never throws', () => {
    let measure!: Measurer;
    expect(() => (measure = createCanvasMeasurer())).not.toThrow();
    expect(measure('Went well', 20)).toBe(estimateMeasurer('Went well', 20));
    expect(measure('Went well', 20)).toBeGreaterThan(0);
    expect(() => layoutText('Went well', 'M', 'auto', null, measure)).not.toThrow();
  });
});
