import { describe, expect, it } from 'vitest';
import {
  TEXT_ESTIMATED_GLYPH_RATIO,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  type TextSize,
} from '../../src/shared/config';
import {
  createCanvasMeasurer,
  estimatedWidth,
  layoutText,
  type Measurer,
} from '../../src/client/objects/textLayout';

/**
 * text.layout unit tests (TC-07 to TC-11, TC-32).
 *
 * A fake measurer does the measuring: "a fixed number of world units per character at each
 * `TEXT_SIZES` value", which is what the design asks for and what makes the numbers below exact
 * rather than whatever font this machine happens to have. The real measurer is tested only for the
 * one thing that can be tested without a screen: that it answers with a number when there is no
 * canvas to measure with, so a board still lays out text on a machine that will not draw one.
 */

/** Ten world units to the character at size M, five at size S, twenty-eight at XL. */
const PER_CHARACTER_RATIO = 0.5;

const measure: Measurer = (text, fontPx) => text.length * fontPx * PER_CHARACTER_RATIO;

/** The same, with the production fallback's ratio: what a browser-less client measures. */
const estimate: Measurer = (text, fontPx) => estimatedWidth(text, fontPx);

/** The height one line costs at a size. */
const lineHeight = (size: TextSize): number => Math.round(TEXT_SIZES[size] * TEXT_LINE_HEIGHT);

/**
 * The height of a box of `count` lines at a size. The rounding happens once, over the whole box,
 * and not per line - which is worth spelling out because at size L a line is 41.6 units and four
 * of them are 124.8 of them, not four separately rounded 42s.
 */
const boxHeight = (count: number, size: TextSize): number =>
  Math.round(count * TEXT_SIZES[size] * TEXT_LINE_HEIGHT);

/** The eighty-five character line: 850 wide at M, which is more than auto mode allows. */
const LONG_LINE =
  'Faster onboarding saves every new teammate an afternoon of guesswork and nobody waits';

const auto = (text: string, size: TextSize = 'M', measureBy: Measurer = measure) =>
  layoutText(text, size, 'auto', null, measureBy);

const fixed = (text: string, width: number | null, size: TextSize = 'M') =>
  layoutText(text, size, 'fixed', width, measure);

