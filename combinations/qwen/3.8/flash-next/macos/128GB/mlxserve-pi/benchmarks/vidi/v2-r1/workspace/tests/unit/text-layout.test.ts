// `text.wrap` — the layout rules a text object's box comes from (TC-07 to TC-10).
//
// The measurer is injected, as the design asks: a fake that charges a fixed width
// per character makes "one line", "wrapped at 600" and "exactly 600" into exact
// arithmetic instead of font archaeology. TC-10 is the one case that goes through
// the real canvas seam, with the canvas itself stood in for.
import { describe, expect, it } from 'vitest';
import {
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_LINE_HEIGHT,
  TEXT_SIZES,
} from '../../src/shared/config';
import {
  createCanvasMeasurer,
  layoutText,
  lineCount,
  TEXT_ESTIMATED_GLYPH_RATIO,
  TEXT_LAYOUT_PADDING_WORLD,
  textSizePx,
  type Measurer,
} from '../../src/client/objects/textLayout';

/** A measurer that charges half the font size per character. */
const measure: Measurer = (text, fontPx) => text.length * fontPx * 0.5;
/** One character at size M is 10 board units wide in that measurer. */
const PER_CHAR_M = measure('x', TEXT_SIZES.M);

const auto = (text: string, size: keyof typeof TEXT_SIZES = 'M') =>
  layoutText({ text, size, widthMode: 'auto', measure });

