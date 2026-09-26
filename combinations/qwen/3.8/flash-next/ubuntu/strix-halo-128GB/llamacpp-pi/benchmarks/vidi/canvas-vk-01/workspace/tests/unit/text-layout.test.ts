import { describe, it, expect } from 'vitest';

import { layoutText, createCanvasMeasurer } from '../../src/client/objects/textLayout';
import {
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_WIDTH_PADDING_WORLD,
} from '../../src/shared/config';

/**
 * Story 9 text.layout — pure wrapping and box sizing (TC-07 to TC-11, TC-32).
 * A fake measurer makes the numbers exact: one "world unit" per character.
 */

/** Fake measurer: every character is `perChar` wide at fontPx 20, scaled. */
const charsAt20 =
  (perChar = 1): ((text: string, fontPx: number) => number) =>
  (text, fontPx) =>
    text.length * perChar * (fontPx / 20);

/** 'aaa…' of the given measured width at M (per-char 1). */
const lineOf = (width: number): string => 'a'.repeat(width);

describe('layoutText (TC-07 to TC-11)', () => {
  it('TC-07: short auto line → width = measured + padding, height one line', () => {
    // "Went well" measured 90 at M.
    const text = 'W'.repeat(90);
    const r = layoutText(text, 'M', 'auto', null, charsAt20());
    expect(r.width).toBe(90 + TEXT_WIDTH_PADDING_WORLD);
    expect(r.height).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    expect(r.lines).toEqual([text]);
  });

  it('TC-08: line measured 900 → width TEXT_MAX_AUTO_WIDTH_WORLD, 2 wrapped lines', () => {
    // Two words of 450: greedy wrap puts the second word on line 2 (900 total).
    const text = `${lineOf(449)} ${lineOf(449)}`;
    const r = layoutText(text, 'M', 'auto', null, charsAt20());
    expect(r.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(r.lines).toHaveLength(2);
    expect(r.height).toBe(2 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    // Every wrapped line fits inside the box.
    for (const l of r.lines) {
      expect(charsAt20()(l, TEXT_SIZES.M)).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD);
    }
  });

  it('TC-09: line measuring exactly 600 → one line, width 600 (boundary)', () => {
    const r = layoutText(lineOf(600), 'M', 'auto', null, charsAt20());
    expect(r.lines).toHaveLength(1);
    expect(r.width).toBe(600);
  });

  it('TC-07 boundary: just under max → no wrap, width = measured + padding', () => {
    const r = layoutText(lineOf(590), 'M', 'auto', null, charsAt20());
    expect(r.lines).toHaveLength(1);
    expect(r.width).toBe(590 + TEXT_WIDTH_PADDING_WORLD);
    // Padding never pushes the box over the maximum; the width is capped.
    const capped = layoutText(lineOf(599), 'M', 'auto', null, charsAt20());
    expect(capped.lines).toHaveLength(1);
    expect(capped.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
  });

  it('TC-10: fixed width TEXT_MIN_WIDTH_WORLD with three words → one word per line', () => {
    // 10 units per character: each 4–5 letter word measures 40–50 at M, so
    // only one word fits on a 40-unit line.
    const r = layoutText('alpha beta gamma', 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, charsAt20(10));
    expect(r.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(r.lines).toEqual(['alpha', 'beta', 'gamma']);
    expect(r.height).toBe(3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });

  it('TC-11: explicit newlines → width = longest line, height = lines × size × lineHeight', () => {
    const text = 'bb\ndddddddd\nc';
    const r = layoutText(text, 'M', 'auto', null, charsAt20());
    expect(r.lines).toEqual(['bb', 'dddddddd', 'c']);
    expect(r.width).toBe(8 + TEXT_WIDTH_PADDING_WORLD);
    expect(r.height).toBe(3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });

  it('size scales the font without touching the wrap width', () => {
    const text = `${lineOf(449)} ${lineOf(449)}`;
    // At XL the same text occupies 2× the measured width — wraps the same way,
    // each line stays at most one line's height.
    const r = layoutText(text, 'XL', 'auto', null, charsAt20());
    expect(r.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(r.lines).toHaveLength(2);
    expect(r.height).toBe(2 * TEXT_SIZES.XL * TEXT_LINE_HEIGHT);
  });

  it('fixed mode keeps exactly the dragged width', () => {
    // 10 units per character: 'alpha beta gamma' measures 160 ≤ 200, adding
    // ' delta' would reach 206 — the last word wraps.
    const r = layoutText('alpha beta gamma delta', 'M', 'fixed', 200, charsAt20(10));
    expect(r.width).toBe(200);
    expect(r.lines).toEqual(['alpha beta gamma', 'delta']);
  });

  it('empty text is one line tall', () => {
    const r = layoutText('', 'M', 'auto', null, charsAt20());
    expect(r.lines).toEqual(['']);
    expect(r.height).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    expect(r.width).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(r.width).toBeGreaterThan(0);
  });

  it('a fixed mode with a missing width falls back to auto behaviour', () => {
    const r = layoutText('short', 'M', 'fixed', null, charsAt20());
    expect(r.lines).toEqual(['short']);
    expect(r.width).toBe(5 + TEXT_WIDTH_PADDING_WORLD);
  });
});

describe('createCanvasMeasurer (TC-32)', () => {
  it('TC-32: no canvas available → estimate fallback, no throw', () => {
    // Node has no document/canvas at all.
    const measure = createCanvasMeasurer('Inter, system-ui, sans-serif');
    const width = measure('Went well', 20);
    expect(Number.isFinite(width)).toBe(true);
    expect(width).toBeGreaterThan(0);
    // Proportional: twice the characters measure roughly twice as wide.
    expect(measure('Went well go far', 20)).toBeGreaterThan(width);
  });
});
