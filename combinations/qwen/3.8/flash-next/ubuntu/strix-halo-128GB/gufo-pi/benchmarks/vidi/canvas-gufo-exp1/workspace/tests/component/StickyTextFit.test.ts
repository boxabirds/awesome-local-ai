/**
 * Font auto-fit. jsdom has no text layout, so the element's measured heights are
 * simulated: the scrollHeight a browser would report at the probed font size.
 */
import { describe, expect, it } from 'vitest';
import { fitFontSize } from '../../src/client/objects/StickyText';
import { STICKY_FONT_MAX_PX, STICKY_FONT_MIN_PX } from '../../src/shared/config';

/**
 * A div whose `scrollHeight` is `contentHeight(fontSize)` and whose `clientHeight`
 * is `box`. The getter reads the size the fitter has just written to the style.
 */
const measurable = (box: number, contentHeight: (fontSize: number) => number): HTMLElement => {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientHeight', { value: box, configurable: true });
  Object.defineProperty(el, 'scrollHeight', {
    configurable: true,
    get: () => contentHeight(parseFloat(el.style.fontSize || '16')),
  });
  return el;
};

describe('fitFontSize', () => {
  it('returns the maximum size when the text fits at 24px', () => {
    const el = measurable(200, (px) => Math.ceil(px * 1.35));
    expect(fitFontSize(el)).toEqual({ fontPx: STICKY_FONT_MAX_PX, overflow: false });
  });

  it('binary-searches the largest integer size that fits', () => {
    // 9 * px fits while px <= 22.2, so 22 is the largest fitting size.
    const el = measurable(200, (px) => px * 9);
    expect(fitFontSize(el)).toEqual({ fontPx: 22, overflow: false });
  });

  it('clamps at the minimum size and reports overflow when nothing fits', () => {
    const el = measurable(200, (px) => px * 40);
    expect(fitFontSize(el)).toEqual({ fontPx: STICKY_FONT_MIN_PX, overflow: true });
    expect(el.style.fontSize).toBe(`${STICKY_FONT_MIN_PX}px`);
  });

  it('fits exactly at the minimum size without reporting overflow', () => {
    const el = measurable(200, (px) => px * 20);
    expect(fitFontSize(el)).toEqual({ fontPx: STICKY_FONT_MIN_PX, overflow: false });
  });

  it('leaves the chosen size on the element for the caller to render', () => {
    const el = measurable(200, (px) => px * 1.35);
    const fit = fitFontSize(el);
    expect(el.style.fontSize).toBe(`${fit.fontPx}px`);
  });
});
