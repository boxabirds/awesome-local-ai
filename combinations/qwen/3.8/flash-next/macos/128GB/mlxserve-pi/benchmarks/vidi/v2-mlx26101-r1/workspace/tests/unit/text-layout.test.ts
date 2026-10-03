// text.layout unit tests (story 9, TC-07 to TC-11, TC-32).
//
// The measurer is injected as a fake: fixed world units per character at each
// TEXT_SIZES value, so every expectation below is a number that can be checked by hand
// instead of a font-metric screenshot. One character at font size S is
// 1 * 14 * 0.5 = 7 units; at M it is 10; a space costs the same as a letter, which is
// what makes the wrap arithmetic exact.
//
// TC-32 is the exception: it deliberately uses the PRODUCTION measurer in an
// environment that has no canvas at all — which is exactly what the node project is.

import { describe, expect, it } from 'vitest';
import {
  createCanvasMeasurer,
  layoutText,
  type TextLayout,
} from '../../src/client/objects/textLayout';
import type { TextSize } from '../../src/shared/config';
import {
  TEXT_AUTO_WIDTH_PADDING_WORLD,
  TEXT_AVG_GLYPH_WIDTH_RATIO,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';
import { RANDOM_WORDS, RETRO_ITEM } from '../fixtures/texts';

/** The fake: 0.5 world units of width per character per unit of font size. */
const measure = (text: string, fontPx: number): number => text.length * fontPx * 0.5;

const auto = (text: string, size: TextSize = 'M'): TextLayout =>
  layoutText(text, size, 'auto', null, measure);

/** Deterministic pseudo-random English words (never a repeated character). */
function words(count: number): string {
  const parts: string[] = [];
  for (let i = 0; i < count; i++) parts.push(RANDOM_WORDS[(i * 7) % RANDOM_WORDS.length]!);
  return parts.join(' ');
}

/** One unbreakable token of exactly `chars` characters. */
function token(chars: number): string {
  let s = '';
  let i = 0;
  while (s.length < chars) {
    s += (s ? '-' : '') + RANDOM_WORDS[i++ % RANDOM_WORDS.length]!;
  }
  return s.slice(0, chars);
}

describe('text.layout', () => {
  it('TC-07 auto width hugs the longest line and the height follows the line count', () => {
    const layout = auto('Went well');
    // 9 characters at 10 units each is the measurement the case is built on.
    expect(measure('Went well', TEXT_SIZES.M)).toBe(90);
    // The box hugs that measurement (plus the air around the text), still inside the cap.
    expect(layout.width).toBe(90 + TEXT_AUTO_WIDTH_PADDING_WORLD);
    expect(layout.width).toBeLessThan(TEXT_MAX_AUTO_WIDTH_WORLD);
    // One line of M.
    expect(layout.lines).toHaveLength(1);
    expect(layout.height).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });

  it('TC-08 a line longer than the cap fills the box to exactly the cap and wraps', () => {
    // Thirty two-letter words: the whole line measures 890 units, far past the cap.
    const text = Array.from({ length: 30 }, (_, i) => (i % 2 ? 'ab' : 'cd')).join(' ');
    const layout = auto(text);
    expect(layout.wrapped).toBe(true);
    // A box that has wrapped is the full TEXT_MAX_AUTO_WIDTH_WORLD, exactly.
    expect(layout.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    // A word is 20 units and a space 10, so n words need 30n - 10: 20 fit on a line
    // (590) and 21 do not (620). Thirty words are therefore two lines.
    expect(layout.lines).toHaveLength(2);
    // Height is recomputed from that line count, never kept from before.
    expect(layout.height).toBe(2 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    // And the widest rendered line still fits inside the box.
    expect(Math.max(...layout.lineWidths)).toBeLessThanOrEqual(layout.width);
  });

  it('TC-09 a line measuring exactly the cap does not wrap', () => {
    // 60 characters at 10 units is exactly 600 — the boundary, not past it.
    const layout = auto(token(60));
    expect(measure(token(60), TEXT_SIZES.M)).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(layout.wrapped).toBe(false);
    expect(layout.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(layout.lines).toHaveLength(1);
    expect(layout.height).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);

    // One more character and the line IS longer than the cap: the box stays at the cap
    // and the text has to wrap. There is no break opportunity inside a single token, so
    // it stays whole — the box does not grow past the cap for it (text.auto_width:
    // "never grows beyond the cap").
    const over = auto(token(61));
    expect(over.wrapped).toBe(true);
    expect(over.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(over.lineWidths[0]).toBeGreaterThan(TEXT_MAX_AUTO_WIDTH_WORLD);
  });

  it('TC-10 a fixed width wraps inside it and words wider than it stay whole', () => {
    const text = 'alpha beta gamma';
    // 'alpha' alone is wider than 40 units (the minimum), so no two words share a line.
    expect(measure('alpha', TEXT_SIZES.M)).toBeGreaterThan(TEXT_MIN_WIDTH_WORLD);
    const layout = layoutText(text, 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, measure);
    expect(layout.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(layout.lines).toEqual(['alpha', 'beta', 'gamma']);
    expect(layout.lineWidths).toEqual([
      measure('alpha', TEXT_SIZES.M),
      measure('beta', TEXT_SIZES.M),
      measure('gamma', TEXT_SIZES.M),
    ]);
    // Nothing is cut off: a word that cannot fit is still drawn whole, overflowing the
    // box rather than being chopped or hyphenated.
    expect(layout.lineWidths.some((w) => w > layout.width)).toBe(true);
    expect(layout.height).toBe(3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);

    // A fixed width below the minimum is clamped up, never used as given.
    const clamped = layoutText(text, 'M', 'fixed', 10, measure);
    expect(clamped.width).toBe(TEXT_MIN_WIDTH_WORLD);
  });

  it('TC-11 explicit newlines always start a new line and drive the height', () => {
    const text = `${RETRO_ITEM.split('\n')[0]}\nTo improve\nLonger line here`;
    const layout = auto(text);
    expect(layout.hardLines).toBe(3);
    expect(layout.lines).toHaveLength(3);
    // Width comes from the longest of the three lines, not the last or the first.
    const widths = layout.lines.map((line) => measure(line, TEXT_SIZES.M));
    expect(layout.width).toBe(Math.max(...widths) + TEXT_AUTO_WIDTH_PADDING_WORLD);
    // Three lines of M.
    expect(layout.height).toBe(3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);

    // An empty explicit line still takes a line of its own.
    const blank = auto('one\n\ntwo');
    expect(blank.hardLines).toBe(3);
    expect(blank.lineWidths[1]).toBe(0);
    expect(blank.lines).toHaveLength(3);
    expect(blank.height).toBe(3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });

  it('TC-32 with no canvas at all the estimate is finite and layout still returns', () => {
    const hasCanvas =
      typeof OffscreenCanvas !== 'undefined' ||
      (typeof document !== 'undefined' && typeof document.createElement === 'function');
    const estimate = createCanvasMeasurer();

    if (!hasCanvas) {
      // This project has no canvas: the measurer must be the character-count estimate,
      // scaled by the font size (never a throw, never zero for non-empty text).
      expect(estimate('hello', TEXT_SIZES.M)).toBeCloseTo(
        TEXT_AVG_GLYPH_WIDTH_RATIO * TEXT_SIZES.M * 'hello'.length,
        10,
      );
    }
    expect(Number.isFinite(estimate('', TEXT_SIZES.M))).toBe(true);
    expect(estimate('hello', TEXT_SIZES.XL)).toBeGreaterThan(
      estimate('hello', TEXT_SIZES.S),
    );

    const layout = layoutText(words(40), 'M', 'auto', null, estimate);
    expect(Number.isFinite(layout.width)).toBe(true);
    expect(Number.isFinite(layout.height)).toBe(true);
    expect(layout.height).toBeGreaterThan(0);
    expect(layout.width).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD);
  });

  it('an empty text still has a box: one line at the smallest usable width', () => {
    const layout = auto('');
    expect(layout.lines).toHaveLength(1);
    expect(layout.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(layout.height).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });

  it('a bigger preset of the same text takes more room', () => {
    const text = words(4);
    const small = auto(text, 'S');
    const large = layoutText(text, 'L', 'auto', null, measure);
    expect(large.width).toBeGreaterThan(small.width);
    expect(large.height).toBeGreaterThan(small.height);
    // The same text at XL wraps where a smaller preset does not, and then the box is
    // the cap rather than a wider hug.
    const long = words(6);
    expect(auto(long, 'S').wrapped).toBe(false);
    expect(layoutText(long, 'XL', 'auto', null, measure).wrapped).toBe(true);
  });
});
