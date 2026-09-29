// Story 9 `text.layout` unit cases (TC-07 to TC-11, TC-32): the pure layout maths
// with a deterministic fake measurer, and the createCanvasMeasurer fallback when
// no canvas is available.
//
// The fake measurer returns `text.length * fontPx * 0.5` world units, so a 9-char
// line at size M (20px) measures exactly 90 units. Every expectation below is
// derived from that rule, not hard-coded magic numbers.

import { describe, it, expect } from 'vitest';
import {
  layoutText,
  createCanvasMeasurer,
  type Measurer,
} from '../../src/client/objects/textLayout.ts';
import {
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_LINE_HEIGHT,
  TEXT_SIZES,
  TEXT_FONT_FAMILY,
} from '../../src/shared/config.ts';

// Half the font size per character, in world units.
const fakeMeasure: Measurer = (text, fontPx) => text.length * fontPx * 0.5;

const H = (size: keyof typeof TEXT_SIZES, lines: number) =>
  lines * TEXT_SIZES[size] * TEXT_LINE_HEIGHT;

describe('text.layout', () => {
  it('TC-07 "Went well" at M auto → width just wider than the words, one line tall', () => {
    const r = layoutText('Went well', 'M', 'auto', null, fakeMeasure);
    // 9 chars * 20 * 0.5 = 90, rounded up so the last glyph is never clipped.
    expect(r.width).toBe(90);
    expect(r.lines).toEqual(['Went well']);
    expect(r.height).toBeCloseTo(H('M', 1), 6);
  });

  it('TC-08 a line wider than the max wraps into two and the box is max-wide', () => {
    // 76 chars at M measure 760 > 600, so it must wrap.
    const long =
      'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi';
    const r = layoutText(long, 'M', 'auto', null, fakeMeasure);
    expect(r.lines.length).toBeGreaterThan(1);
    expect(r.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(r.height).toBeCloseTo(H('M', r.lines.length), 6);
  });

  it('TC-09 a line measuring exactly the max stays one line, width = max (boundary)', () => {
    const exact = 'a'.repeat(60); // single word, 60*20*0.5 = 600 = TEXT_MAX_AUTO_WIDTH_WORLD
    const r = layoutText(exact, 'M', 'auto', null, fakeMeasure);
    expect(r.lines.length).toBe(1);
    expect(r.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
  });

  it('TC-09b a line just under the max is one line, width = its measure (boundary)', () => {
    const r = layoutText('a'.repeat(59), 'M', 'auto', null, fakeMeasure); // 590
    expect(r.lines.length).toBe(1);
    expect(r.width).toBe(590);
  });

  it('TC-10 fixed width = minimum with three wide words → one word per line, 3 tall', () => {
    // Each word measures 5 chars * 20 * 0.5 = 50 > 40, so none share a line.
    const r = layoutText('alpha beta gamma', 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, fakeMeasure);
    expect(r.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(r.lines).toEqual(['alpha', 'beta', 'gamma']);
    expect(r.height).toBeCloseTo(H('M', 3), 6);
  });

  it('TC-11 explicit newlines: width = longest line, height = lines × size × line height', () => {
    const text = 'ab\nabcd\nc'; // longest = 'abcd' (4*20*0.5=40)
    const r = layoutText(text, 'M', 'auto', null, fakeMeasure);
    expect(r.lines).toEqual(['ab', 'abcd', 'c']);
    expect(r.width).toBe(40);
    expect(r.height).toBeCloseTo(H('M', 3), 6);
  });

  it('an empty string still yields one line and a positive height', () => {
    const r = layoutText('', 'M', 'auto', null, fakeMeasure);
    expect(r.lines).toEqual(['']);
    expect(r.height).toBeCloseTo(H('M', 1), 6);
    expect(r.width).toBeGreaterThanOrEqual(0);
  });

  it('a size change changes the font size used for measurement and the height', () => {
    const text = 'hello';
    const m = layoutText(text, 'M', 'auto', null, fakeMeasure);
    const xl = layoutText(text, 'XL', 'auto', null, fakeMeasure);
    expect(xl.width).toBeGreaterThan(m.width); // XL font is bigger → wider measure
    expect(xl.height).toBeGreaterThan(m.height);
  });

  it('TC-32 createCanvasMeasurer without a canvas estimates width and never throws', () => {
    // Node / the unit project has no OffscreenCanvas or document canvas; the
    // measurer must fall back to an average-glyph estimate and return a number.
    const measure = createCanvasMeasurer(TEXT_FONT_FAMILY);
    let width = -1;
    expect(() => {
      width = measure('hello world', 20);
    }).not.toThrow();
    expect(Number.isFinite(width)).toBe(true);
    expect(width).toBeGreaterThan(0);
    // Longer text measures wider.
    expect(measure('hello world friend', 20)).toBeGreaterThan(measure('hi', 20));
  });
});
