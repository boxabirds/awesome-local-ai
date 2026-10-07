import { describe, it, expect } from 'vitest';
import {
  createCanvasMeasurer,
  estimateMeasurer,
  layoutText,
  lineHeightPx,
  type Measurer,
} from '../../src/client/objects/textLayout';
import {
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_FONT_FAMILY,
} from '../../src/shared/config';
import { RETRO_ITEM } from '../fixtures/texts';

/**
 * A deterministic fake measurer (design "Deterministic measure"): every character
 * is half the font size wide, so at M (20 board units) a character is 10 units and
 * every expected box below is a written-out number rather than a measurement of
 * fonts that differ between machines.
 */
const measure: Measurer = (text, fontPx) => text.length * fontPx * 0.5;

const M = TEXT_SIZES.M; // 20
const LINE_M = M * TEXT_LINE_HEIGHT; // 26

describe('text.layout (src/client/objects/textLayout.ts)', () => {
  // TC-07: a short line is measured, not guessed, and fills exactly one line box.
  it('TC-07 a short line at M in auto mode is one measured line wide and one line high', () => {
    const box = layoutText('Went well', 'M', 'auto', 0, measure);
    const measured = measure('Went well', M); // 9 characters × 10
    expect(measured).toBe(90);
    // PRD text.auto_width: "just wider than the words" — the box is the measured line.
    expect(box.width).toBe(measured);
    expect(box.width).toBeGreaterThan(0);
    expect(box.width).toBeLessThan(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(box.lines).toBe(1);
    expect(box.height).toBe(1 * M * TEXT_LINE_HEIGHT);
    expect(box.height).toBe(LINE_M);
  });

  // TC-08: a line wider than the limit stops at the limit and wraps greedily.
  it('TC-08 a line measuring past the limit becomes TEXT_MAX_AUTO_WIDTH_WORLD and two lines', () => {
    // 65 characters at M measure 650 — past the 600 limit, at ordinary word lengths.
    const text = 'The quick brown fox jumps over the lazy dog and keeps running far';
    expect(measure(text, M)).toBe(650);

    const box = layoutText(text, 'M', 'auto', 0, measure);
    expect(box.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(box.lines).toBe(2); // broken once, at a word boundary
    expect(box.height).toBe(2 * LINE_M); // 52

    // The same words, just under the limit, stay on one line at their own width.
    const short = layoutText(text.slice(0, 54), 'M', 'auto', 0, measure);
    expect(short.width).toBe(540);
    expect(short.lines).toBe(1);
    expect(short.height).toBe(LINE_M);

    // A word that is itself wider than the box is broken at characters, so nothing
    // can overflow the box that gets stored.
    const tooLong = layoutText('x'.repeat(80), 'M', 'fixed', 100, measure);
    expect(tooLong.width).toBe(100);
    expect(tooLong.lines).toBe(8);
    expect(tooLong.height).toBe(8 * LINE_M);
  });

  // TC-09: exactly TEXT_MAX_AUTO_WIDTH_WORLD is still one line (boundary).
  it('TC-09 a line measuring exactly TEXT_MAX_AUTO_WIDTH_WORLD stays on one line', () => {
    const exactly = 'a'.repeat(60); // 60 × 10 = 600, exactly the limit
    expect(measure(exactly, M)).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);

    const box = layoutText(exactly, 'M', 'auto', 0, measure);
    expect(box.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(box.lines).toBe(1);
    expect(box.height).toBe(LINE_M);

    // One character more, and the box grows downwards instead of sideways.
    const over = layoutText(`${exactly}a`, 'M', 'auto', 0, measure);
    expect(over.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(over.lines).toBe(2);
    expect(over.height).toBe(2 * LINE_M);
  });

  // TC-10: fixed mode at the narrowest draggable width — the boundary (boundary).
  it('TC-10 fixed width TEXT_MIN_WIDTH_WORLD puts one word per line and grows the height', () => {
    const box = layoutText('foo bar baz', 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, measure);
    expect(box.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(box.lines).toBe(3); // each word is wider than 40, so one per line
    expect(box.height).toBe(3 * LINE_M); // 78

    // Below the boundary the width is still clamped up to it (PRD text.fixed_width).
    const narrower = layoutText('foo bar baz', 'M', 'fixed', 10, measure);
    expect(narrower.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(narrower.lines).toBe(3);

    // Wider fixed mode wraps less, and never resizes the text itself.
    const wider = layoutText('foo bar baz', 'M', 'fixed', 100, measure);
    expect(wider.width).toBe(100);
    expect(wider.lines).toBe(2);
    expect(wider.height).toBe(2 * LINE_M);
  });

  // TC-11: explicit newlines are always line breaks; width follows the longest line.
  it('TC-11 explicit newlines give one line box each and the width of the longest line', () => {
    const box = layoutText('aaa\nbbbbbb\nccccccccc', 'M', 'auto', 0, measure);
    expect(box.lines).toBe(3);
    expect(box.width).toBe(measure('ccccccccc', M)); // 90, the longest of the three
    expect(box.height).toBe(3 * M * TEXT_LINE_HEIGHT); // 78

    // A trailing newline is a line the person typed, and so is an empty one.
    expect(layoutText('aaa\n', 'M', 'auto', 0, measure).lines).toBe(2);
    expect(layoutText('\n\n', 'M', 'auto', 0, measure).lines).toBe(3);

    // The realistic multi-line fixture keeps its three typed lines at S, and grows
    // into more wrapped lines at XL, always inside the limit.
    const atS = layoutText(RETRO_ITEM, 'S', 'auto', 0, measure);
    expect(atS.lines).toBe(3);
    expect(atS.width).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD);
    const atXL = layoutText(RETRO_ITEM, 'XL', 'auto', 0, measure);
    expect(atXL.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(atXL.lines).toBeGreaterThan(3);
    expect(atXL.height).toBeGreaterThan(atS.height);
  });

  // Height always follows the size preset: lines × size × TEXT_LINE_HEIGHT.
  it('every size preset drives the height through TEXT_LINE_HEIGHT', () => {
    for (const [size, px] of Object.entries(TEXT_SIZES)) {
      const key = size as keyof typeof TEXT_SIZES;
      expect(layoutText('one line', key, 'auto', 0, measure).height).toBe(px * TEXT_LINE_HEIGHT);
      expect(lineHeightPx(key)).toBe(px * TEXT_LINE_HEIGHT);
      const three = layoutText('a\nb\nc', key, 'auto', 0, measure);
      // The stored box is rounded to two decimals, so peers agree on it exactly even
      // though the multiplication itself carries a float tail.
      expect(three.height).toBeCloseTo(3 * px * TEXT_LINE_HEIGHT, 6);
      expect(three.height).toBe(Math.round(three.height * 100) / 100);
    }
  });

  // Empty text still has a box: selection bounds and the marquee must stay finite.
  it('empty text keeps one line and a positive width', () => {
    const empty = layoutText('', 'M', 'auto', 0, measure);
    expect(empty.lines).toBe(1);
    expect(empty.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(empty.height).toBe(LINE_M);
  });

  // TC-32: without a canvas to measure with, the estimate is used and nothing throws.
  it('TC-32 createCanvasMeasurer falls back to an estimate when there is no canvas', () => {
    // This file runs in node: no OffscreenCanvas, no document, no canvas at all.
    expect(typeof globalThis).toBe('object');
    const canvasMeasure = createCanvasMeasurer(TEXT_FONT_FAMILY);
    expect(canvasMeasure('a', 20)).toBe(estimateMeasurer('a', 20));
    expect(canvasMeasure('', 20)).toBe(0);
    // The estimate is monotonic, which is all the layout needs to stay well-formed.
    expect(canvasMeasure('aa', 20)).toBeGreaterThan(canvasMeasure('a', 20));
    expect(canvasMeasure('aa', 40)).toBeGreaterThan(canvasMeasure('aa', 20));
    const box = layoutText('Went well', 'M', 'auto', 0, canvasMeasure);
    expect(box.width).toBe(estimateMeasurer('Went well', M));
    expect(box.lines).toBe(1);
  });
});
