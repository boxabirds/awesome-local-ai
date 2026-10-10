import { describe, expect, test } from 'vitest';
import {
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES
} from '../../src/shared/config';
import {
  createCanvasMeasurer,
  layoutText,
  type Measurer
} from '../../src/client/objects/textLayout';

// Deterministic stand-in for canvas measureText: 0.5 * fontPx per character,
// so at size M (20px) one character is 10 world units wide.
const measure: Measurer = (text, fontPx) => text.length * fontPx * 0.5;

function lineHeight(size: keyof typeof TEXT_SIZES): number {
  return TEXT_SIZES[size] * TEXT_LINE_HEIGHT;
}

describe('text.layout', () => {
  test('TC-07 short single line: width is the measured line, height is one line', () => {
    const box = layoutText('Went well', 'M', 'auto', null, measure);
    // 'Went well' = 9 chars * 10 = 90 world units (padding is zero).
    expect(box.width).toBeCloseTo(90, 6);
    expect(box.height).toBeCloseTo(lineHeight('M'), 6);
    expect(box.lines).toEqual(['Went well']);
  });

  test('TC-08 line wider than TEXT_MAX_AUTO_WIDTH_WORLD wraps to two lines', () => {
    // 40 x 'ab' words joined: 119 chars -> 1,190 units; each 20-word line is
    // 59 chars -> 590 <= 600, so greedy wrap yields exactly two lines.
    const sentence = Array(40).fill('ab').join(' ');
    const box = layoutText(sentence, 'M', 'auto', null, measure);
    expect(box.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(box.lines).toHaveLength(2);
    expect(box.height).toBeCloseTo(2 * lineHeight('M'), 6);
  });

  test('TC-09 line of exactly TEXT_MAX_AUTO_WIDTH_WORLD stays on one line', () => {
    const word = 'z'.repeat(60); // 600 units at M
    const box = layoutText(word, 'M', 'auto', null, measure);
    expect(box.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(box.lines).toHaveLength(1);
    expect(box.height).toBeCloseTo(lineHeight('M'), 6);
  });

  test('TC-10 fixed width 40 wraps three words one per line and grows height', () => {
    const box = layoutText('one two three', 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, measure);
    // 'one two' would be 70 units > 40, so every word gets its own line.
    expect(box.lines).toEqual(['one', 'two', 'three']);
    expect(box.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(box.height).toBeCloseTo(3 * lineHeight('M'), 6);
    expect(box.height).toBeGreaterThan(lineHeight('M'));
  });

  test('TC-11 explicit newlines: width is the longest line, height counts lines', () => {
    const box = layoutText('a\nbb\nccc', 'S', 'auto', null, measure);
    // 'a' and 'bb' are shorter than 'ccc'; 'a' measures 7 units.
    expect(box.lines).toEqual(['a', 'bb', 'ccc']);
    expect(box.width).toBeCloseTo(3 * TEXT_SIZES.S * 0.5, 6);
    expect(box.height).toBeCloseTo(3 * lineHeight('S'), 6);
  });

  test('TC-32 without canvas the measurer estimates by character count and never throws', () => {
    const estimate = createCanvasMeasurer();
    expect(() => estimate('hello', 20)).not.toThrow();
    const short = estimate('hello', 20);
    expect(Number.isFinite(short)).toBe(true);
    expect(short).toBeGreaterThan(0);
    expect(estimate('hello hello', 20)).toBeGreaterThan(short);
    // The estimate must scale with font size.
    expect(estimate('hello', 40)).toBeGreaterThan(short);
    // layoutText stays usable with the estimated measurer.
    const box = layoutText('fallback text', 'M', 'auto', null, estimate);
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeCloseTo(lineHeight('M'), 6);
  });
});
