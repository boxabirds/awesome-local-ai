/**
 * Story 9 unit tests for text measurement and wrapping (`text.layout`): TC-07 to TC-11
 * and TC-32.
 *
 * A fake measurer is the point: layout must be exactly as correct as the surface it was
 * given, and a test that depends on a real font's numbers would be a test that fails on
 * whoever's machine has a different font installed. The fake is arithmetic — one
 * character is `TEXT_GLYPH_WIDTH_RATIO` of the font size wide — so every width in these
 * cases can be written out as a number.
 */

import { describe, expect, it } from 'vitest';
import {
  createCanvasMeasurer,
  estimateTextWidth,
  layoutText,
  measureText,
  type Measurer
} from '../../src/client/objects/textLayout';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_GLYPH_WIDTH_RATIO,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES
} from '../../src/shared/config';

/** One character is half the font size wide. No font, no canvas, no flakiness. */
const fakeMeasure: Measurer = (text, fontPx) => text.length * fontPx * TEXT_GLYPH_WIDTH_RATIO;

/** The width of `text` at `size`, under the same arithmetic. */
const widthOf = (text: string, size: keyof typeof TEXT_SIZES): number =>
  fakeMeasure(text, TEXT_SIZES[size]);

const LINE_M = TEXT_SIZES.M * TEXT_LINE_HEIGHT;

