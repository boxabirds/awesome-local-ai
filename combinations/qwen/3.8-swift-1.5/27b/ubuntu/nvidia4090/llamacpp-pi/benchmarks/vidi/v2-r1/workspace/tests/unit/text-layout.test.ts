import { describe, it, expect } from 'vitest';
import { layoutText, createCanvasMeasurer } from '@client/objects/textLayout';
import {
  TEXT_MAX_AUTO_WIDTH_WORLD, TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES, TEXT_LINE_HEIGHT,
} from '@shared/config';

/**
 * Deterministic fake measurer: 10 world units per character (spaces
 * included). At size M (20px) 'Went well' (9 chars) measures 90.
 */
const measure = (text: string): number => text.length * 10;

const ONE_LINE_M = TEXT_SIZES.M * TEXT_LINE_HEIGHT; // 26

describe('text.layout (layoutText)', () => {
  // TC-07: 'Went well' measured 90 at M in auto mode → width 90, one line.
  it('TC-07: short auto-width text → width is the measured line, height one line', () => {
    const out = layoutText('Went well', 'M', 'auto', null, measure);
    expect(out.width).toBe(90);
    expect(out.height).toBe(ONE_LINE_M);
    expect(out.lines).toEqual(['Went well']);
  });

  // TC-08: line measuring 900 → width 600, greedy word wrap into 2 lines.
  it('TC-08: a 900-wide line wraps at TEXT_MAX_AUTO_WIDTH_WORLD into 2 lines', () => {
    // 44 chars + space + 45 chars = 440 + 10 + 450 = 900
    const text = 'a'.repeat(44) + ' ' + 'b'.repeat(45);
    expect(measure(text)).toBe(900);
    const out = layoutText(text, 'M', 'auto', null, measure);
    expect(out.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(out.lines).toHaveLength(2);
    expect(out.height).toBe(2 * ONE_LINE_M);
    // Greedy: the first word (440) fits, the second (450) does not fit after it.
    expect(out.lines[0]).toBe('a'.repeat(44));
    expect(out.lines[1]).toBe('b'.repeat(45));
  });

  // TC-09: line measuring exactly 600 → one line, width 600 (boundary).
  it('TC-09: a line measuring exactly the max auto width stays on one line', () => {
    const text = 'c'.repeat(60); // 600
    const out = layoutText(text, 'M', 'auto', null, measure);
    expect(out.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(out.lines).toHaveLength(1);
    expect(out.height).toBe(ONE_LINE_M);
  });

  // TC-10: fixed width 40 with three words → one word per line (boundary).
  it('TC-10: fixed minimum width wraps to one word per line', () => {
    const out = layoutText('word word word', 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, measure);
    expect(out.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(out.lines).toEqual(['word', 'word', 'word']);
    expect(out.height).toBe(3 * ONE_LINE_M);
  });

  // TC-11: explicit newlines → width = longest line, height = lines × size × LINE_HEIGHT.
  it('TC-11: explicit newlines are respected; width is the longest line', () => {
    const out = layoutText('abc\ndefg', 'M', 'auto', null, measure);
    expect(out.width).toBe(40);
    expect(out.lines).toEqual(['abc', 'defg']);
    expect(out.height).toBe(2 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });

  it('blank lines count as lines (empty middle line)', () => {
    const out = layoutText('a\n\nb', 'M', 'auto', null, measure);
    expect(out.lines).toEqual(['a', '', 'b']);
    expect(out.height).toBe(3 * ONE_LINE_M);
  });

  it('empty text → zero width, one line of height', () => {
    const out = layoutText('', 'M', 'auto', null, measure);
    expect(out.width).toBe(0);
    expect(out.lines).toEqual(['']);
    expect(out.height).toBe(ONE_LINE_M);
  });

  it('greedy wrap packs as many words as fit per line', () => {
    // 8 words of 10 chars (100 each) + 7 spaces (10 each) = 870 total
    const text = Array.from({ length: 8 }, () => 'w'.repeat(10)).join(' ');
    const out = layoutText(text, 'M', 'auto', null, measure);
    // line 1: 5 words → 500 + 40 = 540 ≤ 600; a 6th would be 650 > 600
    expect(out.lines[0]).toBe(Array.from({ length: 5 }, () => 'w'.repeat(10)).join(' '));
    expect(out.lines[1]).toBe(Array.from({ length: 3 }, () => 'w'.repeat(10)).join(' '));
    expect(out.lines).toHaveLength(2);
    // The pre-wrap line measured 870 → box width capped at the max.
    expect(out.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
  });

  it('fixed width is used as-is when above the minimum', () => {
    const out = layoutText('word word word', 'M', 'fixed', 200, measure);
    expect(out.width).toBe(200);
    // 'word word word' = 40+10+40+10+40 = 140 ≤ 200 → one line
    expect(out.lines).toEqual(['word word word']);
  });

  it('height scales with the size preset', () => {
    const outS = layoutText('abc', 'S', 'auto', null, measure);
    const outXL = layoutText('abc', 'XL', 'auto', null, measure);
    expect(outS.height).toBe(TEXT_SIZES.S * TEXT_LINE_HEIGHT);
    expect(outXL.height).toBe(TEXT_SIZES.XL * TEXT_LINE_HEIGHT);
  });
});

describe('text.layout (createCanvasMeasurer)', () => {
  // TC-32: environment without canvas → estimate fallback, no throw.
  it('TC-32: without a canvas the measurer falls back to an estimate and never throws', () => {
    // The unit environment is node: no document, no OffscreenCanvas.
    expect(typeof (globalThis as { document?: unknown }).document).toBe('undefined');
    const m = createCanvasMeasurer();
    expect(() => m('hello', 20)).not.toThrow();
    const width = m('hello', 20);
    expect(width).toBeGreaterThan(0);
    // The estimate is proportional to the character count and font size.
    expect(m('aaaaaaaaaa', 20)).toBe(2 * width); // 10 chars = 2 × 5 chars
    expect(m('hello', 40)).toBe(2 * width);
  });
});
