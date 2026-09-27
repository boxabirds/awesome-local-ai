// Story 9, text.layout: the wrapping maths, with a fake measurer (design
// Test Strategy: "deterministic maths" — real fonts are exercised in e2e).
import { describe, it, expect } from 'vitest';
import {
  layoutAuto,
  layoutFixed,
  fontSpec,
  estimateWidth,
  createCanvasMeasurer,
  wrapLine,
} from '../../src/client/objects/text/text-layout';
import { TEXT_MAX_AUTO_WIDTH_WORLD, TEXT_LINE_HEIGHT, TEXT_SIZES } from '../../src/shared/config';

/** A measurer that charges `per` world units per character. */
function fixed(per: number) {
  return (text: string) => text.length * per;
}

const M = fontSpec('M');

describe('TC-07 auto width follows the measured line', () => {
  it('a short line yields one line, padded to its measured width', () => {
    const layout = layoutAuto('Went well', M, undefined, fixed(10));
    expect(layout.lines).toHaveLength(1);
    // 9 characters × 10 = 90 measured, plus the horizontal padding on both
    // sides: the box is wider than the glyphs, never narrower.
    expect(layout.width).toBeGreaterThan(90);
    expect(layout.width).toBeLessThan(TEXT_MAX_AUTO_WIDTH_WORLD);
    // One line tall: line height = font size × the shared ratio.
    expect(layout.height).toBeGreaterThanOrEqual(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });

  it('the empty block still has a box (it must be clickable)', () => {
    const layout = layoutAuto('', M, undefined, fixed(10));
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
    expect(layout.lines).toEqual(['']);
  });
});

describe('TC-08 a line past the auto cap wraps instead of growing', () => {
  it('a 900-unit line caps at TEXT_MAX_AUTO_WIDTH_WORLD and wraps to 2+ lines', () => {
    const long = 'x'.repeat(90); // 900 units at 10 per character
    const layout = layoutAuto(long, M, undefined, fixed(10));
    expect(layout.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(layout.lines.length).toBeGreaterThanOrEqual(2);
    // Every drawn line fits inside the box: nothing is clipped horizontally.
    for (const line of layout.lines) {
      expect(fixed(10)(line)).toBeLessThanOrEqual(layout.width);
    }
  });

  it('TC-09 boundary: a line just under the cap stays on one line at the cap', () => {
    const nearlyMax = 'y'.repeat(58); // 580 units measured, under the 600 cap
    const layout = layoutAuto(nearlyMax, M, undefined, fixed(10));
    expect(layout.lines).toHaveLength(1);
    expect(layout.width).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(layout.width).toBeGreaterThan(580);
  });
});

describe('TC-10 fixed width keeps its width and grows downwards', () => {
  it('three words at 40 units wrap per word and grow in height', () => {
    const wide = layoutAuto('alpha beta gamma', M, undefined, fixed(10));
    const narrow = layoutFixed('alpha beta gamma', 40, M, fixed(10));
    expect(narrow.width).toBe(Math.max(40, 40));
    expect(narrow.lines.length).toBeGreaterThan(1);
    expect(narrow.height).toBeGreaterThan(wide.height);
  });

  it('a fixed box never shrinks below the declared minimum width', () => {
    const layout = layoutFixed('abc', 10, M, fixed(10));
    expect(layout.width).toBe(40); // TEXT_MIN_WIDTH_WORLD
  });

  it('wrapLine breaks a single word wider than the box', () => {
    const lines = wrapLine('supercalifragilistic', 40, M, fixed(10));
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(fixed(10)(line)).toBeLessThanOrEqual(40);
  });
});

describe('TC-11 multi-line input', () => {
  it('width follows the longest line and height counts every line', () => {
    const short3 = layoutAuto('a\nbb\nccc', M, undefined, fixed(10));
    const long3 = layoutAuto('a\nbb\n' + 'd'.repeat(20), M, undefined, fixed(10));
    expect(long3.width).toBeGreaterThan(short3.width);
    expect(long3.height).toBe(short3.height); // same three lines
    expect(long3.lines).toHaveLength(3);
    // A wrapped line adds height too: the fourth line is not free.
    const wrapped = layoutAuto('d'.repeat(200), M, undefined, fixed(10));
    expect(wrapped.height).toBeGreaterThan(long3.height);
  });
});

describe('TC-32 error path: no canvas, no throw', () => {
  it('the estimate falls back to a proportional glyph width', () => {
    expect(estimateWidth('aaaa', M)).toBeCloseTo(4 * TEXT_SIZES.M * 0.55);
    expect(estimateWidth('', M)).toBe(0);
  });

  it('createCanvasMeasurer works without a canvas and never throws', () => {
    const measure = createCanvasMeasurer();
    expect(() => measure('hello world', M)).not.toThrow();
    expect(measure('hello world', M)).toBeGreaterThan(0);
    // Empty text measures nothing, so an empty block stays small.
    expect(measure('', M)).toBe(0);
  });
});
