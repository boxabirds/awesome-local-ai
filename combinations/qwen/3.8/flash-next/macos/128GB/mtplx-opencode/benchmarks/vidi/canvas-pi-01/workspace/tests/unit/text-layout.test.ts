/**
 * Story 9 · task 3 — text layout unit tests (TC-07 to TC-11, TC-32).
 *
 * A **fake measurer** keeps the maths deterministic: instead of real font
 * metrics (exercised in e2e), it returns a fixed world width per string (or a
 * fixed per-character width). jsdom has no canvas in the unit project, so the
 * fallback estimate path is what these tests pin down (TC-32).
 */
import { describe, expect, it } from 'vitest';
import {
  createCanvasMeasurer,
  estimateMeasurer,
  layoutText,
  type Measurer,
} from '../../src/client/objects/textLayout';
import {
  TEXT_GLYPH_WIDTH_RATIO,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';

/** A measurer that reports a fixed width for a few known strings. */
function fixedWidth(table: Record<string, number>): Measurer {
  return (text, _fontPx) => table[text] ?? text.length;
}

/** A measurer using a constant width per character (world units). */
function perChar(width: number): Measurer {
  return (text, _fontPx) => text.length * width;
}

describe('auto width (TC-07 to TC-09)', () => {
  it('TC-07: a short line sizes the box to the measured line, one line tall', () => {
    const text = 'Went well';
    const width = 90;
    const box = layoutText(text, 'M', 'auto', null, fixedWidth({ [text]: width }));
    // Width follows the measurement; height is one line at M (20 × 1.3).
    expect(box.width).toBeCloseTo(width, 3);
    expect(box.lines.length).toBe(1);
    expect(box.height).toBeCloseTo(TEXT_SIZES.M * TEXT_LINE_HEIGHT, 3);
  });

  it('TC-08: a line wider than the auto cap wraps into two lines at the cap', () => {
    // One unbroken "line" that measures 900 → capped to 600, greedy-wrapped.
    const long = 'aaaaaaaaaa '.repeat(90).trim(); // 90 words, each 10 chars + space
    // Fake: width is 10 per character; the whole line measures well past 600.
    const box = layoutText(long, 'M', 'auto', null, perChar(10));
    expect(box.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(box.lines.length).toBeGreaterThan(1);
    // Height is two-or-more lines.
    expect(box.height).toBeGreaterThan(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });

  it('TC-09: a line measuring exactly the cap stays one line at the cap (boundary)', () => {
    // 60 chars × 10 world-px per char = 600, exactly the auto cap.
    const text = 'x'.repeat(60);
    const box = layoutText(text, 'M', 'auto', null, perChar(10));
    expect(box.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(box.lines.length).toBe(1);
  });
});

describe('fixed width (TC-10)', () => {
  it('a narrow fixed box wraps one word per line and grows the height', () => {
    // Three short words; each word alone fits inside 40 but the triple does not.
    const text = 'aaa bbb ccc';
    const box = layoutText(text, 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, perChar(6));
    // 'aaa bbb ccc' measures 66 > 40; greedy wrap splits it into separate words.
    expect(box.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(box.lines.length).toBe(3);
    expect(box.height).toBeCloseTo(3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT, 3);
  });
});

describe('explicit newlines (TC-11)', () => {
  it('width follows the longest line and height counts every line', () => {
    const text = 'a\nbbbb\ncc';
    // 'bbbb' is the widest (4 chars); three lines total.
    const box = layoutText(text, 'M', 'auto', null, perChar(5));
    expect(box.width).toBeCloseTo(4 * 5, 3);
    expect(box.lines.length).toBe(3);
    expect(box.height).toBeCloseTo(3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT, 3);
  });
});

describe('createCanvasMeasurer fallback (TC-32)', () => {
  it('estimates with the glyph ratio when no canvas exists, and never throws', () => {
    const measure = createCanvasMeasurer('Inter, sans-serif');
    // In the node unit project there is no canvas, so this is the estimate path.
    const width = measure('hello', TEXT_SIZES.M);
    expect(width).toBeCloseTo(5 * TEXT_SIZES.M * TEXT_GLYPH_WIDTH_RATIO, 3);
    // Empty text measures zero; a huge string still returns a finite number.
    expect(measure('', TEXT_SIZES.M)).toBe(0);
    expect(Number.isFinite(measure('x'.repeat(10_000), TEXT_SIZES.XL))).toBe(true);
  });

  it('the estimate measurer agrees with the ratio constant', () => {
    expect(estimateMeasurer('abcd', 20)).toBeCloseTo(4 * 20 * TEXT_GLYPH_WIDTH_RATIO, 6);
  });
});
