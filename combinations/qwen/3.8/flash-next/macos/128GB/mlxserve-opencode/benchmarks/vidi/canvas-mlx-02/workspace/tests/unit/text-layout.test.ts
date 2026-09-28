// Story 9, text.layout (unit): the box the layout computes for text, against a
// FAKE measurer so widths are exact arithmetic - and, for TC-11/TC-32, against
// the real measurer factory and its fallback, because jsdom and node have no
// canvas to measure with.
//
// Fake measurer: width = text.length * fontPx * 0.5. At the default size M
// (20 px) a character is 10 px wide, so 'Went well' (9 characters) is 90 px.
import { describe, it, expect } from 'vitest';
import {
  layoutText,
  createCanvasMeasurer,
  estimateTextWidth,
  type TextMeasurer,
} from '../../src/client/objects/textLayout.ts';
import {
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_LAYOUT_PADDING_WORLD,
} from '../../src/shared/config.ts';

const fakeMeasure: TextMeasurer = (text, fontPx) => text.length * fontPx * 0.5;

const lineHeightOf = (size: keyof typeof TEXT_SIZES): number =>
  TEXT_SIZES[size] * TEXT_LINE_HEIGHT;

describe('text.layout auto box', () => {
  // TC-07: one short line: width = longest line + slack, floored at the
  // minimum; height is exactly one line; the lines come back as laid out.
  it('TC-07 sizes a short line to its own width', () => {
    const r = layoutText('Went well', 'M', 'auto', undefined, fakeMeasure);
    // 'Went well' is 9 characters * 20 * 0.5 = 90; slack 8.
    expect(r.lines).toEqual(['Went well']);
    expect(r.width).toBe(90 + TEXT_LAYOUT_PADDING_WORLD);
    expect(r.height).toBe(lineHeightOf('M'));
  });

  it('floors a short line at TEXT_MIN_WIDTH_WORLD', () => {
    const r = layoutText('hi', 'M', 'auto', undefined, fakeMeasure);
    // 'hi' measures 20; +8 = 28, below the floor of 40.
    expect(r.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(r.height).toBe(lineHeightOf('M'));
  });

  // TC-08: a line longer than the auto width wraps; the box stays at or under
  // the maximum; the height counts every wrapped line.
  it('TC-08 wraps a long line and grows the height by lines', () => {
    // 100 characters at 10 px each is 1,000 px > 600: it wraps.
    const text = 'word '.repeat(19) + 'last'; // 100 characters, ends in a long-less line
    const r = layoutText(text, 'M', 'auto', undefined, fakeMeasure);
    expect(r.lines.length).toBeGreaterThan(1);
    expect(r.lines.every((line) => line.length > 0)).toBe(true);
    // No laid-out line is wider than the maximum.
    expect(r.lines.every((line) => fakeMeasure(line, TEXT_SIZES.M) <= TEXT_MAX_AUTO_WIDTH_WORLD)).toBe(
      true,
    );
    // Height counts the lines: a multiple of the line height.
    expect(r.height).toBe(r.lines.length * lineHeightOf('M'));
    expect(r.width).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD);
  });

  it('keeps explicit newlines and wraps overlong words by character', () => {
    const r = layoutText('one\n\ntwo', 'M', 'auto', undefined, fakeMeasure);
    // Three lines: 'one', '' (an empty paragraph is a line), 'two'.
    expect(r.lines).toEqual(['one', '', 'two']);
    expect(r.height).toBe(3 * lineHeightOf('M'));

    // A single word that cannot fit even the minimum breaks mid-word.
    const long = 'x'.repeat(200);
    const w = layoutText(long, 'M', 'auto', undefined, fakeMeasure);
    expect(w.lines.length).toBeGreaterThan(1);
    expect(w.width).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD);
  });

  // TC-09: the boundary line - exactly at the maximum is NOT wrapped and the
  // box lands ON TEXT_MAX_AUTO_WIDTH_WORLD.
  it('TC-09 puts a line of exactly the maximum width at the maximum', () => {
    // 60 characters * 20 * 0.5 = exactly 600.
    const text = 'ab '.repeat(20); // 60 characters
    expect(text.length).toBe(60);
    const r = layoutText(text, 'M', 'auto', undefined, fakeMeasure);
    expect(fakeMeasure(text, TEXT_SIZES.M)).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    // 600 + slack 8 = 608 clamps back to 600.
    expect(r.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    // Nothing exceeded the maximum, so nothing wrapped.
    expect(r.lines).toEqual([text]);
    expect(r.height).toBe(lineHeightOf('M'));
  });

  it('the font size scales the box with TEXT_SIZES, not the zoom', () => {
    const small = layoutText('hello world', 'S', 'auto', undefined, fakeMeasure);
    const big = layoutText('hello world', 'XL', 'auto', undefined, fakeMeasure);
    expect(small.width).toBe(11 * TEXT_SIZES.S * 0.5 + TEXT_LAYOUT_PADDING_WORLD);
    expect(big.width).toBe(11 * TEXT_SIZES.XL * 0.5 + TEXT_LAYOUT_PADDING_WORLD);
    expect(big.height).toBe(lineHeightOf('XL'));
  });
});

