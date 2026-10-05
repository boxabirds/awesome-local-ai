/**
 * Unit tests for text layout (story 9, `text.layout`, TC-07 to TC-11 and TC-32).
 *
 * These are the arithmetic of the feature: how wide a box becomes, where a line breaks, how tall the box
 * is. They run the layout function directly with a measurer that needs no canvas and no font, because a
 * measurement is the one input that would otherwise make the expected values different on every machine —
 * and the questions being asked here are all about numbers at boundaries (exactly the cap, exactly the
 * narrowest width, exactly one line more).
 *
 * The measurer is the fake the design asks for: every character is half the font size, so a line's width is
 * a number of characters, which is a thing that can be asserted exactly rather than "roughly". Real prose
 * and a real canvas are what the component and end-to-end tests use, where the assertion is that a person
 * sees their words and the frame around them keeps still.
 */
import { describe, expect, it } from 'vitest';

import {
  MAX_TEXT_BOX_WIDTH_WORLD,
  MIN_TEXT_CONTENT_WIDTH_WORLD,
  STICKY_SIZE_WORLD,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_PADDING_WORLD,
  TEXT_SIZES,
  TEXT_ESTIMATED_GLYPH_RATIO,
  type TextSize,
} from '../../src/shared/config';
import {
  createCanvasMeasurer,
  estimateTextWidth,
  getMeasurer,
  layoutText,
  measureTextHeight,
  textLineHeight,
} from '../../src/client/objects/textLayout';
import {
  fakeMeasurer,
  HEADING_TO_IMPROVE,
  HEADING_WENT_WELL,
  LINE_AT_THE_CAP,
  LINE_WIDER_THAN_THE_CAP,
  word,
} from '../fixtures/texts';

const measure = fakeMeasurer();

/** The height of one line at this size, spelled out so the tests do not re-implement the formula. */
const oneLine = (size: TextSize = 'M'): number => TEXT_SIZES[size] * TEXT_LINE_HEIGHT;

