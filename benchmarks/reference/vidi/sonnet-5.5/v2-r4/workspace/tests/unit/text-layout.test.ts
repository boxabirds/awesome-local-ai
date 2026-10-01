import { describe, expect, it } from 'vitest';
import {
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_PADDING_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';
import { createCanvasMeasurer, layoutText, type Measurer } from '../../src/client/objects/textLayout';

/** Deterministic: every character is `perChar` world units wide whatever the font size. */
const fake = (perChar: number): Measurer => (text) => text.length * perChar;
const M = TEXT_SIZES.M;
const line = M * TEXT_LINE_HEIGHT;

describe('text.layout', () => {
  it('TC-07 short text: width is the measured line plus padding, one line high', () => {
    const r = layoutText('Went well', 'M', 'auto', null, fake(10));
    expect(r.width).toBe(90 + TEXT_PADDING_WORLD);
    expect(r.height).toBeCloseTo(line);
    expect(r.lines).toEqual(['Went well']);
  });

  it('TC-08 a line of 900 wraps greedily into two lines at the maximum width', () => {
    const text = `${'a'.repeat(44)} ${'b'.repeat(45)}`; // 90 chars * 10 = 900
    const r = layoutText(text, 'M', 'auto', null, fake(10));
    expect(r.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(r.lines).toHaveLength(2);
    expect(r.height).toBeCloseTo(2 * line);
  });

  it('TC-09 a line of exactly 600 stays on one line at width 600', () => {
    const r = layoutText('a'.repeat(60), 'M', 'auto', null, fake(10));
    expect(r.lines).toHaveLength(1);
    expect(r.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    const over = layoutText('a'.repeat(61), 'M', 'auto', null, fake(10));
    expect(over.lines.length).toBeGreaterThan(1);
  });

  it('TC-10 fixed minimum width puts three words on three lines', () => {
    const r = layoutText('one two six', 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, fake(10));
    expect(r.lines.map((l) => l.trim())).toEqual(['one', 'two', 'six']);
    expect(r.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(r.height).toBeCloseTo(3 * line);
  });

  it('TC-11 explicit newlines: width is the longest line, height counts every line', () => {
    const r = layoutText('ab\nabcdef\n\nabc', 'L', 'auto', null, fake(10));
    expect(r.lines).toEqual(['ab', 'abcdef', '', 'abc']);
    expect(r.width).toBe(60 + TEXT_PADDING_WORLD);
    expect(r.height).toBeCloseTo(4 * TEXT_SIZES.L * TEXT_LINE_HEIGHT);
  });

  it('a single word wider than the width is split by character', () => {
    const r = layoutText('abcdefghij', 'M', 'fixed', 40, fake(10));
    expect(r.lines).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('empty text is one line high', () => {
    const r = layoutText('', 'S', 'auto', null, fake(10));
    expect(r.lines).toEqual(['']);
    expect(r.height).toBeCloseTo(TEXT_SIZES.S * TEXT_LINE_HEIGHT);
  });

  it('TC-32 the canvas measurer falls back to an estimate when there is no canvas', () => {
    const measure = createCanvasMeasurer();
    const w = measure('Went well', 20);
    expect(Number.isFinite(w)).toBe(true);
    expect(w).toBeGreaterThan(0);
    expect(measure('', 20)).toBe(0);
    expect(() => layoutText('hello world', 'XL', 'auto', null, measure)).not.toThrow();
  });
});
