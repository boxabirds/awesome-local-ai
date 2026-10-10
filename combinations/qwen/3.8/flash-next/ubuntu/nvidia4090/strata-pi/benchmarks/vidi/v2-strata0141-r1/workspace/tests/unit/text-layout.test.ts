import { describe, expect, it } from 'vitest';
import {
  TEXT_BOX_PADDING_WORLD,
  TEXT_ESTIMATED_GLYPH_WIDTH_RATIO,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';
import {
  createCanvasMeasurer,
  layoutText,
  type Measurer,
} from '../../src/client/objects/textLayout';

/**
 * The pure text layout (anchor `text.layout`), TC-07 to TC-11 and TC-32.
 *
 * A fake measurer keeps the maths checkable: every character is worth half the
 * font size, so a line's width is `length * fontPx / 2` board units and wrapping
 * is arithmetic rather than a question about real fonts. Real fonts are verified
 * in the browser (e2e TC-26).
 */

/** 0.5 em per character: 'Went well' at M (20) is 90 board units wide. */
const fakeMeasurer: Measurer = (text, fontPx) => text.length * fontPx * 0.5;

const charUnits = (size: keyof typeof TEXT_SIZES): number => TEXT_SIZES[size] * 0.5;

const lineOf = (char: string, count: number): string => char.repeat(count);

const oneLineHeight = (size: keyof typeof TEXT_SIZES): number =>
  TEXT_SIZES[size] * TEXT_LINE_HEIGHT;

describe('text.layout - automatic width (TC-07, TC-08, TC-09)', () => {
  it('TC-07 a short line gives a box just wider than the words', () => {
    const layout = layoutText('Went well', 'M', 'auto', null, fakeMeasurer);

    const measured = fakeMeasurer('Went well', TEXT_SIZES.M);
    expect(measured).toBe(90);
    expect(layout.width).toBe(90 + TEXT_BOX_PADDING_WORLD);
    expect(layout.width).toBeLessThan(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(layout.lines).toEqual(['Went well']);
    expect(layout.height).toBe(oneLineHeight('M'));
  });

  it('TC-08 a line past the maximum wraps, and the box stops at the maximum', () => {
    // 45 + 1 + 44 characters = 90 characters = 900 units at M: past 600.
    const text = `${lineOf('a', 45)} ${lineOf('b', 44)}`;
    expect(fakeMeasurer(text, TEXT_SIZES.M)).toBe(900);

    const layout = layoutText(text, 'M', 'auto', null, fakeMeasurer);

    expect(layout.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(layout.lines).toHaveLength(2);
    expect(layout.lines[0]).toBe(lineOf('a', 45));
    expect(layout.lines[1]).toBe(lineOf('b', 44));
    expect(layout.height).toBe(2 * oneLineHeight('M'));
  });

  it('TC-09 a line measuring exactly the maximum stays on one line (boundary)', () => {
    const text = lineOf('a', 60); // 60 * 10 = exactly 600
    expect(fakeMeasurer(text, TEXT_SIZES.M)).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);

    const layout = layoutText(text, 'M', 'auto', null, fakeMeasurer);

    expect(layout.lines).toHaveLength(1);
    expect(layout.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(layout.height).toBe(oneLineHeight('M'));
  });

  it('a line just under the maximum keeps its own width (boundary)', () => {
    const text = lineOf('a', 59); // 590 wide
    const layout = layoutText(text, 'M', 'auto', null, fakeMeasurer);
    expect(layout.lines).toHaveLength(1);
    expect(layout.width).toBe(590 + TEXT_BOX_PADDING_WORLD);
    expect(layout.width).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD);
  });

  it('wrapping breaks at word boundaries, greedily', () => {
    // Six 20-character words: 200 units each, four of them fit in 600 per line.
    const words = Array.from({ length: 6 }, () => lineOf('a', 20));
    const text = words.join(' ');
    const layout = layoutText(text, 'M', 'auto', null, fakeMeasurer);

    expect(layout.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(layout.lines).toHaveLength(3);
    expect(layout.lines[0]).toBe(`${words[0]} ${words[1]}`); // 410 wide, a third word would be 620
    expect(layout.lines[1]).toBe(`${words[2]} ${words[3]}`);
    expect(layout.lines[2]).toBe(`${words[4]} ${words[5]}`);
    expect(layout.height).toBe(layout.lines.length * oneLineHeight('M'));
  });

  it('a word wider than the maximum gets its own line and is not cut', () => {
    const text = `small ${lineOf('w', 100)}`; // the long word alone is 1000 wide
    const layout = layoutText(text, 'M', 'auto', null, fakeMeasurer);
    expect(layout.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(layout.lines).toEqual(['small', lineOf('w', 100)]);
    expect(layout.height).toBe(2 * oneLineHeight('M'));
  });

  it('the size decides the measuring font, so the same words get a wider box at XL', () => {
    const auto = layoutText('Went well', 'XL', 'auto', null, fakeMeasurer);
    const small = layoutText('Went well', 'S', 'auto', null, fakeMeasurer);
    expect(auto.width).toBe(9 * TEXT_SIZES.XL * 0.5 + TEXT_BOX_PADDING_WORLD);
    expect(small.width).toBe(9 * TEXT_SIZES.S * 0.5 + TEXT_BOX_PADDING_WORLD);
    expect(auto.height).toBe(oneLineHeight('XL'));
    expect(small.height).toBe(oneLineHeight('S'));
    // The maximum is a width, not a character count: at XL fewer words fit.
    const words = Array.from({ length: 6 }, (_unused, index) => lineOf('a', 20 + index));
    expect(layoutText(words.join(' '), 'XL', 'auto', null, fakeMeasurer).lines.length).toBeGreaterThan(2);
  });

  it('empty text still produces a usable box', () => {
    const layout = layoutText('', 'M', 'auto', null, fakeMeasurer);
    expect(layout.lines).toEqual(['']);
    expect(layout.height).toBe(oneLineHeight('M'));
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.width).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD);
  });
});

describe('text.layout - fixed width (TC-10)', () => {
  it('TC-10 the minimum fixed width puts one word on each line and grows the height', () => {
    const layout = layoutText('alpha beta gamma', 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, fakeMeasurer);

    expect(layout.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(layout.lines).toEqual(['alpha', 'beta', 'gamma']);
    expect(layout.height).toBe(3 * oneLineHeight('M'));
  });

  it('a fixed width is used exactly, without the automatic slack', () => {
    const layout = layoutText('Went well', 'M', 'fixed', 200, fakeMeasurer);
    expect(layout.width).toBe(200);
    expect(layout.lines).toEqual(['Went well']);
  });

  it('a fixed width rewraps without changing the text', () => {
    const wide = layoutText('alpha beta gamma', 'M', 'fixed', 300, fakeMeasurer);
    const narrow = layoutText('alpha beta gamma', 'M', 'fixed', 120, fakeMeasurer);
    expect(wide.lines).toEqual(['alpha beta gamma']);
    expect(narrow.lines.length).toBeGreaterThan(wide.lines.length);
    expect(narrow.lines.join(' ')).toBe('alpha beta gamma');
    expect(narrow.height).toBe(narrow.lines.length * oneLineHeight('M'));
  });

  it('a fixed width respects explicit newlines', () => {
    const layout = layoutText(`${lineOf('a', 20)}\n${lineOf('b', 20)}`, 'M', 'fixed', 100, fakeMeasurer);
    expect(layout.lines).toEqual([lineOf('a', 20), lineOf('b', 20)]);
    expect(layout.width).toBe(100);
  });

  it('an unusable fixed width falls back to the automatic box rather than a broken one', () => {
    const layout = layoutText('Went well', 'M', 'fixed', Number.NaN, fakeMeasurer);
    expect(layout.width).toBeGreaterThan(0);
    expect(Number.isFinite(layout.width)).toBe(true);
    expect(Number.isFinite(layout.height)).toBe(true);
  });
});

describe('text.layout - explicit lines (TC-11)', () => {
  it('TC-11 width follows the longest line and height the line count', () => {
    const text = 'abc\nde\nfghi jkl';
    const layout = layoutText(text, 'M', 'auto', null, fakeMeasurer);

    expect(layout.lines).toEqual(['abc', 'de', 'fghi jkl']);
    expect(layout.width).toBe(8 * charUnits('M') + TEXT_BOX_PADDING_WORLD); // 'fghi jkl' is the longest line
    expect(layout.height).toBe(3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });

  it('a trailing empty line is a line: the box is tall enough for it', () => {
    const layout = layoutText('one\ntwo\n', 'M', 'auto', null, fakeMeasurer);
    expect(layout.lines).toEqual(['one', 'two', '']);
    expect(layout.height).toBe(3 * oneLineHeight('M'));
  });

  it('a short line among long ones does not shrink the box', () => {
    const long = lineOf('a', 40); // 400 wide
    const layout = layoutText(`${long}\nx\n${long}`, 'M', 'auto', null, fakeMeasurer);
    expect(layout.width).toBe(400 + TEXT_BOX_PADDING_WORLD);
    expect(layout.height).toBe(3 * oneLineHeight('M'));
  });
});

describe('text.layout - measuring without a canvas (TC-32)', () => {
  it('TC-32 without any canvas the measurer estimates, and never throws (error path)', () => {
    const measurer = createCanvasMeasurer();
    const width = measurer('Went well', TEXT_SIZES.M);
    expect(Number.isFinite(width)).toBe(true);
    expect(width).toBeGreaterThan(0);
    // The estimate is the named average glyph ratio, not a guess.
    expect(width).toBeCloseTo(
      'Went well'.length * TEXT_SIZES.M * TEXT_ESTIMATED_GLYPH_WIDTH_RATIO,
      6,
    );
  });

  it('TC-32 layout still works on an estimated measurer', () => {
    const layout = layoutText('Went well', 'M', 'auto', null, createCanvasMeasurer());
    expect(layout.lines).toEqual(['Went well']);
    expect(layout.height).toBe(oneLineHeight('M'));
    expect(layout.width).toBeGreaterThan(90);
  });

  it('a measurer that returns nonsense is replaced by the estimate, not a crash', () => {
    const broken: Measurer = () => Number.NaN;
    const layout = layoutText('Went well', 'M', 'auto', null, broken);
    expect(Number.isFinite(layout.width)).toBe(true);
    expect(Number.isFinite(layout.height)).toBe(true);
    expect(layout.lines.length).toBeGreaterThan(0);
  });
});
