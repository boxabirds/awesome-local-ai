import { describe, expect, it } from 'vitest';
import { createCanvasMeasurer, layoutText, type Measurer } from '../../src/client/objects/textLayout';
import {
  TEXT_LINE_HEIGHT, TEXT_MAX_AUTO_WIDTH_WORLD, TEXT_MIN_WIDTH_WORLD, TEXT_PADDING_WORLD, TEXT_SIZES,
} from '../../src/shared/config';

/** 10 world units per character at M (20px); scales with the font size. */
const fake: Measurer = (text, fontPx) => text.length * fontPx * 0.5;
const LINE_M = TEXT_SIZES.M * TEXT_LINE_HEIGHT;

describe('layoutText', () => {
  it('TC-07 short line: measured width plus padding, one line', () => {
    const r = layoutText('Went well', 'M', 'auto', null, fake);
    expect(r.width).toBe(90 + TEXT_PADDING_WORLD);
    expect(r.height).toBe(LINE_M);
    expect(r.lines).toEqual(['Went well']);
  });

  it('TC-08 a 900-wide line wraps greedily and the box takes the maximum width', () => {
    const r = layoutText('a'.repeat(44) + ' ' + 'b'.repeat(45), 'M', 'auto', null, fake); // 900 wide
    expect(r.lines).toEqual(['a'.repeat(44) + ' ', 'b'.repeat(45)]);
    expect(r.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(r.height).toBe(2 * LINE_M);
  });

  it('TC-09 a line of exactly the maximum stays on one line at the maximum width', () => {
    const r = layoutText('x'.repeat(60), 'M', 'auto', null, fake); // 600 exactly
    expect(r.lines).toHaveLength(1);
    expect(r.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
  });

  it('TC-10 minimum fixed width puts one word per line', () => {
    const r = layoutText('aaa bbb ccc', 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, fake); // each word 30 wide
    expect(r.lines).toEqual(['aaa ', 'bbb ', 'ccc']);
    expect(r.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(r.height).toBe(3 * LINE_M);
  });

  it('TC-10 fixed width below the minimum is clamped', () => {
    expect(layoutText('a', 'M', 'fixed', 5, fake).width).toBe(TEXT_MIN_WIDTH_WORLD);
  });

  it('TC-11 explicit newlines: width of the longest line, height of all lines', () => {
    const r = layoutText('ab\nabcd\n\nx', 'L', 'auto', null, fake);
    expect(r.lines).toEqual(['ab', 'abcd', '', 'x']);
    expect(r.width).toBe(4 * TEXT_SIZES.L * 0.5 + TEXT_PADDING_WORLD);
    expect(r.height).toBe(4 * TEXT_SIZES.L * TEXT_LINE_HEIGHT);
  });

  it('splits a single over-long word by characters', () => {
    const r = layoutText('x'.repeat(100), 'M', 'fixed', 100, fake);
    expect(r.lines).toHaveLength(10);
  });

  it('empty text is one line tall', () => {
    const r = layoutText('', 'S', 'auto', null, fake);
    expect(r.height).toBe(TEXT_SIZES.S * TEXT_LINE_HEIGHT);
  });
});

describe('createCanvasMeasurer', () => {
  it('TC-32 falls back to an estimate without a canvas and never throws', () => {
    const measure = createCanvasMeasurer();
    const w = measure('hello', 20);
    expect(Number.isFinite(w)).toBe(true);
    expect(w).toBeGreaterThan(0);
  });
});
