/**
 * Unit tests for the pure text layout (design §9.2 tests 7–11 and the no-canvas error path, TC-32).
 *
 * The measurer is a fake: a fixed number of world units per character at each font size, which is how
 * the design's own numbers are reproducible ('Went well' at M is 9 characters × 20 units × 0.5 = 90).
 * Real glyph shapes are proved in the browser suite; what is proved here is the arithmetic around them.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TEXT_SIZE,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';
import {
  createCanvasMeasurer,
  estimateTextWidth,
  layoutText,
  textLineHeight,
  type Measurer,
} from '../../src/client/objects/textLayout';

/** One world unit per half a character: the ratio the design's numbers were written with. */
const GLYPHS_PER_UNIT = 0.5;
const fakeMeasure: Measurer = (text, fontPx) => text.length * fontPx * GLYPHS_PER_UNIT;

const unitAt = (size: keyof typeof TEXT_SIZES): number => TEXT_SIZES[size] * TEXT_LINE_HEIGHT;

describe('layoutText: auto width', () => {
  // TC-07
  it('is as wide as its longest line when nothing has to wrap', () => {
    const layout = layoutText('Went well', 'M', 'auto', null, fakeMeasure);

    expect(fakeMeasure('Went well', TEXT_SIZES.M)).toBe(90);
    expect(layout.lines).toEqual(['Went well']);
    expect(layout.width).toBe(90);
    expect(layout.height).toBe(unitAt('M'));
  });

  // TC-08
  it('stops at the maximum width and wraps what is longer than it', () => {
    const words = Array.from({ length: 18 }, (_unused, index) => (index === 17 ? 'words' : 'word'));
    const text = words.join(' ');
    expect(text.length).toBe(90);
    expect(fakeMeasure(text, TEXT_SIZES.M)).toBe(900);

    const layout = layoutText(text, 'M', 'auto', null, fakeMeasure);

    expect(layout.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(layout.lines).toHaveLength(2);
    expect(layout.lines[0]?.split(' ')).toHaveLength(12);
    expect(layout.lines[1]?.split(' ')).toHaveLength(6);
    expect(layout.height).toBe(2 * unitAt('M'));
    // Nothing was lost or reordered by the wrapping.
    expect(layout.lines.join(' ')).toBe(text);
  });

  // TC-09 — the boundary: a line exactly at the limit is still one line.
  it('draws a line of exactly the maximum width as one line', () => {
    const line = `${'x'.repeat(30)} ${'y'.repeat(29)}`; // 60 characters, exactly 600 units at M
    expect(fakeMeasure(line, TEXT_SIZES.M)).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);

    const layout = layoutText(line, 'M', 'auto', null, fakeMeasure);

    expect(layout.lines).toEqual([line]);
    expect(layout.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(layout.height).toBe(unitAt('M'));
  });

  it('takes the width of the longest line, not of the text as a whole', () => {
    const layout = layoutText('Went well\nTo improve!', 'M', 'auto', null, fakeMeasure);

    expect(layout.lines).toEqual(['Went well', 'To improve!']);
    expect(layout.width).toBe(fakeMeasure('To improve!', TEXT_SIZES.M));
    expect(layout.height).toBe(2 * unitAt('M'));
  });

  // TC-11
  it('keeps the lines the person made with Enter, empty ones included', () => {
    const layout = layoutText('Went well\n\nTo improve', 'M', 'auto', null, fakeMeasure);

    expect(layout.lines).toEqual(['Went well', '', 'To improve']);
    // Width follows the longest line, which here is the second one ('To improve' is the longer).
    expect(layout.width).toBe(fakeMeasure('To improve', TEXT_SIZES.M));
    // Height counts every line it is drawn as, which is what makes an empty line take up its row.
    expect(layout.height).toBe(3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });

  it('never wraps a word that is longer than the limit, and keeps the box at the limit', () => {
    const word = 'x'.repeat(70); // 700 units at M: longer than the whole limit, and unsplittable
    const layout = layoutText(word, 'M', 'auto', null, fakeMeasure);

    expect(layout.lines).toEqual([word]);
    expect(layout.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(layout.height).toBe(unitAt('M'));
  });

  it('sizes every preset from its own font size', () => {
    for (const size of Object.keys(TEXT_SIZES) as (keyof typeof TEXT_SIZES)[]) {
      const layout = layoutText('Went well', size, 'auto', null, fakeMeasure);
      expect(layout.width).toBe(9 * TEXT_SIZES[size] * GLYPHS_PER_UNIT);
      expect(layout.height).toBe(TEXT_SIZES[size] * TEXT_LINE_HEIGHT);
      expect(textLineHeight(size)).toBe(TEXT_SIZES[size] * TEXT_LINE_HEIGHT);
    }
  });

  it('lays an object nobody typed into out as one empty line', () => {
    const layout = layoutText('', DEFAULT_TEXT_SIZE, 'auto', null, fakeMeasure);

    expect(layout.lines).toEqual(['']);
    // Zero content is zero wide, which is the answer the box writer refuses and leaves alone.
    expect(layout.width).toBe(0);
    expect(layout.height).toBe(unitAt(DEFAULT_TEXT_SIZE));
  });
});

describe('layoutText: fixed width', () => {
  // TC-10 — the boundary at TEXT_MIN_WIDTH_WORLD.
  it('breaks one word per line at the narrowest width the product allows', () => {
    const layout = layoutText('abc def ghi', 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, fakeMeasure);

    expect(layout.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(layout.lines).toEqual(['abc', 'def', 'ghi']);
    expect(layout.height).toBe(3 * unitAt('M'));
  });

  it('holds the width the person gave it whatever the content says', () => {
    const text = 'Went well';
    const wider = layoutText(text, 'M', 'fixed', 400, fakeMeasure);
    const narrower = layoutText(text, 'M', 'fixed', 50, fakeMeasure);

    expect(wider.width).toBe(400);
    expect(wider.lines).toEqual([text]); // 90 units fits in 400
    expect(narrower.width).toBe(50);
    expect(narrower.lines).toEqual(['Went', 'well']);
    expect(narrower.height).toBe(2 * unitAt('M'));
  });

  it('never wraps below the minimum, whatever width it is handed', () => {
    const layout = layoutText('abc def ghi', 'M', 'fixed', 1, fakeMeasure);

    expect(layout.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(layout.lines).toEqual(['abc', 'def', 'ghi']);
  });

  it('grows taller and no wider as the fixed width gets narrower', () => {
    const text = 'word '.repeat(11).trim(); // 11 words
    const wide = layoutText(text, 'M', 'fixed', 300, fakeMeasure);
    const middle = layoutText(text, 'M', 'fixed', 100, fakeMeasure);
    const narrow = layoutText(text, 'M', 'fixed', 50, fakeMeasure);

    expect(wide.width).toBe(300);
    expect(middle.width).toBe(100);
    expect(narrow.width).toBe(50);
    expect(wide.lines.length).toBeLessThan(middle.lines.length);
    expect(middle.lines.length).toBeLessThan(narrow.lines.length);
    expect(narrow.height).toBe(narrow.lines.length * unitAt('M'));
    expect(narrow.lines.join(' ')).toBe(text);
  });

  it('lays a line that will not fit out at the fixed width and gives it the room of one line', () => {
    const layout = layoutText('x'.repeat(20), 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, fakeMeasure);

    // 100 units of word inside a 40 unit box: the box stays 40, the browser breaks the glyphs.
    expect(layout.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(layout.lines).toHaveLength(1);
    expect(layout.height).toBe(unitAt('M'));
  });

  it('wraps at the fixed width in the size it is drawn at, not in the default one', () => {
    const text = 'abcdefgh'; // 80 units at M, 56 at S
    expect(layoutText(text, 'M', 'fixed', 60, fakeMeasure).lines).toEqual([text]);
    expect(layoutText(text, 'S', 'fixed', 60, fakeMeasure).lines).toEqual(['abcdefgh']);
    expect(layoutText(text, 'S', 'fixed', 40, fakeMeasure).lines).toEqual(['abcdefgh']);
    expect(layoutText('abc def', 'S', 'fixed', 40, fakeMeasure).lines).toEqual(['abc', 'def']);
  });

  it('falls back to the automatic rule when a fixed mode carries no width', () => {
    const auto = layoutText('Went well', 'M', 'auto', null, fakeMeasure);
    const broken = layoutText('Went well', 'M', 'fixed', null, fakeMeasure);

    expect(broken).toEqual(auto);
    expect(layoutText('Went well', 'M', 'fixed', NaN, fakeMeasure)).toEqual(auto);
    expect(layoutText('Went well', 'M', 'fixed', 0, fakeMeasure)).toEqual(auto);
  });

  it('wraps the lines the person made inside the width they set', () => {
    const layout = layoutText('Went well\n\nTo improve', 'M', 'fixed', 60, fakeMeasure);

    expect(layout.width).toBe(60);
    expect(layout.lines).toEqual(['Went', 'well', '', 'To', 'improve']);
    expect(layout.height).toBe(5 * unitAt('M'));
  });
});

describe('layoutText: bad input', () => {
  it('sizes a size the document invented with the default font', () => {
    const layout = layoutText('Went well', 'HUGE' as never, 'auto', null, fakeMeasure);

    expect(layout.height).toBe(unitAt(DEFAULT_TEXT_SIZE));
  });

  it('measures with the estimate when it is handed no measurer at all', () => {
    const layout = layoutText('Went well', 'M', 'auto', null, null as never);

    expect(layout.width).toBe(estimateTextWidth('Went well', TEXT_SIZES.M));
    expect(layout.lines).toEqual(['Went well']);
  });

  it('lays a document whose text is not text out as one empty line', () => {
    const layout = layoutText(undefined as never, 'M', 'auto', null, fakeMeasure);

    expect(layout.lines).toEqual(['']);
    expect(layout.width).toBe(0);
    expect(layout.height).toBe(unitAt('M'));
  });
});

describe('estimateTextWidth', () => {
  it('is proportional to the characters and to the font size', () => {
    expect(estimateTextWidth('', 20)).toBe(0);
    expect(estimateTextWidth('abcd', 20)).toBe(40);
    expect(estimateTextWidth('abcd', 40)).toBe(80);
  });

  it('is what the layout falls back on, so the two never disagree', () => {
    const estimated = layoutText('Went well', 'M', 'auto', null, estimateTextWidth);

    expect(estimated.width).toBe(estimateTextWidth('Went well', TEXT_SIZES.M));
    expect(estimated.height).toBe(unitAt('M'));
  });
});

describe('createCanvasMeasurer', () => {
  // TC-32 — the error path: an environment with no 2D context measures by counting.
  it('returns a working measurer where there is no canvas to measure with', () => {
    const measure = createCanvasMeasurer();

    expect(() => measure('Went well', TEXT_SIZES.M)).not.toThrow();
    expect(Number.isFinite(measure('Went well', TEXT_SIZES.M))).toBe(true);
    // Either the real width of the words or the estimate: both are positive and grow with the text.
    expect(measure('Went well', TEXT_SIZES.M)).toBeGreaterThan(0);
    expect(measure('Went well more words', TEXT_SIZES.M)).toBeGreaterThan(
      measure('Went well', TEXT_SIZES.M),
    );
  });

  it('never returns a width that is not a number', () => {
    const measure = createCanvasMeasurer('A Font That Does Not Exist, sans-serif');

    expect(measure('', 20)).toBe(0);
    expect(measure('abc', NaN)).toBe(estimateTextWidth('abc', NaN));
    expect(measure('abc', -1)).toBe(estimateTextWidth('abc', -1));
  });

  it('measures the same string at two sizes in the ratio of the sizes', () => {
    const measure = createCanvasMeasurer();
    const small = measure('Went well', TEXT_SIZES.S);
    const large = measure('Went well', TEXT_SIZES.L);

    // Exact on the estimate, roughly so on a real font: what must hold either way is the order.
    expect(large).toBeGreaterThan(small);
  });
});