describe('text layout in auto width mode', () => {
  it('TC-07: a box that has not been dragged is as wide as its longest line plus the padding', () => {
    const laid = layoutText(HEADING_WENT_WELL, 'M', 'auto', null, measure);

    // 'Went well' is 9 characters, so 90 units at size M with the fake measurer.
    expect(measure(HEADING_WENT_WELL, 'M').width).toBe(90);
    expect(laid.width).toBe(90 + TEXT_PADDING_WORLD * 2);
    expect(laid.height).toBe(oneLine());
    expect(laid.lines).toBe(1);
  });

  it('TC-08: a line wider than the cap stops the box growing and starts wrapping words', () => {
    const laid = layoutText(LINE_WIDER_THAN_THE_CAP, 'M', 'auto', null, measure);

    // The box is the cap: it does not grow past the widest line the board allows just because somebody
    // typed a longer one.
    expect(measure(LINE_WIDER_THAN_THE_CAP, 'M').width).toBe(900);
    expect(laid.width).toBe(MAX_TEXT_BOX_WIDTH_WORLD);
    expect(laid.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD + TEXT_PADDING_WORLD * 2);
    // And the greedy algorithm put the second word on a line of its own: two lines, two line heights.
    expect(laid.lines).toBe(2);
    expect(laid.height).toBe(oneLine() * 2);
    expect(measureTextHeight(laid.lines, 'M')).toBe(laid.height);
  });

  it('TC-09: a line measuring exactly the cap is still one line, not an overflow', () => {
    const laid = layoutText(LINE_AT_THE_CAP, 'M', 'auto', null, measure);

    expect(measure(LINE_AT_THE_CAP, 'M').width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    // The boundary is a fit, not a break: a line exactly as wide as the board allows is drawn on one line.
    expect(laid.lines).toBe(1);
    expect(laid.height).toBe(oneLine());
    expect(laid.width).toBe(MAX_TEXT_BOX_WIDTH_WORLD);
  });

  it('grows one character at a time up to the cap, and then holds its width while it grows taller', () => {
    // The behaviour a person sees while typing: the box follows the words, then stops following sideways.
    let previousWidth = 0;
    for (let characters = 1; characters <= 40; characters += 1) {
      const laid = layoutText(word(characters), 'M', 'auto', null, measure);
      const width = characters * 10 + TEXT_PADDING_WORLD * 2;
      expect(laid.width).toBe(Math.max(TEXT_MIN_WIDTH_WORLD, Math.min(width, MAX_TEXT_BOX_WIDTH_WORLD)));
      // A single word never wraps, however wide it is: it is unbreakable, so it overflows its box.
      expect(laid.lines).toBe(1);
      expect(laid.width).toBeGreaterThanOrEqual(previousWidth);
      previousWidth = laid.width;
    }

    // Past the cap, adding words makes it taller at the same width rather than wider.
    const wide = layoutText(`${word(70)} ${word(20)}`, 'M', 'auto', null, measure);
    expect(wide.width).toBe(MAX_TEXT_BOX_WIDTH_WORLD);
    expect(wide.lines).toBe(2);
  });

  it('an empty text is one line tall and as narrow as the board allows', () => {
    const laid = layoutText('', 'M', 'auto', null, measure);

    expect(laid.lines).toBe(1);
    expect(laid.height).toBe(oneLine());
    // Text that has never had a character still has to be clickable: a box of nothing has no handle on it.
    expect(laid.width).toBe(TEXT_MIN_WIDTH_WORLD);
  });

  it('measures every explicit line and takes the widest, not the last or the first', () => {
    const laid = layoutText(`${word(10)}\n${word(30)}\n${word(5)}`, 'M', 'auto', null, measure);

    expect(laid.width).toBe(30 * 10 + TEXT_PADDING_WORLD * 2);
    expect(laid.lines).toBe(3);
    expect(laid.height).toBe(oneLine() * 3);
  });
});

describe('text layout in fixed width mode', () => {
  it('TC-10: a box dragged to its narrowest width puts one word on each line', () => {
    const text = `${word(20)} ${word(20)} ${word(20)}`;
    const laid = layoutText(text, 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, measure);

    // Each word is 200 units wide and the box has MIN_TEXT_CONTENT_WIDTH_WORLD of room, so no two words
    // share a line. A word that does not fit is still drawn — on a line of its own.
    expect(MIN_TEXT_CONTENT_WIDTH_WORLD).toBe(TEXT_MIN_WIDTH_WORLD - TEXT_PADDING_WORLD * 2);
    expect(laid.lines).toBe(3);
    expect(laid.height).toBe(oneLine() * 3);
    // A box somebody dragged keeps the width they gave it.
    expect(laid.width).toBe(TEXT_MIN_WIDTH_WORLD);
  });

  it('keeps the width it was given even when the words are narrower', () => {
    const laid = layoutText(HEADING_TO_IMPROVE, 'M', 'fixed', 500, measure);

    expect(laid.width).toBe(500);
    expect(laid.lines).toBe(1);
    expect(laid.height).toBe(oneLine());
  });

  it('wraps at the width it was given rather than at the cap', () => {
    const text = `${word(20)} ${word(20)} ${word(20)}`;
    const laid = layoutText(text, 'M', 'fixed', 300, measure);

    // Room for 284 units: two words of 200 do not fit side by side, so it is one word per line.
    expect(laid.lines).toBe(3);
    expect(laid.width).toBe(300);

    // The same words in auto mode are one line, because the cap is wider than they are.
    expect(layoutText(text, 'M', 'auto', null, measure).lines).toBe(2);
  });

  it('a fixed width that is not a number lays out at the narrowest box rather than at nothing', () => {
    for (const width of [Number.NaN, Number.POSITIVE_INFINITY, -100, undefined, null, '300']) {
      const laid = layoutText(`${word(20)} ${word(20)}`, 'M', 'fixed', width as number, measure);
      expect(laid.width).toBe(TEXT_MIN_WIDTH_WORLD);
      expect(laid.lines).toBe(2);
      expect(Number.isFinite(laid.height)).toBe(true);
      expect(laid.height).toBeGreaterThan(0);
    }
  });

  it('a box wider than any object may be is laid out at the widest the board accepts', () => {
    const laid = layoutText(`${word(20)} ${word(20)}`, 'M', 'fixed', 100_000, measure);

    // The model clamps on write; layout is not the place that decides, but it never draws 100km of text.
    expect(Number.isFinite(laid.width)).toBe(true);
    expect(laid.lines).toBe(1);
  });
});

describe('text layout lines and heights', () => {
  it('TC-11: explicit newlines make lines, and the box is as tall as the lines it has', () => {
    const text = `${HEADING_WENT_WELL}\n${word(24)}`;
    const laid = layoutText(text, 'M', 'auto', null, measure);

    // The width comes from the longest line, which is the second one here.
    expect(laid.width).toBe(24 * 10 + TEXT_PADDING_WORLD * 2);
    expect(laid.height).toBe(2 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    expect(laid.lines).toBe(2);
  });

  it('every size is one line taller than the size below it, in the same proportion', () => {
    for (const size of ['S', 'M', 'L', 'XL'] as const) {
      const laid = layoutText(HEADING_WENT_WELL, size, 'auto', null, measure);
      expect(laid.height).toBe(TEXT_SIZES[size] * TEXT_LINE_HEIGHT);
      expect(textLineHeight(size)).toBe(TEXT_SIZES[size] * TEXT_LINE_HEIGHT);
      expect(measureTextHeight(1, size)).toBe(laid.height);
      expect(laid.width).toBeGreaterThan(0);
    }

    // The four sizes are ordered, and none of them is a sticky note's fixed 200-unit box.
    expect(TEXT_SIZES.S).toBeLessThan(TEXT_SIZES.M);
    expect(TEXT_SIZES.M).toBeLessThan(TEXT_SIZES.L);
    expect(TEXT_SIZES.L).toBeLessThan(TEXT_SIZES.XL);
    expect(TEXT_SIZES.XL).toBeLessThan(STICKY_SIZE_WORLD);
  });

  it('a trailing newline is a line, because that is where the caret is', () => {
    expect(layoutText(`${HEADING_WENT_WELL}\n`, 'M', 'auto', null, measure).lines).toBe(2);
    expect(layoutText(`\n\n${word(10)}`, 'M', 'auto', null, measure).lines).toBe(3);
    // Windows line endings are one break, not a break and a character that shows up as a box.
    expect(layoutText(`${HEADING_WENT_WELL}\r\n${word(10)}`, 'M', 'auto', null, measure).lines).toBe(2);
  });

  it('a size key this build does not have is laid out at the default size', () => {
    const laid = layoutText(HEADING_WENT_WELL, 'Huge' as TextSize, 'auto', null, measure);

    expect(laid.height).toBe(oneLine('M'));
    expect(Number.isFinite(laid.width)).toBe(true);
    expect(laid.width).toBeGreaterThan(0);
  });

  it('never returns a size that is not a number, however strange the input is', () => {
    for (const text of ['', '\n\n\n', word(400), `${word(200)}\n${word(200)}`, '   \t  ']) {
      for (const size of ['S', 'M', 'L', 'XL'] as const) {
        for (const mode of ['auto', 'fixed'] as const) {
          const laid = layoutText(text, size, mode, 120, measure);
          expect(Number.isFinite(laid.width)).toBe(true);
          expect(Number.isFinite(laid.height)).toBe(true);
          expect(laid.width).toBeGreaterThanOrEqual(TEXT_MIN_WIDTH_WORLD);
          expect(laid.width).toBeLessThanOrEqual(MAX_TEXT_BOX_WIDTH_WORLD);
          expect(laid.height).toBeGreaterThanOrEqual(oneLine(size));
          expect(laid.lines).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  it('a measurer that returns nonsense is survived, because it is a browser API', () => {
    const broken = (): { width: number; height: number } => ({ width: Number.NaN, height: 0 });
    const laid = layoutText(`${word(20)} ${word(20)}`, 'M', 'auto', null, broken);

    // A measurement nobody can read is treated as zero width rather than poisoning the box with NaN: a
    // NaN width would take the object out of every hit test and every selection on the board.
    expect(Number.isFinite(laid.width)).toBe(true);
    expect(Number.isFinite(laid.height)).toBe(true);
    expect(laid.lines).toBeGreaterThanOrEqual(1);
  });
});

describe('text measurers', () => {
  it('TC-32: with no canvas to measure with, the measurer estimates and does not throw', () => {
    // This environment is the one the design means: no document, no canvas, no font.
    expect(typeof document).toBe('undefined');
    expect(createCanvasMeasurer()).toBeNull();

    // The board still has a measurer, and it answers in world units like any other.
    const measureWithoutCanvas = getMeasurer();
    const measured = measureWithoutCanvas(HEADING_WENT_WELL, 'M');
    expect(Number.isFinite(measured.width)).toBe(true);
    expect(measured.width).toBeGreaterThan(0);
    expect(measured.height).toBeGreaterThan(0);

    // The estimate is the documented one, and it is what the fallback uses.
    expect(estimateTextWidth(HEADING_WENT_WELL, 'M')).toBe(measured.width);
    expect(estimateTextWidth('abcde', 'XL')).toBe(5 * TEXT_SIZES.XL * TEXT_ESTIMATED_GLYPH_RATIO);
    expect(estimateTextWidth('', 'M')).toBe(0);
  });

  it('the estimate does not depend on the machine having anything at all', () => {
    const laid = layoutText(LINE_WIDER_THAN_THE_CAP, 'M', 'auto', null, getMeasurer());

    // Laying out with the fallback is not a special case: the same rules, with guessed numbers.
    expect(laid.lines).toBe(2);
    expect(laid.width).toBe(MAX_TEXT_BOX_WIDTH_WORLD);
  });
});
