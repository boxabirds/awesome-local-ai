// TC-07 to TC-11 and TC-32: text box layout. Auto grow/wrap at
// TEXT_MAX_AUTO_WIDTH_WORLD, fixed-width wrapping, newline handling and the
// no-canvas measurer fallback. All cases use a deterministic fake measurer:
// width = chars * fontPx / 2.

import { describe, it, expect } from 'vitest';
import {
  createCanvasMeasurer,
  estimateMeasurer,
  layoutText,
  type Measurer,
} from '../../src/client/objects/textLayout';
import {
  TEXT_ESTIMATED_GLYPH_WIDTH_RATIO,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_PADDING_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';

const fake: Measurer = (text, fontPx) => (text.length * fontPx) / 2;

// 'Went well' measures 9 chars * 20 / 2 = 90 at size M.
const M = TEXT_SIZES.M;

describe('text layout', () => {
  it('TC-07: a short auto line sizes to measurement plus padding on one line', () => {
    expect(fake('Went well', M)).toBe(90);
    const box = layoutText('Went well', 'M', 'auto', null, fake);
    expect(box.width).toBe(90 + TEXT_PADDING_WORLD);
    expect(box.height).toBe(M * TEXT_LINE_HEIGHT);
    expect(box.lines).toEqual(['Went well']);
  });

  it('TC-08: an auto line past the cap wraps to two lines at the cap width', () => {
    const a = 'a'.repeat(31);
    const b = 'b'.repeat(31);
    expect(fake(`${a} ${b}`, M)).toBeGreaterThan(TEXT_MAX_AUTO_WIDTH_WORLD);
    const box = layoutText(`${a} ${b}`, 'M', 'auto', null, fake);
    expect(box.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(box.lines).toEqual([a, b]);
    expect(box.height).toBe(2 * M * TEXT_LINE_HEIGHT);
  });

  it('TC-09: a line measuring exactly the cap stays one capped line', () => {
    const line = 'c'.repeat(60); // 60 * 20 / 2 = 600
    expect(fake(line, M)).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    const box = layoutText(line, 'M', 'auto', null, fake);
    expect(box.lines).toEqual([line]);
    expect(box.width).toBe(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(box.height).toBe(M * TEXT_LINE_HEIGHT);
  });

  it('TC-10: fixed mode wraps words at the stored width', () => {
    const box = layoutText('cat dog fox', 'M', 'fixed', TEXT_MIN_WIDTH_WORLD, fake);
    expect(box.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(box.lines).toEqual(['cat', 'dog', 'fox']);
    expect(box.height).toBe(3 * M * TEXT_LINE_HEIGHT);
  });

  it('TC-11: explicit newlines split lines in auto mode', () => {
    const box = layoutText('ab\ncdefg\nh', 'M', 'auto', null, fake);
    expect(box.lines).toEqual(['ab', 'cdefg', 'h']);
    expect(box.width).toBe(5 * (M / 2) + TEXT_PADDING_WORLD); // longest line
    expect(box.height).toBe(3 * M * TEXT_LINE_HEIGHT);
  });

  it('TC-32: createCanvasMeasurer falls back to the estimate when no canvas exists', () => {
    const measure = createCanvasMeasurer();
    expect(measure).toBe(estimateMeasurer);
    expect(measure('abc', 20)).toBeCloseTo(3 * 20 * TEXT_ESTIMATED_GLYPH_WIDTH_RATIO);
  });
});
