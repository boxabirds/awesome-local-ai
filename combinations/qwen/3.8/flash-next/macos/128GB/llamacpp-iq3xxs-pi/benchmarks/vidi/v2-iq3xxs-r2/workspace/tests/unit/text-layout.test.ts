import { describe, expect, it } from 'vitest';
import {
  TEXT_AVERAGE_GLYPH_WIDTH_RATIO,
  createCanvasMeasurer,
  estimateTextWidth,
  layoutText,
  type Measurer,
} from '../../src/client/objects/textLayout';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_BOX_PADDING_WORLD,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';

/**
 * Text measurement and wrapping (text.layout). Everything here runs against a fake
 * measurer — ten board units per character at size M — so a line's width is something the
 * test can state in whole units instead of font metrics.
 */

/** Ten board units per character at M, five at S: a font in which every glyph is alike. */
const measure: Measurer = (text, fontPx) => text.length * fontPx * 0.5;

/** One character of this font at size M, in board units. */
const unit = TEXT_SIZES.M * 0.5;
/** One line of size M: the height a text object of one line has. */
const line = TEXT_SIZES.M * TEXT_LINE_HEIGHT;

const word = (n: number, char = 'x'): string => char.repeat(n);

describe('an automatic text box (TC-07, TC-09, TC-11)', () => {
  it('TC-07: is as wide as its measured line plus the padding, one line tall', () => {
    const heading = 'Went well';
    expect(heading.length * unit).toBe(90);

    const layout = layoutText(heading, 'M', 'auto', null, measure);
    expect(layout.width).toBe(90 + TEXT_BOX_PADDING_WORLD);
    expect(layout.height).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    expect(layout.height).toBe(line);
    expect(layout.lines).toBe(1);
  });

  it('TC-09: a line measuring exactly TEXT_MAX_AUTO_WIDTH_WORLD stays on one line', () => {
    // Nine five-character words and one six-character one: exactly 60 characters, 600 units.
    const words = [...Array(9).fill(word(5)), word(6)];
    const text = words.join(' ');
    expect(text.length * unit).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);

    const layout = layoutText(text, 'M', 'auto', null, measure);
    expect(layout.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(layout.lines).toBe(1);
    expect(layout.height).toBe(line);
  });

  it('TC-11: explicit newlines are lines; the box is the longest of them', () => {
    const text = `${word(10)}\n${word(3)}\n${word(9)}`;

    const layout = layoutText(text, 'M', 'auto', null, measure);
    expect(layout.width).toBe(10 * unit + TEXT_BOX_PADDING_WORLD);
    expect(layout.lines).toBe(3);
    expect(layout.height).toBe(3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);

    // The size sets the height of every line, and the width of every character.
    const atL = layoutText(text, 'L', 'auto', null, measure);
    expect(atL.height).toBe(3 * TEXT_SIZES.L * TEXT_LINE_HEIGHT);
    expect(atL.width).toBe(10 * TEXT_SIZES.L * 0.5 + TEXT_BOX_PADDING_WORLD);
  });

  it('a box is never narrower than the narrowest handle-set one, not even when empty', () => {
    const empty = layoutText('', 'M', 'auto', null, measure);
    expect(empty.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(empty.height).toBe(line); // one line, so an empty text still has a height
    expect(empty.lines).toBe(1);

    const tiny = layoutText(word(2), 'M', 'auto', null, measure);
    expect(tiny.width).toBe(TEXT_MIN_WIDTH_WORLD);
  });
});

describe('wrapping (TC-08, TC-10)', () => {
  it('TC-08: a line measuring 900 is capped at the maximum and wraps into two', () => {
    // Fourteen five-character words and one six-character one: 90 characters, 900 units.
    const words = [...Array(14).fill(word(5)), word(6)];
    const text = words.join(' ');
    expect(text.length * unit).toBe(900);

    const layout = layoutText(text, 'M', 'auto', null, measure);
    expect(layout.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    // Ten words fit under 600 units (590); the eleventh would reach 650.
    expect(layout.lines).toBe(2);
    expect(layout.height).toBe(2 * line);
  });

  it('TC-10: at the narrowest fixed width, three words become three lines', () => {
    const text = `${word(5, 'a')} ${word(5, 'b')} ${word(5, 'c')}`;

    const layout = layoutText(text, 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, measure);
    expect(layout.width).toBe(TEXT_MIN_WIDTH_WORLD);
    // A word wider than the line gets a line to itself rather than being split.
    expect(layout.lines).toBe(3);
    expect(layout.height).toBe(3 * line);
  });

  it('a fixed width below the minimum is measured at the minimum', () => {
    // 30 units of text, which would fit in the 10 units asked for and in the 40 stored.
    const layout = layoutText(`${word(1, 'a')} ${word(1, 'b')}`, 'M', 'fixed', 10, measure);
    expect(layout.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(layout.lines).toBe(1);
    // The same 40 units is what wrapping happens at, so the three words from TC-10 are
    // still three lines whatever the handle was dragged to below the minimum.
    expect(layoutText(`${word(5, 'a')} ${word(5, 'b')} ${word(5, 'c')}`, 'M', 'fixed', 1, measure))
      .toEqual({ width: TEXT_MIN_WIDTH_WORLD, height: 3 * line, lines: 3 });
  });

  it('a word longer than the line does not loop for ever', () => {
    const layout = layoutText(word(200), 'M', 'fixed', 120, measure);
    expect(layout.lines).toBe(1);
    expect(layout.width).toBe(120);
  });
});

describe('measuring without a browser (TC-32)', () => {
  it('TC-32: with no canvas at all, the measurer estimates instead of throwing', () => {
    // The unit project has no DOM: this is the error path a Worker or Node takes.
    expect(typeof document).toBe('undefined');

    const measured = createCanvasMeasurer();
    expect(measured(word(5), TEXT_SIZES.M)).toBeCloseTo(
      5 * TEXT_SIZES.M * TEXT_AVERAGE_GLYPH_WIDTH_RATIO,
    );
    expect(measured(word(10), TEXT_SIZES.M)).toBeGreaterThan(measured(word(5), TEXT_SIZES.M));
    expect(Number.isFinite(measured('', TEXT_SIZES.XL))).toBe(true);
    expect(measured(word(5), TEXT_SIZES.M)).toBe(estimateTextWidth(word(5), TEXT_SIZES.M));
  });

  it('layoutText without a measurer uses the estimate and the default size', () => {
    const layout = layoutText(word(10));
    expect(layout.width).toBe(
      Math.max(
        TEXT_MIN_WIDTH_WORLD,
        Math.min(
          10 * TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_AVERAGE_GLYPH_WIDTH_RATIO +
            TEXT_BOX_PADDING_WORLD,
          TEXT_MAX_AUTO_WIDTH_WORLD,
        ),
      ),
    );
    expect(layout.height).toBe(TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT);
  });
});
