/**
 * Text measurement and wrapping - `tests/unit/text-layout.test.ts`.
 *
 * `src/client/objects/textLayout.ts` is the only place that decides how wide and
 * how tall a piece of text is, and it is a pure function of
 * (text, size, width mode, fixed width, measurer) so the rules can be tested with
 * a fake measurer whose arithmetic is known exactly. The fake used here charges
 * {@link UNIT} board units per character, which makes a line's width its character
 * count times UNIT and lets every boundary be named rather than estimated.
 *
 * What is being protected: the automatic width stops at
 * `TEXT_MAX_AUTO_WIDTH_WORLD` and wraps instead of growing forever, a line that
 * measures exactly that limit is *not* wrapped (the limit is inclusive), the
 * height is always `lines x font size x TEXT_LINE_HEIGHT`, and a measurer that
 * throws or is missing entirely still produces a box instead of an exception.
 *
 * The real canvas measurement is only checked for not throwing (TC-32): what the
 * browser paints from a box is story 9's e2e spec's business.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_TEXT_SIZE,
  TEXT_AUTO_WIDTH_PADDING_WORLD,
  TEXT_GLYPH_WIDTH_RATIO,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_SIZE_NAMES,
} from '../../src/shared/config.js';
import {
  createCanvasMeasurer,
  layoutText,
  type Measurer,
} from '../../src/client/objects/textLayout.js';

/** The fake measurer's price, in board units, for one character. */
const UNIT = 1;

/** A measurer that charges `UNIT` board units per character (font size ignored). */
const linear = (text: string): number => text.length * UNIT;

/** The same, but 3 board units per character: words that will not pair up. */
const wide = (text: string): number => text.length * 3;

const auto = (text: string, measure: Measurer = linear, size = DEFAULT_TEXT_SIZE) =>
  layoutText(text, size, 'auto', null, measure);