describe('text.layout: auto width', () => {
  it('TC-07: is as wide as the line and as tall as the size', () => {
    const box = auto('Went well');

    expect(box.width).toBe(measure('Went well', TEXT_SIZES.M));
    expect(box.width).toBe(90);
    expect(box.height).toBe(26);
    expect(box.height).toBe(lineHeight('M'));
    expect(box.lines).toEqual(['Went well']);
  });

  it('TC-08: breaks a line that is longer than the allowance at a word boundary', () => {
    expect(measure(LONG_LINE, TEXT_SIZES.M)).toBe(850);

    const box = auto(LONG_LINE);

    expect(box.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(box.lines.length).toBe(2);
    // No line was cut mid-word: the two lines are the sentence, with the space it was broken on
    // gone, which is where a browser would have broken it too.
    const [first, second] = box.lines as [string, string];
    expect(LONG_LINE.startsWith(first)).toBe(true);
    expect(first.endsWith(' ')).toBe(false);
    expect(`${first} ${second}`).toBe(LONG_LINE);
    expect(box.height).toBe(2 * lineHeight('M'));
  });

  it('TC-09: takes exactly the allowance for a line that is exactly the allowance', () => {
    const exactly = 'a'.repeat(
      Math.floor(TEXT_MAX_AUTO_WIDTH_WORLD / (TEXT_SIZES.M * PER_CHARACTER_RATIO)),
    );
    expect(measure(exactly, TEXT_SIZES.M)).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);

    const box = auto(exactly);

    expect(box.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(box.lines).toEqual([exactly]);
    expect(box.height).toBe(lineHeight('M'));
  });

  it("never makes an auto box wider than the allowance, however long the text", () => {
    const box = auto(`${LONG_LINE} ${LONG_LINE} ${LONG_LINE}`);
    expect(box.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(box.height).toBeGreaterThan(3 * lineHeight('M'));
  });

  it('sizes the box by its longest line, not by the whole text', () => {
    const longest = 'a much much much longer line than the other two';
    const box = auto(`Went well\nno\n${longest}`);
    expect(box.width).toBe(measure(longest, TEXT_SIZES.M));
  });

  it('has nothing to measure while the text is empty', () => {
    const box = auto('');
    // Zero is not a width the board will store - the model refuses it - so an empty text keeps the
    // width it was created at, the smallest box there is, until there is a character to measure.
    expect(box.width).toBe(0);
    expect(box.height).toBe(lineHeight('M'));
    expect(box.lines).toEqual(['']);
  });
});

describe('text.layout: line breaks the writer typed', () => {
  it('TC-11: never wraps a source line, and counts one line per break', () => {
    const box = auto('Went\nwell\nnow');

    expect(box.lines).toEqual(['Went', 'well', 'now']);
    // 'Went' and 'well' are both four characters, so the width is either of theirs.
    expect(box.width).toBe(measure('well', TEXT_SIZES.M));
    expect(box.height).toBe(3 * lineHeight('M'));
  });

  it('keeps an empty line the writer left in', () => {
    const box = auto('Went\n\nwell');
    expect(box.lines).toEqual(['Went', '', 'well']);
    expect(box.height).toBe(3 * lineHeight('M'));
  });

  it("does not re-wrap what the writer broke by hand, even past the allowance", () => {
    // The same words as TC-08, but broken by hand into two lines that each fit: nothing is broken
    // again at 600, because that break was a decision and not an overflow.
    const first = LONG_LINE.slice(0, 40);
    const second = LONG_LINE.slice(41);
    const box = auto(`${first}\n${second}`);

    expect(box.lines).toEqual([first, second]);
    expect(box.width).toBe(measure(second, TEXT_SIZES.M));
    expect(box.height).toBe(2 * lineHeight('M'));
  });
});

describe('text.layout: fixed width', () => {
  it('TC-10: keeps the width the handle was dragged to and grows down', () => {
    const box = fixed('abc def ghi', TEXT_MIN_WIDTH_WORLD);

    expect(box.width).toBe(TEXT_MIN_WIDTH_WORLD);
    // One three-letter word to a line: 'abc def' measures 70, which 40 does not hold.
    expect(box.lines).toEqual(['abc', 'def', 'ghi']);
    expect(box.height).toBe(3 * lineHeight('M'));
  });

  it('does not widen the box for a word that is too long: it breaks the word instead', () => {
    const box = fixed('supercalifragilistic', TEXT_MIN_WIDTH_WORLD);

    expect(box.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(box.lines.length).toBeGreaterThan(1);
    expect(box.height).toBe(boxHeight(box.lines.length, 'M'));
    // Nothing is lost: the pieces are the word, in order.
    expect(box.lines.join('')).toBe('supercalifragilistic');
  });

  it('never lays out a fixed box narrower than the box the product allows', () => {
    expect(fixed('Went well', 12).width).toBe(TEXT_MIN_WIDTH_WORLD);
    // A fixed mode with no width in the document is the minimum, not a request for auto.
    expect(fixed('Went well', null).width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(fixed('Went well', Number.NaN).width).toBe(TEXT_MIN_WIDTH_WORLD);
  });

  it('wraps at the width it was given, not at the auto allowance', () => {
    // 'Went well' measures 90: it fits in 90 and not in 60, both far below the 600 auto allows.
    expect(fixed('Went well', 90).lines).toEqual(['Went well']);
    expect(fixed('Went well', 60).lines).toEqual(['Went', 'well']);
  });
});

describe('text.layout: the size', () => {
  it('scales the height with the size and the width with the measurement at that size', () => {
    const text = 'Went well';
    for (const size of ['S', 'M', 'L', 'XL'] as const) {
      const box = auto(text, size);
      expect(box.height).toBe(lineHeight(size));
      expect(box.width).toBe(text.length * TEXT_SIZES[size] * PER_CHARACTER_RATIO);
    }
  });

  it('wraps at the same width whatever the size, so a bigger size means more lines', () => {
    const text = 'Faster onboarding saves every new teammate';
    const small = auto(text, 'S');
    const large = auto(text, 'L');

    expect(small.lines.length).toBe(1);
    expect(large.lines.length).toBeGreaterThanOrEqual(2);
    expect(large.width).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(large.height).toBe(boxHeight(large.lines.length, 'L'));
    expect(large.height).toBeLessThan(large.lines.length * lineHeight('L'));
  });

  it('measures the same box twice, because two clients have to agree', () => {
    // The layout may depend on nothing but its arguments: if it did not, the second client's box
    // would disagree with the first's and the two would fight in the document forever.
    expect(auto(LONG_LINE)).toEqual(auto(LONG_LINE));
    expect(fixed('abc def ghi', TEXT_MIN_WIDTH_WORLD)).toEqual(
      fixed('abc def ghi', TEXT_MIN_WIDTH_WORLD),
    );
  });
});

describe('text.layout: the real measurer with no canvas (TC-32)', () => {
  it('TC-32: answers with the estimate when there is no canvas to measure with', () => {
    const measured = createCanvasMeasurer();

    expect(typeof measured('Went well', TEXT_SIZES.M)).toBe('number');
    expect(Number.isFinite(measured('Went well', TEXT_SIZES.M))).toBe(true);
    expect(measured('Went well', TEXT_SIZES.M)).toBe(9 * TEXT_SIZES.M * TEXT_ESTIMATED_GLYPH_RATIO);
    expect(measured('', TEXT_SIZES.M)).toBe(0);
  });

  it('lays out with the estimate, and gets the same box as the estimate', () => {
    const fallback = createCanvasMeasurer('Some Font Nobody Has Installed');

    expect(() => auto(LONG_LINE, 'M', fallback)).not.toThrow();
    expect(auto(LONG_LINE, 'M', fallback)).toEqual(auto(LONG_LINE, 'M', estimate));
  });

  it('estimates by characters, which is the whole point of the fallback', () => {
    expect(estimate('abcd', 20)).toBe(40);
    expect(estimate('abcd', 20)).toBe(4 * 20 * TEXT_ESTIMATED_GLYPH_RATIO);
    expect(estimate('', 20)).toBe(0);
  });
});
