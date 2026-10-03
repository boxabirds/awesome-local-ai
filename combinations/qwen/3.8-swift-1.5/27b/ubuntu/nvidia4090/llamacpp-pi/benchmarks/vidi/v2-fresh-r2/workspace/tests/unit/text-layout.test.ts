/**
 * Unit tests for the pure text layout (text.layout contract).
 * TC-07 to TC-11, TC-32, with a deterministic fake measurer:
 * 10 world units per non-space character.
 */
import { describe, it, expect } from 'vitest';
import { layoutText, createCanvasMeasurer, type Measurer } from '../../src/client/objects/textLayout';
import {
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
} from '../../src/shared/config';

/** Deterministic fake measurer: 10 world units per non-space character. */
const fakeMeasure: Measurer = (text: string) => text.replace(/ /g, '').length * 10;

/** N distinct two-letter words joined by single spaces. */
function words(n: number, base = 'a'): string {
  return Array.from({ length: n }, (_, i) => `${base}${String.fromCharCode(98 + i)}`).join(' ');
}

/** 'abcd efgh ijkl …' — n distinct 4-letter words. */
function words4(n: number): string {
  return Array.from({ length: n }, (_, i) =>
    String.fromCharCode(97 + i) + 'bcd',
  ).join(' ');
}

const M_LINE = TEXT_SIZES.M * TEXT_LINE_HEIGHT; // 26

describe('text.layout', () => {
  // TC-07: 'Went well' at M in auto mode → width = measured line, height
  // one line.
  it('TC-07: a short line yields its measured width and one line of height', () => {
    const layout = layoutText('Went well', 'M', 'auto', null, fakeMeasure);
    expect(layout.width).toBe(80); // 8 non-space chars × 10 (design's "90" was illustrative)
    expect(layout.height).toBeCloseTo(M_LINE, 10);
    expect(layout.lines).toEqual(['Went well']);
  });

  // TC-08: a line measuring 900 → width TEXT_MAX_AUTO_WIDTH_WORLD, greedy
  // word wrap into 2 lines, height 2 lines.
  it('TC-08: a 900-wide line wraps at the max auto width', () => {
    const line = words(45); // 90 non-space chars → measures 900
    expect(fakeMeasure(line, TEXT_SIZES.M)).toBe(900);

    const layout = layoutText(line, 'M', 'auto', null, fakeMeasure);
    expect(layout.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(layout.lines).toHaveLength(2);
    expect(layout.height).toBeCloseTo(2 * M_LINE, 10);
    // Every wrapped line fits the max width.
    for (const l of layout.lines) {
      expect(fakeMeasure(l, TEXT_SIZES.M)).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD);
    }
    // The words are preserved in order.
    expect(layout.lines.join(' ')).toBe(line);
  });

  // TC-09: a line measuring exactly 600 → one line, width 600 (boundary).
  it('TC-09: a line measuring exactly the max stays one line', () => {
    const line = words(30); // 60 non-space chars → measures exactly 600
    expect(fakeMeasure(line, TEXT_SIZES.M)).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);

    const layout = layoutText(line, 'M', 'auto', null, fakeMeasure);
    expect(layout.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(layout.lines).toEqual([line]);
    expect(layout.height).toBeCloseTo(M_LINE, 10);
  });

  // TC-10: fixed width TEXT_MIN_WIDTH_WORLD with three words → one word per
  // line, height 3 lines (boundary).
  it('TC-10: fixed minimum width wraps one word per line', () => {
    const line = words4(3); // each 4-letter word measures exactly 40
    const layout = layoutText(line, 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, fakeMeasure);
    expect(layout.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(layout.lines).toHaveLength(3);
    for (const l of layout.lines) {
      expect(fakeMeasure(l, TEXT_SIZES.M)).toBe(TEXT_MIN_WIDTH_WORLD);
    }
    expect(layout.lines.join(' ')).toBe(line);
    expect(layout.height).toBeCloseTo(3 * M_LINE, 10);
  });

  // TC-11: explicit newlines → width = longest line, height = line count ×
  // size × TEXT_LINE_HEIGHT.
  it('TC-11: explicit newlines are respected', () => {
    const layout = layoutText('abc\nabcd', 'M', 'auto', null, fakeMeasure);
    expect(layout.lines).toEqual(['abc', 'abcd']);
    expect(layout.width).toBe(40); // longest line 'abcd'
    expect(layout.height).toBeCloseTo(2 * M_LINE, 10);

    // A blank middle line counts as a line.
    const withBlank = layoutText('a\n\nc', 'S', 'auto', null, fakeMeasure);
    expect(withBlank.lines).toEqual(['a', '', 'c']);
    expect(withBlank.height).toBeCloseTo(3 * TEXT_SIZES.S * TEXT_LINE_HEIGHT, 10);
  });

  // Empty text: zero width, one line of height (never a zero-height box).
  it('empty text lays out to zero width and one line of height', () => {
    const layout = layoutText('', 'M', 'auto', null, fakeMeasure);
    expect(layout.width).toBe(0);
    expect(layout.height).toBeCloseTo(M_LINE, 10);
    expect(layout.lines).toEqual(['']);
  });

  // TC-32: createCanvasMeasurer in an environment without canvas → estimate
  // fallback, no throw (error path).
  it('TC-32: createCanvasMeasurer falls back to an estimate without canvas', () => {
    // jsdom has no canvas 2d context: the measurer must not throw and must
    // return a positive, deterministic estimate.
    const measure = createCanvasMeasurer();
    expect(() => measure('hello world', 20)).not.toThrow();
    const w = measure('hello world', 20);
    expect(w).toBeGreaterThan(0);
    expect(Number.isFinite(w)).toBe(true);
    // Longer text measures wider; larger font measures wider.
    expect(measure('a much longer piece of text', 20)).toBeGreaterThan(w);
    expect(measure('hello world', 40)).toBeGreaterThan(w);
  });
});
