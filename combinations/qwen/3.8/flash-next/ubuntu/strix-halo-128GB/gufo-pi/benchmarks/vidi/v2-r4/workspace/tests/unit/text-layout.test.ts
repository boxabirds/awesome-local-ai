import { describe, expect, it } from 'vitest';
import {
  layoutText,
  createCanvasMeasurer,
} from '../../src/client/objects/textLayout';
import {
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
} from '../../src/shared/config';

/**
 * A fake measurer that produces deterministic widths.
 * Convention: each character at the given font size occupies 0.6 * fontPx world units.
 */
function fakeMeasurer(text: string, fontPx: number): number {
  return text.length * fontPx * 0.6;
}

describe('text.layout — layoutText auto mode', () => {
  it('TC-07: "Went well" at M produces width = measured line, height = one line', () => {
    const text = 'Went well';
    const result = layoutText(text, 'M', 'auto', null, fakeMeasurer);
    const expectedWidth = fakeMeasurer(text, TEXT_SIZES.M);
    const lineHeight = TEXT_SIZES.M * TEXT_LINE_HEIGHT;
    expect(result.width).toBeCloseTo(expectedWidth, 0);
    expect(result.height).toBeCloseTo(lineHeight, 1);
    expect(result.lines).toEqual(['Went well']);
  });

  it('TC-08: line measuring 900 at M wraps to width TEXT_MAX_AUTO_WIDTH_WORLD, 2 lines', () => {
    // Construct a text whose single-line measurement exceeds 600.
    // At M (20px), each char = 12 world units. 600 / 12 = 50 chars per line.
    // So 60 chars will exceed 600: 60 * 12 = 720 > 600.
    const word = 'a'.repeat(30);
    const text = `${word} ${word}`; // 61 chars including space
    const singleLineWidth = fakeMeasurer(text, TEXT_SIZES.M); // 61 * 12 = 732 > 600
    expect(singleLineWidth).toBeGreaterThan(TEXT_MAX_AUTO_WIDTH_WORLD);

    const result = layoutText(text, 'M', 'auto', fakeMeasurer === fakeMeasurer ? null : null, fakeMeasurer);
    expect(result.width).toBeCloseTo(TEXT_MAX_AUTO_WIDTH_WORLD, 0);
    expect(result.lines.length).toBe(2);
    expect(result.height).toBeCloseTo(2 * TEXT_SIZES.M * TEXT_LINE_HEIGHT, 1);
  });

  it('TC-09: line measuring exactly 600 stays one line, width = 600 (boundary)', () => {
    // At M (20px), each char = 12 world units. 600 / 12 = 50 chars = exactly 600.
    const text = 'a'.repeat(50);
    const singleLineWidth = fakeMeasurer(text, TEXT_SIZES.M);
    expect(singleLineWidth).toBeCloseTo(TEXT_MAX_AUTO_WIDTH_WORLD, 0);

    const result = layoutText(text, 'M', 'auto', null, fakeMeasurer);
    expect(result.width).toBeCloseTo(TEXT_MAX_AUTO_WIDTH_WORLD, 0);
    expect(result.lines).toHaveLength(1);
    expect(result.height).toBeCloseTo(TEXT_SIZES.M * TEXT_LINE_HEIGHT, 1);
  });

  it('TC-11: multi-line text (explicit newlines) → width = longest line, height = lines × size × lineHeight', () => {
    const text = 'Hi\nLonger line here\nBye';
    const result = layoutText(text, 'M', 'auto', null, fakeMeasurer);
    const lines = text.split('\n');
    const longest = lines.reduce((a, b) => a.length >= b.length ? a : b, '');
    const expectedWidth = fakeMeasurer(longest, TEXT_SIZES.M);
    expect(result.width).toBeCloseTo(expectedWidth, 0);
    expect(result.height).toBeCloseTo(3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT, 1);
    expect(result.lines).toEqual(lines);
  });
});

describe('text.layout — layoutText fixed mode', () => {
  it('TC-10: fixed width at TEXT_MIN_WIDTH_WORLD with three words wraps one word per line', () => {
    // Three words: "one two three"
    // At M (20px), each char = 12 world units. TEXT_MIN_WIDTH_WORLD = 40.
    // "one" = 3 chars = 36 < 40 → fits on one line
    // "one two" = 7 chars = 84 > 40 → must wrap
    // So "one" fits on line 1, "two" fits on line 2, "three" = 5 chars = 60 > 40 → must be on its own line too
    // Actually "two" = 3 chars = 36 < 40, so "two" fits on line 2
    // "three" = 5 chars = 60 > 40, so it must be on its own line
    const text = 'one two three';
    const result = layoutText(text, 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, fakeMeasurer);
    expect(result.width).toBe(TEXT_MIN_WIDTH_WORLD);
    // Each word that fits (≤40 units) gets its own line; "three" (60>40) can't fit either but goes alone
    expect(result.lines.length).toBe(3);
    expect(result.height).toBeCloseTo(3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT, 1);
  });

  it('fixed width that can hold multiple words groups them', () => {
    // "Hi there" at M: 8 chars * 12 = 96. Fixed width 100 → fits on one line
    const result = layoutText('Hi there', 'M', 'fixed', 100, fakeMeasurer);
    expect(result.width).toBe(100);
    expect(result.lines).toEqual(['Hi there']);
  });
});

describe('text.layout — createCanvasMeasurer fallback', () => {
  it('TC-32: in an environment without canvas, returns an estimate without throwing', () => {
    // In node environment, OffscreenCanvas and document.createElement('canvas') are unavailable
    const measure = createCanvasMeasurer();
    // Should not throw and should return a positive number
    const result = measure('hello', 20);
    expect(result).toBeGreaterThan(0);
    expect(Number.isFinite(result)).toBe(true);
    // Longer text should produce wider result
    expect(measure('hello world', 20)).toBeGreaterThan(result);
  });
});
