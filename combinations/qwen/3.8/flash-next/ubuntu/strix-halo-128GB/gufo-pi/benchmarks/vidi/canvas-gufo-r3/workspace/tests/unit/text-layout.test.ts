import { describe, it, expect } from 'vitest';
import { layoutText, createCanvasMeasurer, Measurer } from '@client/objects/textLayout';
import {
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
} from '@shared/config';

// Fake measurer: fixed world units per character at each size.
const CHAR_RATIO = 0.5; // width per char = fontPx * 0.5
const fakeMeasure: Measurer = (text, fontPx) => text.length * fontPx * CHAR_RATIO;

function lineHeight(size: 'S' | 'M' | 'L' | 'XL'): number {
  return Math.ceil(TEXT_SIZES[size] * TEXT_LINE_HEIGHT);
}

describe('text layout (text.layout)', () => {
  it('TC-07: auto mode, "Went well" at M -> width = measured + padding-free, height one line', () => {
    const { width, height } = layoutText('Went well', 'M', 'auto', null, fakeMeasure);
    // 'Went well' = 9 chars * 20 * 0.5 = 90
    expect(width).toBe(90);
    expect(height).toBe(lineHeight('M')); // one line
  });

  it('TC-08: line measuring 900 -> width TEXT_MAX_AUTO_WIDTH_WORLD, greedy wrap to 2 lines', () => {
    // two 45-char words; combined > 600, each half fits
    const word = 'a'.repeat(45);
    const text = `${word} ${word}`; // length 91 chars
    const { width, height, lines } = layoutText(text, 'M', 'auto', null, fakeMeasure);
    expect(width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(lines.length).toBe(2);
    expect(height).toBe(2 * lineHeight('M'));
  });

  it('TC-09: line exactly 600 wide -> one line, width 600 (boundary)', () => {
    // 60 chars at M with ratio 0.5 -> 600 exactly
    const text = 'a'.repeat(60);
    const { width, lines } = layoutText(text, 'M', 'auto', null, fakeMeasure);
    expect(width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(lines.length).toBe(1);
  });

  it('TC-10: fixed width TEXT_MIN_WIDTH_WORLD with three words -> one word per line, height grows', () => {
    // 'aaaa bbbb cccc': each 4-char word = 40 wide fits; joining exceeds 40
    const { width, height, lines } = layoutText('aaaa bbbb cccc', 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, fakeMeasure);
    expect(width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(lines.length).toBe(3);
    expect(height).toBe(3 * lineHeight('M'));
  });

  it('TC-11: explicit newlines -> width = longest line, height = lines * size * TEXT_LINE_HEIGHT', () => {
    const text = 'aaaaa\na\naaaaaaaaaa'; // longest = 10 chars -> 100 at M
    const { width, height } = layoutText(text, 'M', 'auto', null, fakeMeasure);
    expect(width).toBe(100);
    expect(height).toBe(3 * lineHeight('M'));
  });

  it('TC-32: createCanvasMeasurer falls back to estimate when canvas is unavailable, no throw', () => {
    // In node/jsdom without canvas, the measurer must estimate and not throw.
    const measure = createCanvasMeasurer();
    expect(() => measure('hello', 20)).not.toThrow();
    const w = measure('hello', 20);
    expect(Number.isFinite(w)).toBe(true);
    expect(w).toBeGreaterThan(0);
  });
});