describe('text.layout', () => {
  it('TC-07 makes the box just wider than the words, and one line tall', () => {
    const text = 'the retro board went well for us all';
    const layout = auto(text);

    const measured = text.length * UNIT;
    expect(layout.lines).toEqual([text]);
    expect(layout.width).toBe(measured + TEXT_AUTO_WIDTH_PADDING_WORLD);
    expect(layout.width).toBeGreaterThan(measured);
    expect(layout.height).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });

  it('never makes an automatic box narrower than the narrowest allowed', () => {
    // A single character costs less than TEXT_MIN_WIDTH_WORLD to measure; the
    // object still has a box a handle can be grabbed on.
    const layout = auto('a');

    expect(layout.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(TEXT_MIN_WIDTH_WORLD).toBeGreaterThan('a'.length * UNIT + TEXT_AUTO_WIDTH_PADDING_WORLD);
  });

  it('TC-08 wraps a line that is wider than the limit and stops growing', () => {
    const line = `${'word '.repeat(200)}x`.trimEnd();
    expect(linear(line)).toBeGreaterThan(TEXT_MAX_AUTO_WIDTH_WORLD);

    const layout = auto(line);

    expect(layout.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(layout.lines.length).toBeGreaterThan(1);
    // No wrapped line is wider than the limit; the height is that many lines.
    for (const wrapped of layout.lines) {
      expect(linear(wrapped)).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD);
    }
    expect(layout.height).toBe(layout.lines.length * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });

  it('TC-09 leaves a line that measures exactly the limit alone, at the limit', () => {
    const exact = 'a'.repeat(TEXT_MAX_AUTO_WIDTH_WORLD / UNIT);
    expect(linear(exact)).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);

    const layout = auto(exact);

    expect(layout.lines).toEqual([exact]);
    expect(layout.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(layout.height).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });

  it('TC-10 wraps inside the fixed width, one word per line when they will not pair', () => {
    // 3 board units a character in a 40-unit box: each 8-character word takes a
    // line to itself, because two of them plus a space need 51 units.
    const layout = layoutText(
      'alphabet betagamma gammasix',
      DEFAULT_TEXT_SIZE,
      'fixed',
      TEXT_MIN_WIDTH_WORLD,
      wide,
    );

    expect(layout.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(layout.lines).toEqual(['alphabet', 'betagamma', 'gammasix']);
    expect(layout.height).toBe(3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });

  it('TC-11 keeps the newlines the user typed, and the empty last line too', () => {
    const longest = 'the line that decides how wide the box is';
    const layout = auto(`a\n${longest}\n`);

    expect(layout.lines).toEqual(['a', longest, '']);
    expect(layout.width).toBe(longest.length * UNIT + TEXT_AUTO_WIDTH_PADDING_WORLD);
    expect(layout.height).toBe(3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });

  it('uses the font size of the size name for the height', () => {
    for (const size of TEXT_SIZE_NAMES) {
      const layout = auto('one line', linear, size);
      expect(layout.height).toBe(TEXT_SIZES[size] * TEXT_LINE_HEIGHT);
      // The measurer is asked at the size's own font size, in board units.
      const asked: number[] = [];
      const spy: Measurer = (text, fontPx) => {
        asked.push(fontPx);
        return linear(text);
      };
      auto('one line', spy, size);
      expect(asked.length).toBeGreaterThan(0);
      expect(new Set(asked)).toEqual(new Set([TEXT_SIZES[size]]));
    }
  });

  it('re-wraps the same text at a smaller size into fewer lines', () => {
    // The same words, the same limit: a bigger font size means more lines (TC-02
    // of the PRD is about the size; this is the layout side of it).
    const text = 'everything the user typed is measured again on every change';
    const small = auto(text, (value, fontPx) => value.length * fontPx * 0.5, 'S');
    const large = auto(text, (value, fontPx) => value.length * fontPx * 0.5, 'XL');

    expect(small.lines.length).toBe(1);
    expect(large.lines.length).toBeGreaterThan(1);
    expect(large.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
  });

  it('never lets an unbreakable word widen the box past the limit', () => {
    const word = 'supercalifragilisticexpialidocious'.repeat(20);
    const layout = auto(word);

    expect(layout.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(layout.lines.length).toBeGreaterThan(1);
    for (const line of layout.lines) expect(linear(line)).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD);
  });

  it('breaks a word too long for a fixed width instead of overflowing it', () => {
    const word = 'antidisestablishmentarianism'.repeat(2);
    const layout = layoutText(word, DEFAULT_TEXT_SIZE, 'fixed', TEXT_MIN_WIDTH_WORLD, linear);

    // 40 units at 1 unit a character: 40 characters to a line, and the rest on
    // the next one - which is what `overflow-wrap: break-word` paints.
    expect(layout.lines.length).toBe(2);
    expect(layout.lines[0]).toHaveLength(TEXT_MIN_WIDTH_WORLD);
    expect(layout.height).toBe(2 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });

  it('counts an empty text as one line, so a new text object has a box', () => {
    for (const layout of [auto(''), layoutText('', DEFAULT_TEXT_SIZE, 'fixed', 240, linear)]) {
      expect(layout.lines).toEqual(['']);
      expect(layout.height).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
      expect(layout.width).toBeGreaterThanOrEqual(TEXT_MIN_WIDTH_WORLD);
    }
    // A fixed box never shrinks below the width the user dragged to, even empty.
    expect(layoutText('', DEFAULT_TEXT_SIZE, 'fixed', 240, linear).width).toBe(240);
  });

  it('clamps a fixed width that is too small, and takes an unknown size for the default', () => {
    expect(layoutText('ab', DEFAULT_TEXT_SIZE, 'fixed', 1, linear).width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(layoutText('ab', 'XXL' as never, 'auto', null, linear).height).toBe(
      TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT,
    );
    expect(auto('ab', linear, 'Huge' as never).height).toBe(
      TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT,
    );
  });

  it('TC-32 estimates when the measurer is not available, and never throws', () => {
    const throwing = vi.fn(() => {
      throw new Error('no measurement backend');
    });

    const layout = auto('some words to lay out', throwing as unknown as Measurer);

    expect(layout.lines.length).toBeGreaterThan(0);
    expect(Number.isFinite(layout.width)).toBe(true);
    expect(Number.isFinite(layout.height)).toBe(true);
    expect(layout.height % (TEXT_SIZES.M * TEXT_LINE_HEIGHT)).toBeCloseTo(0);

    // The canvas measurer itself: this environment has no canvas at all, and it
    // still returns a number, priced at the glyph ratio.
    const measure = createCanvasMeasurer();
    expect(measure('abc', 20)).toBe(3 * 20 * TEXT_GLYPH_WIDTH_RATIO);
    expect(measure('', 20)).toBe(0);
    expect(() => layoutText('x', DEFAULT_TEXT_SIZE, 'fixed', 100, createCanvasMeasurer())).not.toThrow();
  });

  it('does not wrap a line that fits, whatever the mode', () => {
    const text = 'short';
    expect(auto(text).lines).toEqual([text]);
    expect(layoutText(text, DEFAULT_TEXT_SIZE, 'fixed', 600, linear).lines).toEqual([text]);
  });

  it('treats a line of only spaces as content that still has to fit', () => {
    const spaces = ' '.repeat(60);
    const layout = auto(spaces);

    // Spaces are collapsed for drawing but not for the box: the line is counted.
    expect(layout.lines).toEqual([spaces]);
    expect(layout.width).toBe(spaces.length * UNIT + TEXT_AUTO_WIDTH_PADDING_WORLD);
  });
});
