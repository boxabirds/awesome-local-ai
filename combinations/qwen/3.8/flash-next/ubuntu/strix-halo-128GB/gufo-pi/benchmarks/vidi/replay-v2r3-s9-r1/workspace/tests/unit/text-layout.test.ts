/**
 * Unit tests for pure text layout (story 9, text.layout).
 * TC-07 to TC-11 and TC-32, using a deterministic fake measurer: 0.5 world
 * units per character per font pixel (so 10 units per character at size M).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  TEXT_BOX_PADDING_WORLD,
  createCanvasMeasurer,
  estimateTextWidth,
  layoutText,
  type Measurer,
} from '../../src/client/objects/textLayout';
import {
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';

/** Fake measurer: 0.5 * fontPx per character. */
const measure: Measurer = (text, fontPx) => text.length * fontPx * 0.5;

const M = TEXT_SIZES.M; // 20 -> 10 world units per character
const CHARS_AT_M = 10;

const lineHeight = (size: keyof typeof TEXT_SIZES) => TEXT_SIZES[size] * TEXT_LINE_HEIGHT;

describe('text.layout', () => {
  it('TC-07: a short line in auto mode is measured plus padding, one line high', () => {
    const out = layoutText('Went well', 'M', 'auto', null, measure);
    // 'Went well' is 9 characters -> 90 units at size M.
    expect(measure('Went well', M)).toBe(9 * CHARS_AT_M);
    expect(out.width).toBe(9 * CHARS_AT_M + 2 * TEXT_BOX_PADDING_WORLD);
    expect(out.height).toBeCloseTo(lineHeight('M'), 6);
    expect(out.lines).toEqual(['Went well']);
  });

  it('TC-08: a 910-unit line caps at TEXT_MAX_AUTO_WIDTH_WORLD and wraps to two lines', () => {
    const words = ['w'.repeat(45), 'w'.repeat(45)];
    const line = words.join(' '); // 91 characters -> 910 units
    expect(measure(line, M)).toBe(910);

    const out = layoutText(line, 'M', 'auto', null, measure);
    expect(out.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(out.lines).toHaveLength(2);
    expect(out.lines[0]).toBe(words[0]);
    expect(out.lines[1]).toBe(words[1]);
    expect(out.height).toBeCloseTo(2 * lineHeight('M'), 6);
    // Whatever the measurer produced, no wrapped line overflows the box's content area.
    const contentWidth = TEXT_MAX_AUTO_WIDTH_WORLD - 2 * TEXT_BOX_PADDING_WORLD;
    for (const l of out.lines) expect(measure(l, M)).toBeLessThanOrEqual(contentWidth);
  });

  it('TC-09: the auto boundary is the content area, not the box edge', () => {
    const contentWidth = TEXT_MAX_AUTO_WIDTH_WORLD - 2 * TEXT_BOX_PADDING_WORLD; // 584
    // Just inside: one line, the box hugs the text plus padding.
    const fits = 'w'.repeat(58); // 580 units
    expect(measure(fits, M)).toBeLessThanOrEqual(contentWidth);
    const inside = layoutText(fits, 'M', 'auto', null, measure);
    expect(inside.lines).toHaveLength(1);
    expect(inside.width).toBe(58 * CHARS_AT_M + 2 * TEXT_BOX_PADDING_WORLD);
    expect(inside.height).toBeCloseTo(lineHeight('M'), 6);

    // Just outside: the box goes to the maximum and the word breaks over lines.
    const tooWide = 'w'.repeat(59); // 590 units
    expect(measure(tooWide, M)).toBeGreaterThan(contentWidth);
    const outside = layoutText(tooWide, 'M', 'auto', null, measure);
    expect(outside.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(outside.height).toBeCloseTo(2 * lineHeight('M'), 6);
  });

  it('TC-10: a fixed width puts one word per line and the height grows', () => {
    const out = layoutText('aaaa bbbb cccc', 'M', 'fixed', 100, measure);
    expect(out.width).toBe(100);
    expect(out.lines).toEqual(['aaaa', 'bbbb', 'cccc']);
    expect(out.height).toBeCloseTo(3 * lineHeight('M'), 6);

    // The minimum box is narrower than a word, so words break and height grows.
    const tiny = layoutText('aaaa bbbb cccc', 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, measure);
    expect(tiny.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(tiny.lines).toEqual(['aaaa', 'bbbb', 'cccc']);
    expect(tiny.height).toBeCloseTo(6 * lineHeight('M'), 6);
  });

  it('TC-11: explicit newlines decide the line count; width follows the longest line', () => {
    const out = layoutText('aaa\nbb b\ncccccc', 'M', 'auto', null, measure);
    expect(out.lines).toEqual(['aaa', 'bb b', 'cccccc']);
    expect(out.width).toBe(6 * CHARS_AT_M + 2 * TEXT_BOX_PADDING_WORLD);
    expect(out.height).toBeCloseTo(3 * lineHeight('M'), 6);
  });

  it('larger sizes measure wider and taller at the same character count', () => {
    const small = layoutText('hello', 'S', 'auto', null, measure);
    const large = layoutText('hello', 'XL', 'auto', null, measure);
    expect(large.width).toBeGreaterThan(small.width);
    expect(large.height).toBeGreaterThan(small.height);
  });

  it('empty text still has a line of height and at least the minimum width', () => {
    const out = layoutText('', 'M', 'auto', null, measure);
    expect(out.lines).toEqual(['']);
    expect(out.height).toBeCloseTo(lineHeight('M'), 6);
    expect(out.width).toBeGreaterThanOrEqual(TEXT_MIN_WIDTH_WORLD);
  });

  it('fixed mode clamps to TEXT_MIN_WIDTH_WORLD', () => {
    const out = layoutText('hello', 'M', 'fixed', 5, measure);
    expect(out.width).toBe(TEXT_MIN_WIDTH_WORLD);
  });

  it('TC-32: without a canvas the measurer estimates instead of throwing', () => {
    // The unit project runs in node: there is no DOM and no OffscreenCanvas.
    expect((globalThis as any).OffscreenCanvas).toBeUndefined();
    const fallback = createCanvasMeasurer();
    expect(() => fallback('Went well', M)).not.toThrow();
    expect(fallback('Went well', M)).toBe(estimateTextWidth('Went well', M));
    expect(fallback('', M)).toBe(0);
  });

  it('a canvas without a 2d context also falls back to the estimate', () => {
    const hadDocument = 'document' in globalThis;
    (globalThis as any).document = {
      createElement: () => ({ getContext: () => null }),
    };
    try {
      const m = createCanvasMeasurer();
      expect(() => m('abc', 20)).not.toThrow();
      expect(m('abc', 20)).toBeCloseTo(estimateTextWidth('abc', 20), 6);
    } finally {
      if (!hadDocument) delete (globalThis as any).document;
    }
  });

  it('a throwing getContext also falls back to the estimate', () => {
    const hadDocument = 'document' in globalThis;
    (globalThis as any).document = {
      createElement: () => ({
        getContext: () => {
          throw new Error('canvas blocked');
        },
      }),
    };
    try {
      const m = createCanvasMeasurer();
      expect(m('abc', 20)).toBeCloseTo(estimateTextWidth('abc', 20), 6);
    } finally {
      if (!hadDocument) delete (globalThis as any).document;
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});
