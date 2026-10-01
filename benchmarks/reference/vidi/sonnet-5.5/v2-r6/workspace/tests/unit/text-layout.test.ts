import { describe, expect, it } from 'vitest';
import { createCanvasMeasurer, layoutText, type Measurer } from '../../src/client/objects/textLayout';
import {
  TEXT_LINE_HEIGHT, TEXT_MAX_AUTO_WIDTH_WORLD, TEXT_MIN_WIDTH_WORLD, TEXT_PADDING_WORLD, TEXT_SIZES,
} from '../../src/shared/config';

/** 10 world units per character at every size, so widths are easy to reason about. */
const tenPerChar: Measurer = (t) => t.length * 10;
const lineHeight = (size: keyof typeof TEXT_SIZES) => TEXT_SIZES[size] * TEXT_LINE_HEIGHT;

describe('layoutText', () => {
  it('TC-07 a short line is as wide as the words plus padding, one line high', () => {
    const r = layoutText('Went well', 'M', 'auto', null, tenPerChar);
    expect(r.width).toBe(90 + TEXT_PADDING_WORLD);
    expect(r.height).toBeCloseTo(lineHeight('M'));
    expect(r.lines).toEqual(['Went well']);
  });

  it('TC-08 a line of 900 wraps at the maximum auto width into two lines', () => {
    const r = layoutText(`${'a'.repeat(44)} ${'b'.repeat(44)}`, 'M', 'auto', null, tenPerChar); // 89 chars = 890 wide
    expect(r.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(r.lines).toHaveLength(2);
    expect(r.height).toBeCloseTo(2 * lineHeight('M'));
  });

  it('TC-09 a line of exactly 600 stays on one line at width 600', () => {
    const r = layoutText('x'.repeat(60), 'M', 'auto', null, tenPerChar);
    expect(r.lines).toHaveLength(1);
    expect(r.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
  });

  it('TC-10 a fixed width of 40 puts three words on three lines', () => {
    const r = layoutText('one two six', 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, tenPerChar);
    expect(r.lines).toEqual(['one', 'two', 'six']);
    expect(r.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(r.height).toBeCloseTo(3 * lineHeight('M'));
  });

  it('TC-11 explicit newlines: width is the longest line, height is lines x size x line height', () => {
    const r = layoutText('ab\nabcdef\nabc', 'L', 'auto', null, tenPerChar);
    expect(r.lines).toEqual(['ab', 'abcdef', 'abc']);
    expect(r.width).toBe(60 + TEXT_PADDING_WORLD);
    expect(r.height).toBeCloseTo(3 * TEXT_SIZES.L * TEXT_LINE_HEIGHT);
  });

  it('breaks a word wider than the width by character', () => {
    const r = layoutText('abcdefgh', 'M', 'fixed', 50, tenPerChar);
    expect(r.lines).toEqual(['abcde', 'fgh']);
  });

  it('empty text is one line high', () => {
    const r = layoutText('', 'S', 'auto', null, tenPerChar);
    expect(r.lines).toEqual(['']);
    expect(r.height).toBeCloseTo(lineHeight('S'));
  });

  it('TC-32 without a canvas the measurer estimates by character count and does not throw', () => {
    const measure = createCanvasMeasurer();
    expect(() => measure('hello', 20)).not.toThrow();
    expect(measure('hello', 20)).toBeGreaterThan(0);
    expect(measure('hello world', 20)).toBeGreaterThan(measure('hello', 20));
  });
});