describe('text.layout fixed box', () => {
  // TC-10: a FIXED width is kept exactly; the text wraps inside it; the height
  // is a multiple of the line height.
  it('TC-10 keeps the given width and wraps inside it', () => {
    const r = layoutText('hello there my friend', 'M', 'fixed', 100, fakeMeasure);
    expect(r.width).toBe(100);
    expect(r.lines.length).toBeGreaterThan(1);
    expect(
      r.lines.every((line) => fakeMeasure(line, TEXT_SIZES.M) <= 100 || !line.includes(' ')),
    ).toBe(true);
    expect(r.height % lineHeightOf('M')).toBeCloseTo(0);
    expect(r.height).toBe(r.lines.length * lineHeightOf('M'));
  });

  it('clamps a fixed width to the minimum and re-wraps', () => {
    const before = layoutText('hello there my friend', 'M', 'fixed', 100, fakeMeasure);
    const after = layoutText('hello there my friend', 'M', 'fixed', 1, fakeMeasure);
    expect(after.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(after.lines.length).toBeGreaterThan(before.lines.length);
    expect(after.height).toBe(after.lines.length * lineHeightOf('M'));
  });

  it('an empty text is one line at the minimum width', () => {
    const auto = layoutText('', 'M', 'auto', undefined, fakeMeasure);
    expect(auto.lines).toEqual(['']);
    expect(auto.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(auto.height).toBe(lineHeightOf('M'));

    const fixed = layoutText('', 'M', 'fixed', 300, fakeMeasure);
    expect(fixed.width).toBe(300);
    expect(fixed.height).toBe(lineHeightOf('M'));
  });
});

describe('text.layout measurers', () => {
  // TC-11: the real measurer answers with a finite, non-negative width for any
  // string, and a longer string never measures narrower (in node there is no
  // canvas, so this exercises the same factory the browser uses).
  it('TC-11 createCanvasMeasurer is finite, non-negative and monotonic', () => {
    const measure = createCanvasMeasurer();
    const samples = ['', 'a', 'ab', 'Went well', 'x'.repeat(200), '一'.repeat(9)];
    const widths = samples.map((s) => measure(s, 20));
    expect(widths.every((w) => Number.isFinite(w) && w >= 0)).toBe(true);
    for (let i = 1; i < samples.length; i++) {
      if (samples[i].startsWith(samples[i - 1]) && samples[i - 1] !== '') {
        expect(widths[i]).toBeGreaterThanOrEqual(widths[i - 1]);
      }
    }
  });

  // TC-32: with NO canvas to measure with, the measurer falls back to an
  // estimate that is positive and grows with the string's length.
  it('TC-32 falls back to a length-proportional estimate without a canvas', () => {
    const measure = createCanvasMeasurer(); // node: no document, no OffscreenCanvas
    const short = measure('abc', 20);
    const long = measure('abcdefghijkl', 20);
    expect(short).toBeGreaterThan(0);
    expect(long).toBeGreaterThan(short);
    // The estimate is proportional to length at a fixed font size.
    expect(long / short).toBeCloseTo(4, 1);
    // And scales with the font size.
    expect(measure('abc', 40)).toBeCloseTo(short * 2, 5);
  });

  it('estimateTextWidth is the shared fallback maths', () => {
    expect(estimateTextWidth('abcd', 20)).toBe(estimateTextWidth('abcd', 20));
    expect(estimateTextWidth('', 20)).toBe(0);
    expect(estimateTextWidth('abcd', 20)).toBeGreaterThan(0);
  });
});