describe('text layout (text.layout)', () => {
  it('TC-07: an auto box is as wide as its longest line, and as tall as one line', () => {
    const layout = layoutText('Went well', 'M', 'auto', undefined, fakeMeasure);

    // 9 characters at 20px, half a character wide: the box is the text, nothing else.
    expect(layout.width).toBe(widthOf('Went well', 'M'));
    expect(layout.width).toBe(90);
    expect(layout.lines).toEqual(['Went well']);
    expect(layout.height).toBe(LINE_M);
  });

  it('TC-07b: the longest line decides the width, not the last one typed', () => {
    const layout = layoutText('go\nthe longest line here\nok', 'M', 'auto', undefined, fakeMeasure);

    expect(layout.width).toBe(widthOf('the longest line here', 'M'));
    // A newline is a line of its own, and it is a line even when it is empty.
    expect(layout.lines).toEqual(['go', 'the longest line here', 'ok']);
    expect(layout.height).toBe(3 * LINE_M);
  });

  it('TC-08: a line wider than the widest auto box wraps, and the box grows by whole lines', () => {
    // Six 20-character words: 1250 units on one line, more than twice the 600 ceiling.
    const word = 'abcdefghij'.repeat(2);
    const text = [word, word, word, word, word, word].join(' ');
    expect(widthOf(text, 'M')).toBeGreaterThan(TEXT_MAX_AUTO_WIDTH_WORLD);

    const layout = layoutText(text, 'M', 'auto', undefined, fakeMeasure);

    expect(layout.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(layout.lines).toHaveLength(3);
    expect(layout.height).toBe(3 * LINE_M);
    // Nothing is lost in the wrapping: every character is still on some line.
    expect(layout.lines.join(' ')).toBe(text);
    // And no line is wider than the box it has to live in.
    for (const line of layout.lines) expect(fakeMeasure(line, TEXT_SIZES.M)).toBeLessThanOrEqual(layout.width);
  });

  it('TC-09: a line of exactly the ceiling stays one line at exactly the ceiling', () => {
    // The boundary in both directions: 600 units wide is allowed, 600.1 is not.
    const chars = TEXT_MAX_AUTO_WIDTH_WORLD / (TEXT_SIZES.M * TEXT_GLYPH_WIDTH_RATIO);
    const exact = 'a'.repeat(chars);

    const atCeiling = layoutText(exact, 'M', 'auto', undefined, fakeMeasure);
    expect(widthOf(exact, 'M')).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(atCeiling.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(atCeiling.lines).toEqual([exact]);
    expect(atCeiling.height).toBe(LINE_M);

    // One character more and the line has to break somewhere; the box does not grow.
    const over = layoutText(`${exact}b`, 'M', 'auto', undefined, fakeMeasure);
    expect(over.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(over.lines).toHaveLength(2);
    expect(over.height).toBe(2 * LINE_M);
  });

  it('TC-10: a given width is kept exactly, and the text wraps inside it', () => {
    const layout = layoutText('alpha beta gamma', 'S', 'fixed', 40, fakeMeasure);

    // The width is the user's, not the content's: `fixed` means the box does not
    // shrink back when a shorter word is typed.
    expect(layout.width).toBe(40);
    // At 14px a character is 7 units, so a five letter word is 35 wide and two of them
    // are 77 — one word per line.
    expect(layout.lines).toEqual(['alpha', 'beta', 'gamma']);
    expect(layout.height).toBe(3 * TEXT_SIZES.S * TEXT_LINE_HEIGHT);

    // A width below the minimum is the minimum: there is always something to grab.
    expect(layoutText('alpha beta gamma', 'S', 'fixed', 10, fakeMeasure).width).toBe(TEXT_MIN_WIDTH_WORLD);
    // A width that is not a number is not a width either.
    expect(layoutText('alpha', 'S', 'fixed', Number.NaN, fakeMeasure).width).toBe(TEXT_MIN_WIDTH_WORLD);
  });

  it('TC-11: empty text is one line tall, so an empty text has a box to type into', () => {
    for (const size of ['S', 'M', 'L', 'XL'] as const) {
      const layout = layoutText('', size, 'auto', undefined, fakeMeasure);
      expect(layout.lines).toEqual(['']);
      expect(layout.height).toBe(TEXT_SIZES[size] * TEXT_LINE_HEIGHT);
      expect(layout.width).toBe(TEXT_MIN_WIDTH_WORLD);
    }

    // A trailing newline is a line the user put there and it is still kept.
    expect(layoutText('a\n', 'M', 'auto', undefined, fakeMeasure).lines).toEqual(['a', '']);
    expect(layoutText('a\n', 'M', 'auto', undefined, fakeMeasure).height).toBe(2 * LINE_M);
  });

  it('the size decides the font, so the same words in XL are four times the box of S', () => {
    const small = layoutText('Went well', 'S', 'auto', undefined, fakeMeasure);
    const large = layoutText('Went well', 'XL', 'auto', undefined, fakeMeasure);

    expect(large.width / small.width).toBeCloseTo(TEXT_SIZES.XL / TEXT_SIZES.S);
    expect(large.height / small.height).toBeCloseTo(TEXT_SIZES.XL / TEXT_SIZES.S);
  });

  it('a size this build does not know is laid out at the default size', () => {
    const layout = layoutText('Went well', 'XXL' as keyof typeof TEXT_SIZES, 'auto', undefined, fakeMeasure);

    expect(layout.height).toBe(TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT);
  });

  it('TC-32: with no surface to measure on, the measurer estimates instead of throwing', () => {
    // This is the `unit` project: node, no canvas and no OffscreenCanvas at all.
    expect(typeof globalThis.document).toBe('undefined');
    expect(typeof (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas).toBe('undefined');

    const measure = createCanvasMeasurer();
    expect(() => measure('Went well', 20)).not.toThrow();
    // An estimate is a guess, but it is a guess with the right shape: it grows with the
    // text and with the font, and it never goes negative or missing.
    expect(measure('Went well', 20)).toBe(estimateTextWidth('Went well', 20));
    expect(measure('Went well better', 20)).toBeGreaterThan(measure('Went well', 20));
    expect(measure('Went well', 40)).toBeGreaterThan(measure('Went well', 20));
    expect(measure('', 20)).toBe(0);
    expect(Number.isFinite(measure('a'.repeat(5000), 56))).toBe(true);

    // And the layout is still a box a user can select, rather than nothing.
    const layout = layoutText('Went well', 'M', 'auto', undefined, measure);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });

  it('measureText is the one call the board uses, and agrees with layoutText', () => {
    const text = 'alpha beta gamma delta';
    expect(measureText(text, 'L', 'fixed', 200, fakeMeasure)).toEqual(
      layoutText(text, 'L', 'fixed', 200, fakeMeasure)
    );
  });
});
