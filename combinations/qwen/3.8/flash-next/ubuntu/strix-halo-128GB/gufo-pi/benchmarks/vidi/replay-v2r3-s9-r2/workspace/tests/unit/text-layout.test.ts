/**
 * Unit tests for pure text layout (story 9, text.layout).
 * TC-07 to TC-11 and TC-32. A deterministic fake measurer (fixed world units
 * per character per font size) keeps the maths exact; real font metrics are
 * covered by the e2e suite.
 */
import { describe, it, expect } from 'vitest';
import {
  layoutText,
  createCanvasMeasurer,
  estimateTextWidth,
  type Measurer,
} from '../../src/client/objects/textLayout';
import {
  TEXT_AUTO_WIDTH_PADDING_WORLD,
  TEXT_AVG_GLYPH_RATIO,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../../src/shared/config';

/** 0.5 world units per character per board unit of font size. */
const FAKE_RATIO = 0.5;

/** Fake measurer: width = characters × fontPx × 0.5. */
const fakeMeasure: Measurer = (text, fontPx) =>
  Array.from(text).length * fontPx * FAKE_RATIO;

/** Width in characters that fits exactly `width` units at `size`. */
function charsFitting(width: number, size: TextSize): number {
  return Math.floor(width / (TEXT_SIZES[size] * FAKE_RATIO));
}

function word(count: number, fill = 'a'): string {
  return fill.repeat(count);
}

function lineHeight(size: TextSize): number {
  return TEXT_SIZES[size] * TEXT_LINE_HEIGHT;
}

describe('text.layout — automatic width (TC-07 to TC-09)', () => {
  it('TC-07: a short line produces a box just wider than the words', () => {
    const text = 'Went well';
    const measured = fakeMeasure(text, TEXT_SIZES.M);
    expect(measured).toBe(90);

    const layout = layoutText(text, 'M', 'auto', null, fakeMeasure);
    expect(layout.lines).toEqual(['Went well']);
    expect(layout.width).toBeCloseTo(measured + TEXT_AUTO_WIDTH_PADDING_WORLD, 6);
    expect(layout.width).toBeGreaterThan(measured);
    expect(layout.height).toBeCloseTo(lineHeight('M'), 6);
  });

  it('TC-08: a line measuring 900 wraps at the maximum width into two lines', () => {
    const per = charsFitting(TEXT_MAX_AUTO_WIDTH_WORLD, 'M'); // characters that fit on one line
    // Two words that each fill a line: the single input line measures ~1,210 units.
    const text = `${word(per, 'a')} ${word(per, 'b')}`;
    expect(fakeMeasure(text, TEXT_SIZES.M)).toBeGreaterThanOrEqual(900);
    expect(fakeMeasure(text, TEXT_SIZES.M)).toBeGreaterThan(TEXT_MAX_AUTO_WIDTH_WORLD);

    const layout = layoutText(text, 'M', 'auto', null, fakeMeasure);
    expect(layout.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(layout.lines).toHaveLength(2);
    expect(layout.lines[0]).toBe(word(per, 'a'));
    expect(layout.lines[1]).toBe(word(per, 'b'));
    expect(layout.height).toBeCloseTo(2 * lineHeight('M'), 6);
  });

  it('TC-09: a line measuring exactly TEXT_MAX_AUTO_WIDTH_WORLD stays on one line', () => {
    const count = charsFitting(TEXT_MAX_AUTO_WIDTH_WORLD, 'M');
    const text = word(count);
    expect(fakeMeasure(text, TEXT_SIZES.M)).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);

    const layout = layoutText(text, 'M', 'auto', null, fakeMeasure);
    expect(layout.lines).toHaveLength(1);
    expect(layout.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(layout.height).toBeCloseTo(lineHeight('M'), 6);
  });

  it('empty text has a one-line height and no width beyond the padding', () => {
    const layout = layoutText('', 'M', 'auto', null, fakeMeasure);
    expect(layout.lines).toEqual(['']);
    expect(layout.height).toBeCloseTo(lineHeight('M'), 6);
    expect(layout.width).toBeGreaterThanOrEqual(0);
    expect(layout.width).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD);
  });

  it('a bigger preset measures the same text wider', () => {
    const small = layoutText('Went well', 'S', 'auto', null, fakeMeasure);
    const large = layoutText('Went well', 'XL', 'auto', null, fakeMeasure);
    expect(large.width).toBeGreaterThan(small.width);
    expect(large.height).toBeGreaterThan(small.height);
  });
});

describe('text.layout — fixed width (TC-10)', () => {
  it('TC-10: three words at the minimum width wrap one per line and grow the height', () => {
    const per = charsFitting(TEXT_MIN_WIDTH_WORLD, 'M');
    const text = `${word(per, 'a')} ${word(per, 'b')} ${word(per, 'c')}`;
    expect(fakeMeasure(text, TEXT_SIZES.M)).toBeGreaterThan(TEXT_MIN_WIDTH_WORLD);

    const layout = layoutText(text, 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, fakeMeasure);
    expect(layout.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(layout.lines).toEqual([word(per, 'a'), word(per, 'b'), word(per, 'c')]);
    expect(layout.height).toBeCloseTo(3 * lineHeight('M'), 6);
  });

  it('fixed width is honoured even when the text is shorter than the box', () => {
    const layout = layoutText('hi', 'M', 'fixed', 240, fakeMeasure);
    expect(layout.width).toBe(240);
    expect(layout.lines).toEqual(['hi']);
    expect(layout.height).toBeCloseTo(lineHeight('M'), 6);
  });

  it('a fixed width change keeps the text and only changes the height', () => {
    const text = `${word(20, 'a')} ${word(20, 'b')} ${word(20, 'c')}`;
    const wide = layoutText(text, 'M', 'fixed', 500, fakeMeasure);
    const narrow = layoutText(text, 'M', 'fixed', 120, fakeMeasure);
    expect(wide.lines.length).toBeLessThan(narrow.lines.length);
    expect(narrow.height).toBeGreaterThan(wide.height);
    expect(narrow.lines.join(' ')).toBe(text);
  });
});

describe('text.layout — explicit newlines (TC-11)', () => {
  it('TC-11: width follows the longest line, height the number of lines', () => {
    const text = 'id\nWent well\nto improve together now';
    const layout = layoutText(text, 'M', 'auto', null, fakeMeasure);
    const lines = text.split('\n');
    const longest = Math.max(...lines.map((l) => fakeMeasure(l, TEXT_SIZES.M)));

    expect(layout.lines).toEqual(lines);
    expect(layout.width).toBeCloseTo(longest + TEXT_AUTO_WIDTH_PADDING_WORLD, 6);
    expect(layout.height).toBeCloseTo(lines.length * TEXT_SIZES.M * TEXT_LINE_HEIGHT, 6);
  });

  it('a trailing newline still reserves a line for it', () => {
    const layout = layoutText('one\n', 'L', 'auto', null, fakeMeasure);
    expect(layout.lines).toEqual(['one', '']);
    expect(layout.height).toBeCloseTo(2 * lineHeight('L'), 6);
  });
});

describe('text.layout — measurer fallback (TC-32)', () => {
  it('TC-32: without a canvas the measurer estimates and never throws', () => {
    // Node (the unit environment) has neither OffscreenCanvas nor document.
    expect(typeof (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas).toBe('undefined');
    expect(typeof (globalThis as { document?: unknown }).document).toBe('undefined');

    const measure = createCanvasMeasurer();
    let width = 0;
    expect(() => {
      width = measure('Went well', TEXT_SIZES.M);
    }).not.toThrow();

    // Character-count estimate: proportional to both length and font size.
    expect(width).toBeCloseTo(9 * TEXT_SIZES.M * TEXT_AVG_GLYPH_RATIO, 6);
    expect(measure('Went well well', TEXT_SIZES.M)).toBeCloseTo(width * (14 / 9), 6);
    expect(measure('Went well', TEXT_SIZES.XL)).toBeCloseTo(width * (TEXT_SIZES.XL / TEXT_SIZES.M), 6);
    expect(measure('', TEXT_SIZES.M)).toBe(0);
  });

  it('layoutText with the estimated measurer produces a usable box', () => {
    const measure = createCanvasMeasurer();
    const layout = layoutText('Went well', 'XL', 'auto', null, measure);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.width).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(layout.height).toBeCloseTo(lineHeight('XL'), 6);
  });

  it('estimateTextWidth is exported for callers without a measurer', () => {
    expect(estimateTextWidth('abcd', 20)).toBeCloseTo(4 * 20 * TEXT_AVG_GLYPH_RATIO, 6);
  });
});