describe('text layout (text.wrap)', () => {
  // TC-07: one short line — box is the line plus air, one line box tall.
  it('TC-07 makes an auto box as wide as its longest line and one line tall', () => {
    const layout = auto('Went well');
    const line = measure('Went well', TEXT_SIZES.M);
    expect(line).toBe(9 * PER_CHAR_M);
    expect(layout.lines).toEqual(['Went well']);
    expect(layout.width).toBe(line + TEXT_LAYOUT_PADDING_WORLD * 2);
    expect(layout.height).toBeCloseTo(TEXT_SIZES.M * TEXT_LINE_HEIGHT, 6);
  });

  it('TC-07b an empty text still gets a line box and the narrowest box there is', () => {
    const layout = auto('');
    expect(layout.lines).toEqual(['']);
    expect(layout.height).toBeCloseTo(TEXT_SIZES.M * TEXT_LINE_HEIGHT, 6);
    expect(layout.width).toBe(TEXT_MIN_WIDTH_WORLD);
  });

  it('TC-07c the widest line of several decides the auto width', () => {
    const layout = auto('short\nthe longest line of the three\nmid');
    const widest = measure('the longest line of the three', TEXT_SIZES.M);
    expect(layout.width).toBe(widest + TEXT_LAYOUT_PADDING_WORLD * 2);
    expect(layout.lines.length).toBe(3);
    expect(layout.height).toBeCloseTo(3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT, 6);
  });

  // TC-08: a single line longer than the maximum wraps, and the box stops at 600.
  it('TC-08 wraps a line longer than TEXT_MAX_AUTO_WIDTH_WORLD instead of stretching', () => {
    const sentence =
      'the quick brown fox jumps over a lazy dog while farmers watch from quiet porches and children laugh loudly outside every evening together and the dog sleeps';
    expect(measure(sentence, TEXT_SIZES.M)).toBeGreaterThan(TEXT_MAX_AUTO_WIDTH_WORLD);

    const layout = auto(sentence);
    expect(layout.lines.length).toBeGreaterThan(1);
    expect(layout.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(layout.height).toBeCloseTo(
      layout.lines.length * TEXT_SIZES.M * TEXT_LINE_HEIGHT,
      6,
    );
    // Every line fits inside the box it was given.
    for (const line of layout.lines) {
      expect(measure(line, TEXT_SIZES.M)).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD);
    }
  });

  it('TC-08b wrapping happens between words, never inside one', () => {
    const sentence =
      'farmers watch from quiet porches while children laugh loudly outside every single evening together and the dog sleeps under the table afterwards';
    const layout = auto(sentence);
    expect(layout.lines.length).toBeGreaterThan(1);
    // The lines are the sentence cut at spaces: putting them back with the spaces
    // they were cut at gives the original, character for character.
    expect(layout.lines.join(' ')).toBe(sentence);
  });

  // TC-09: the boundary itself.
  it('TC-09 keeps a line of exactly the maximum width on one line and wraps one over', () => {
    const fitting = 'x'.repeat(Math.floor(TEXT_MAX_AUTO_WIDTH_WORLD / PER_CHAR_M));
    expect(measure(fitting, TEXT_SIZES.M)).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(auto(fitting).lines.length).toBe(1);
    expect(auto(fitting).width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);

    const over = `${fitting}x`;
    expect(auto(over).lines.length).toBe(2);
    expect(auto(over).width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
  });

  it('TC-09b a single word longer than the box breaks where the box ends', () => {
    // The renderer breaks a word that does not fit on a line of its own, so the
    // height has to count those lines too or the word is cut off.
    const word = 'https://example.com/a/very/long/path/that/keeps/going/on/and/on/forever/and/ever';
    const layout = auto(word);
    expect(layout.lines.length).toBeGreaterThan(1);
    expect(layout.lines.join('')).toBe(word);
  });

  // Fixed width: the width is what it was given, the height follows.
  it('grows the height when a given width forces more lines', () => {
    const sentence =
      'the quick brown fox jumps over a lazy dog while farmers watch from quiet porches';
    const wide = layoutText({
      text: sentence,
      size: 'M',
      widthMode: 'fixed',
      width: 500,
      measure,
    });
    const narrow = layoutText({
      text: sentence,
      size: 'M',
      widthMode: 'fixed',
      width: 200,
      measure,
    });
    expect(wide.width).toBe(500);
    expect(narrow.width).toBe(200);
    expect(narrow.lines.length).toBeGreaterThan(wide.lines.length);
    expect(narrow.height).toBeCloseTo(
      narrow.lines.length * TEXT_SIZES.M * TEXT_LINE_HEIGHT,
      6,
    );
    expect(lineCount(sentence, 'M', 'fixed', 200, measure)).toBe(narrow.lines.length);
  });

  it('never gives a fixed box a width below TEXT_MIN_WIDTH_WORLD', () => {
    const layout = layoutText({
      text: 'hello there friend',
      size: 'M',
      widthMode: 'fixed',
      width: 12,
      measure,
    });
    expect(layout.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(layout.lines.length).toBeGreaterThan(1);
  });

  it('uses the size for the line box and never for the width cap', () => {
    // An XL line of the same text is wider, but the box it wraps into is the same.
    const small = layoutText({
      text: 'the quick brown fox jumps over a lazy dog while farmers watch',
      size: 'S',
      widthMode: 'fixed',
      width: 300,
      measure,
    });
    const big = layoutText({
      text: 'the quick brown fox jumps over a lazy dog while farmers watch',
      size: 'XL',
      widthMode: 'fixed',
      width: 300,
      measure,
    });
    expect(small.width).toBe(300);
    expect(big.width).toBe(300);
    expect(big.lines.length).toBeGreaterThan(small.lines.length);
    expect(big.height / big.lines.length).toBeCloseTo(
      TEXT_SIZES.XL * TEXT_LINE_HEIGHT,
      6,
    );
    expect(small.height / small.lines.length).toBeCloseTo(
      TEXT_SIZES.S * TEXT_LINE_HEIGHT,
      6,
    );
    expect(textSizePx('XL')).toBe(56);
    expect(textSizePx('nope')).toBe(TEXT_SIZES.M);
  });

  it('counts a newline in the text as a line of its own', () => {
    const layout = auto('one\ntwo\n\nfour');
    expect(layout.lines).toEqual(['one', 'two', '', 'four']);
    expect(layout.height).toBeCloseTo(4 * TEXT_SIZES.M * TEXT_LINE_HEIGHT, 6);
  });

  // TC-10: the canvas seam falls back to a fixed guess, and still lays out.
  it('TC-10 uses the estimated glyph width when measureText is not there', () => {
    const before = globalThis.OffscreenCanvas;
    const had = Object.prototype.hasOwnProperty.call(globalThis, 'OffscreenCanvas');
    // Nothing to measure with, in either shape.
    delete (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas;
    try {
      const fallback = createCanvasMeasurer();
      expect(fallback('hello', TEXT_SIZES.M)).toBeCloseTo(
        5 * TEXT_SIZES.M * TEXT_ESTIMATED_GLYPH_RATIO,
        6,
      );
      const layout = layoutText({
        text: 'hello',
        size: 'M',
        widthMode: 'auto',
        measure: fallback,
      });
      expect(layout.width).toBeCloseTo(
        5 * TEXT_SIZES.M * TEXT_ESTIMATED_GLYPH_RATIO + TEXT_LAYOUT_PADDING_WORLD * 2,
        6,
      );
      expect(layout.height).toBeCloseTo(TEXT_SIZES.M * TEXT_LINE_HEIGHT, 6);
      // And it does not measure text as nothing.
      expect(fallback('hello', TEXT_SIZES.M)).toBeGreaterThan(0);
    } finally {
      if (had) globalThis.OffscreenCanvas = before;
    }
  });

  it('TC-10b uses a canvas when there is one, and asks it once per size', () => {
    const before = globalThis.OffscreenCanvas;
    const had = Object.prototype.hasOwnProperty.call(globalThis, 'OffscreenCanvas');
    let asked = 0;
    let fontsSet: string[] = [];
    class FakeCanvas {
      font = '10px sans-serif';
      getContext(kind: string): unknown {
        if (kind !== '2d') return null;
        const self = this;
        return {
          get font() {
            return self.font;
          },
          set font(value: string) {
            fontsSet.push(value);
            self.font = value;
          },
          measureText(text: string) {
            asked += 1;
            // Width scales with the font the context was last given, so a measurer
            // that forgot to set the font shows up as a wrong number.
            const px = Number(/(\d+(?:\.\d+)?)px/.exec(self.font)?.[1] ?? 0);
            return { width: text.length * px * 0.2 };
          },
        };
      }
    }
    globalThis.OffscreenCanvas = FakeCanvas as unknown as typeof OffscreenCanvas;
    try {
      const measure2 = createCanvasMeasurer();
      expect(measure2('abcd', 20)).toBe(16);
      expect(measure2('ab', 20)).toBe(8);
      expect(asked).toBe(2);
      // The font was set once for that size, with the board's own family.
      expect(fontsSet.filter((font) => font.includes('20px')).length).toBe(1);
      fontsSet = [];
      expect(measure2('ab', 56)).toBeCloseTo(2 * 56 * 0.2, 6);
      expect(fontsSet.filter((font) => font.includes('56px')).length).toBe(1);
    } finally {
      if (had) globalThis.OffscreenCanvas = before;
      else delete (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas;
    }
  });

  it('TC-10c falls back when the canvas cannot answer', () => {
    const before = globalThis.OffscreenCanvas;
    const had = Object.prototype.hasOwnProperty.call(globalThis, 'OffscreenCanvas');
    class NoContext {
      getContext(): null {
        return null;
      }
    }
    globalThis.OffscreenCanvas = NoContext as unknown as typeof OffscreenCanvas;
    try {
      const measure3 = createCanvasMeasurer();
      expect(measure3('hello', 20)).toBeCloseTo(5 * 20 * TEXT_ESTIMATED_GLYPH_RATIO, 6);
    } finally {
      if (had) globalThis.OffscreenCanvas = before;
      else delete (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas;
    }

    class ThrowsOnMeasure {
      font = '10px sans-serif';
      getContext(): { font: string; measureText(): never } {
        return {
          font: '',
          measureText(): never {
            throw new Error('measureText is not available');
          },
        };
      }
    }
    globalThis.OffscreenCanvas = ThrowsOnMeasure as unknown as typeof OffscreenCanvas;
    try {
      const measure4 = createCanvasMeasurer();
      expect(measure4('hello', 20)).toBeCloseTo(5 * 20 * TEXT_ESTIMATED_GLYPH_RATIO, 6);
    } finally {
      if (had) globalThis.OffscreenCanvas = before;
      else delete (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas;
    }
  });
});
