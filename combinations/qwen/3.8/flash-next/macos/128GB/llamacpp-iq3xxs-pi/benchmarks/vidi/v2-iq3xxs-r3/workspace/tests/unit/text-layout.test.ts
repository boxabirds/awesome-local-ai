/**
 * Story 9: text layout (task 3) — the pure maths behind "grows, then wraps",
 * with a fake measurer so the numbers are exact.
 *
 * The measurer is the only thing in the board's layout path that needs a font,
 * and it is passed in rather than reached for: the same function runs against a
 * canvas in the browser (`createCanvasMeasurer`), against an estimate when there
 * is no canvas (TC-32), and against the fixed rule below in every test here.
 *
 * The fake measurer is `characters × fontPx × 0.5`, so at size M (20 board
 * units) a character is 10 units wide — the arithmetic a reader can check.
 */

import { describe, expect, it } from 'vitest';

import {
  TEXT_BOX_PADDING_WORLD,
  TEXT_ESTIMATED_GLYPH_RATIO,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config.js';
import type { TextSize } from '../../src/shared/config.js';
import {
  createCanvasMeasurer,
  layoutText,
  type Measurer,
} from '../../src/client/objects/textLayout.js';

/** The fake measurer: 10 board units to a character at size M. */
const measure: Measurer = (text, fontPx) => text.length * fontPx * 0.5;

/** The width `measure` gives a line at `size`, for spelling out expectations. */
function measured(text: string, size: TextSize): number {
  return measure(text, TEXT_SIZES[size]);
}

/** How tall `lines` lines of `size` are, as the layout reports them. */
function tallFor(lines: number, size: TextSize): number {
  return Math.round(lines * TEXT_SIZES[size] * TEXT_LINE_HEIGHT);
}

const PAD = TEXT_BOX_PADDING_WORLD * 2;

describe('story 9 text layout (text.layout)', () => {
  // TC-07 — a short line: the box is the line plus the room at its edges, one
  // line tall (`text.auto_width`, `text.height`).
  it('TC-07: a short line gives a box just wider than the words', () => {
    expect(measured('Went well', 'M')).toBe(90);

    const box = layoutText('Went well', 'M', 'auto', null, measure);
    expect(box.lines).toEqual(['Went well']);
    expect(box.width).toBe(90 + PAD);
    expect(box.height).toBe(tallFor(1, 'M'));
    expect(box.height).toBe(Math.round(TEXT_SIZES.M * TEXT_LINE_HEIGHT));
  });

  // TC-08 — a line wider than the automatic limit: the box stops at the limit
  // and the words wrap onto another line.
  it('TC-08: a line measuring 900 becomes a 600-wide box of two lines', () => {
    const long = 'a'.repeat(90); // 900 units wide at M
    const text = `${long} word`;
    expect(measured(long, 'M')).toBe(900);

    const box = layoutText(text, 'M', 'auto', null, measure);
    expect(box.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(box.lines).toEqual([long, 'word']);
    expect(box.height).toBe(tallFor(2, 'M'));
    // The wrapped words that could be broken fit inside the limit; the one line
    // that cannot be broken (a single 900-unit word) is what it is.
    for (const line of box.lines) {
      if (!line.includes(' ')) continue;
      expect(measured(line, 'M')).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD);
    }
    expect(box.lines.join(' ')).toBe(text); // wrapping loses nothing
  });

  // TC-09 — the boundary: a line exactly at the limit is one line, and the box
  // is exactly the limit.
  it('TC-09: a line measuring exactly 600 stays one line at width 600', () => {
    const exact = 'w'.repeat(60); // 600 units wide at M
    expect(measured(exact, 'M')).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);

    const box = layoutText(exact, 'M', 'auto', null, measure);
    expect(box.lines).toHaveLength(1);
    expect(box.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(box.height).toBe(tallFor(1, 'M'));
  });

  // TC-10 — a fixed width at the minimum, with words too wide for it: one word
  // to a line, and the height grows to hold them (`text.fixed_width`).
  it('TC-10: a fixed minimum width puts one long word on each line', () => {
    const text = 'wide wide wide';
    expect(measured('wide', 'M')).toBe(40);

    const box = layoutText(text, 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, measure);
    expect(box.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(box.lines).toEqual(['wide', 'wide', 'wide']);
    expect(box.height).toBe(tallFor(3, 'M'));
  });

  // TC-11 — line breaks someone typed are kept, the box is as wide as its
  // widest line, and the height is the line count.
  it('TC-11: explicit newlines give one line each and a height for all of them', () => {
    const text = 'Went well\nTo improve\nDetail';
    expect(measured('To improve', 'L')).toBe(160); // the longest line

    const box = layoutText(text, 'L', 'auto', null, measure);
    expect(box.lines).toEqual(['Went well', 'To improve', 'Detail']);
    expect(box.width).toBe(160 + PAD);
    expect(box.height).toBe(tallFor(3, 'L'));
    // A stored box is a whole number of board units, whatever the maths says.
    expect(Math.abs(box.height - 3 * TEXT_SIZES.L * TEXT_LINE_HEIGHT)).toBeLessThan(1);
  });

  it('wraps a long run of words into as many lines as the box needs', () => {
    // Twelve 10-character words are 12 × 100 units at M; the content is 584
    // units wide, so five fit on a line and the twelfth starts a fourth one.
    const text = Array.from({ length: 12 }, (_, i) => 'word'.padEnd(10, String(i))).join(' ');
    const box = layoutText(text, 'M', 'auto', null, measure);
    // The box is as wide as the widest line it ended up with (and never wider
    // than the limit), so a wrapped paragraph does not leave it 600 wide with a
    // line of words that stopped short.
    expect(box.width).toBe(540 + PAD);
    expect(box.width).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(box.lines).toHaveLength(Math.ceil(12 / 5));
    expect(box.height).toBe(tallFor(3, 'M'));
    expect(box.lines.join(' ')).toBe(text); // wrapping loses nothing
  });

  it('keeps a fixed width whatever the content says', () => {
    const box = layoutText('Went well', 'M', 'fixed', 300, measure);
    expect(box.width).toBe(300);
    expect(box.lines).toEqual(['Went well']);
  });

  it('never narrows an empty text past the minimum width', () => {
    // The box a text is created with, so a heading-in-waiting has room for a
    // caret and a click target before anyone has typed in it.
    const box = layoutText('', 'M', 'auto', null, measure);
    expect(box.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(box.height).toBe(tallFor(1, 'M'));
    expect(layoutText('', 'M', 'fixed', 90, measure).width).toBe(90);
  });

  it('grows the box with the size preset, whatever the words', () => {
    const small = layoutText('Went well', 'S', 'auto', null, measure);
    const large = layoutText('Went well', 'XL', 'auto', null, measure);
    expect(large.width).toBeGreaterThan(small.width);
    expect(large.height).toBe(tallFor(1, 'XL'));
    expect(small.height).toBe(tallFor(1, 'S'));
  });

  // TC-32 — the error path: with nothing to measure with, layout still answers,
  // from an estimate, and never throws.
  it('TC-32: falls back to an estimate when there is no canvas to measure with', () => {
    const estimate = createCanvasMeasurer();
    // This test runs with no `document` and no `OffscreenCanvas` at all.
    expect(typeof estimate('Went well', TEXT_SIZES.M)).toBe('number');
    expect(estimate('Went well', TEXT_SIZES.M)).toBeCloseTo(
      9 * TEXT_SIZES.M * TEXT_ESTIMATED_GLYPH_RATIO,
      6,
    );
    expect(estimate('', 20)).toBe(0);
    expect(Number.isFinite(estimate('x'.repeat(5_000), TEXT_SIZES.XL))).toBe(true);

    // And the layout built on it is a box like any other, so a text object on a
    // machine that cannot measure is a text object with a slightly approximate
    // box, not a broken one.
    const box = layoutText('Went well\nTo improve', 'M', 'auto', null, estimate);
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBe(tallFor(2, 'M'));
  });
});
