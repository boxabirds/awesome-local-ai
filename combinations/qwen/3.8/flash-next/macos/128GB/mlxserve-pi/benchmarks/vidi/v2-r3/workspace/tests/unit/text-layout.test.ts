// text.layout unit tests (TC-07 … TC-11, TC-32). The wrapping maths is pure, so
// it is tested with a fake measurer that makes a character exactly half the font
// size wide: every number below is one a reader can follow by hand, which is the
// point — a real font would make the assertions about the font instead of about
// the rule. Real fonts are the e2e tier's business (tests/e2e/text.spec.ts).
import { describe, expect, it } from 'vitest';
import {
  AVERAGE_GLYPH_WIDTH_RATIO,
  createCanvasMeasurer,
  layoutText,
  type Measurer,
} from '../../src/client/objects/textLayout';
import {
  TEXT_BOX_PAD_WORLD,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';

/** Half an em per character, whatever the text: 9 characters at M are 90 units. */
const fakeMeasure: Measurer = (text, fontPx) => text.length * fontPx * 0.5;

/** The height of one line at a size, as the layout and the CSS both compute it. */
const line = (size: keyof typeof TEXT_SIZES, lines = 1): number =>
  Math.round(lines * TEXT_SIZES[size] * TEXT_LINE_HEIGHT * 100) / 100;

/** `n` words of four letters, the shape of ordinary prose. */
const words = (n: number): string => Array.from({ length: n }, () => 'well').join(' ');

describe('layoutText, auto width', () => {
  // TC-07: text that fits is measured, padded, and stays on one line.
  it('TC-07 makes a box just wider than its one line', () => {
    expect(fakeMeasure('Went well', TEXT_SIZES.M)).toBe(90);

    const layout = layoutText('Went well', 'M', 'auto', null, fakeMeasure);
    expect(layout.lines).toEqual(['Went well']);
    expect(layout.width).toBe(90 + TEXT_BOX_PAD_WORLD);
    expect(layout.width).toBeLessThan(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(layout.height).toBe(line('M'));
  });

  // TC-08: a line longer than the widest auto box stops the box growing and
  // starts the text wrapping inside it.
  it('TC-08 stops the box at TEXT_MAX_AUTO_WIDTH_WORLD and wraps to two lines', () => {
    // Twelve words measure 590 and fit; the thirteenth would make it 640.
    const long = words(15);
    expect(fakeMeasure(long, TEXT_SIZES.M)).toBeGreaterThan(TEXT_MAX_AUTO_WIDTH_WORLD);

    const layout = layoutText(long, 'M', 'auto', null, fakeMeasure);
    expect(layout.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(layout.lines).toHaveLength(2);
    expect(layout.lines[0]).toBe(words(12));
    expect(fakeMeasure(layout.lines[0]!, TEXT_SIZES.M)).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(layout.height).toBe(line('M', 2));
  });

  // TC-09: the boundary. A line exactly as wide as the limit is not wrapped.
  it('TC-09 treats a line of exactly TEXT_MAX_AUTO_WIDTH_WORLD as one line', () => {
    const exact = 'x'.repeat(TEXT_MAX_AUTO_WIDTH_WORLD / (TEXT_SIZES.M * 0.5));
    expect(fakeMeasure(exact, TEXT_SIZES.M)).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);

    const layout = layoutText(exact, 'M', 'auto', null, fakeMeasure);
    expect(layout.lines).toHaveLength(1);
    expect(layout.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(layout.height).toBe(line('M'));
  });

  it('pads a line just under the limit and never grows past it', () => {
    const justUnder = 'x'.repeat(TEXT_MAX_AUTO_WIDTH_WORLD / (TEXT_SIZES.M * 0.5) - 1);
    const layout = layoutText(justUnder, 'M', 'auto', null, fakeMeasure);
    expect(layout.lines).toHaveLength(1);
    // 590 wide, padded to 594: padding never pushes the box past the limit.
    expect(layout.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD - 10 + TEXT_BOX_PAD_WORLD);
    expect(layout.width).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD);
  });

  // TC-11: explicit newlines are lines, not spaces.
  it('TC-11 takes its width from the longest line and its height from the count', () => {
    const multi = 'Went well\nTo improve\nShip it';
    const layout = layoutText(multi, 'M', 'auto', null, fakeMeasure);
    expect(layout.lines).toEqual(['Went well', 'To improve', 'Ship it']);
    // 'To improve' is the longest of the three at 100 units.
    expect(layout.width).toBe(100 + TEXT_BOX_PAD_WORLD);
    expect(layout.height).toBe(line('M', 3));
    expect(layout.height).toBeCloseTo(3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });

  it('wraps only the line that needs it', () => {
    const mixed = `short\n${words(15)}`;
    const layout = layoutText(mixed, 'M', 'auto', null, fakeMeasure);
    expect(layout.lines).toEqual(['short', words(12), words(3)]);
    expect(layout.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(layout.height).toBe(line('M', 3));
  });

  it('gives empty text one line, so a fresh object still has bounds', () => {
    const layout = layoutText('', 'M', 'auto', null, fakeMeasure);
    expect(layout.lines).toEqual(['']);
    expect(layout.height).toBe(line('M'));
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.width).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD);
  });

  it('gives every size its own font size, and a wider box at the same text', () => {
    const auto = (size: keyof typeof TEXT_SIZES) => layoutText('Went well', size, 'auto', null, fakeMeasure);
    expect(auto('S').width).toBe(9 * TEXT_SIZES.S * 0.5 + TEXT_BOX_PAD_WORLD);
    expect(auto('S').height).toBe(line('S'));
    expect(auto('XL').height).toBe(line('XL'));
    // The same nine characters at XL are 252 wide: bigger text, wider box.
    expect(auto('XL').width).toBe(252 + TEXT_BOX_PAD_WORLD);
    expect(auto('XL').width).toBeGreaterThan(auto('S').width);
  });

  it('wraps a word wider than the box onto a line of its own', () => {
    const one = 'x'.repeat(200);
    const layout = layoutText(`ab ${one}`, 'M', 'auto', null, fakeMeasure);
    // A word is never cut in half, so it gets its own line even past the limit.
    expect(layout.lines).toEqual(['ab', one]);
    expect(layout.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
  });
});

describe('layoutText, fixed width', () => {
  // TC-10: the box is as wide as it was told, and as tall as the words need.
  it('TC-10 wraps three words into three lines at TEXT_MIN_WIDTH_WORLD', () => {
    const layout = layoutText('abc def ghi', 'M', 'fixed', 40, fakeMeasure);
    expect(layout.width).toBe(40);
    expect(layout.lines).toEqual(['abc', 'def', 'ghi']);
    expect(layout.height).toBe(line('M', 3));
    // Growing the height is the whole point of a fixed-width annotation.
    expect(layout.height).toBeGreaterThan(line('M', 1));
  });

  it('TC-10 grows and shrinks the height as the fixed width changes', () => {
    const text = words(15);
    const narrow = layoutText(text, 'M', 'fixed', 100, fakeMeasure);
    const wide = layoutText(text, 'M', 'fixed', 300, fakeMeasure);
    expect(narrow.lines.length).toBeGreaterThan(wide.lines.length);
    expect(narrow.height).toBeGreaterThan(wide.height);
    expect(wide.width).toBe(300);
    for (const l of wide.lines) expect(fakeMeasure(l, TEXT_SIZES.M)).toBeLessThanOrEqual(300);
  });

  it('clamps a fixed width under the minimum instead of laying out nothing', () => {
    const layout = layoutText('abc def ghi', 'M', 'fixed', 20, fakeMeasure);
    expect(layout.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(layout.height).toBeGreaterThan(line('M', 1));
  });

  it('keeps explicit newlines inside a fixed width', () => {
    const layout = layoutText(`ab cd\n${words(15)}`, 'M', 'fixed', 100, fakeMeasure);
    expect(layout.lines[0]).toBe('ab cd');
    expect(layout.width).toBe(100);
  });

  it('ignores a width that is not a number and lays out as auto', () => {
    const layout = layoutText('Went well', 'M', 'fixed', Number.NaN, fakeMeasure);
    expect(layout.width).toBe(90 + TEXT_BOX_PAD_WORLD);
    expect(layout.height).toBe(line('M'));
  });
});

// TC-32: the error path. An environment with no canvas at all — which is what a
// Node unit test and a jsdom component test are — measures with the estimate and
// does not throw.
describe('createCanvasMeasurer without a canvas (TC-32)', () => {
  it('TC-32 falls back to a character-count estimate and never throws', () => {
    expect(typeof document).toBe('undefined'); // this environment has no canvas

    const measure = createCanvasMeasurer();
    expect(() => measure('Went well', TEXT_SIZES.M)).not.toThrow();
    expect(measure('abcd', 20)).toBe(4 * 20 * AVERAGE_GLYPH_WIDTH_RATIO);
    expect(measure('', 20)).toBe(0);
    expect(measure('Went well', TEXT_SIZES.M)).toBe(9 * TEXT_SIZES.M * AVERAGE_GLYPH_WIDTH_RATIO);
  });

  it('TC-32 still produces a usable box from the estimate', () => {
    const measure = createCanvasMeasurer();
    const layout = layoutText('Went well', 'M', 'auto', null, measure);
    expect(layout.width).toBe(9 * TEXT_SIZES.M * AVERAGE_GLYPH_WIDTH_RATIO + TEXT_BOX_PAD_WORLD);
    expect(layout.height).toBe(line('M'));
    expect(layout.lines).toEqual(['Went well']);
  });

  it('gives every measurement to the measurer it was handed, in the size font', () => {
    const seen: [string, number][] = [];
    const spy: Measurer = (text, fontPx) => {
      seen.push([text, fontPx]);
      return fakeMeasure(text, fontPx);
    };
    layoutText('Went well', 'L', 'auto', null, spy);
    expect(seen.every(([, fontPx]) => fontPx === TEXT_SIZES.L)).toBe(true);
    expect(seen.length).toBeGreaterThan(0);
  });
});
