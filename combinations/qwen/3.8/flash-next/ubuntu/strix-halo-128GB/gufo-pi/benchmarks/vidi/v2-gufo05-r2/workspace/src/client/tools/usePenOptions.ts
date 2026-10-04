/**
 * Story 11: which colour and weight this page's pen is set to.
 *
 * Two pieces of React state, and that is the whole of it — which is the decision: the
 * choice is held *until the page is reloaded* (PRD pen.options.reload), not written to
 * the document and not remembered in the browser.
 *
 * - Not in the document, because what *your* pen is set to says nothing about anybody
 *   else's board. Story 3 draws the line at the selection, and a pen setting is the same
 *   kind of fact: two people holding the same board can be holding different colours.
 *   What travels is the colour each finished stroke *stores*.
 * - Not in `localStorage`, because the PRD says the choice lasts until the page is
 *   reloaded, and a remembered pen would outlive the promise. It is also the same rule
 *   the Shape tool's kind follows (`useActiveTool`'s `shapeKind`).
 *
 * Nothing here restyles a stroke: a stroke keeps the colour and thickness it was drawn
 * with, whatever the pen is set to afterwards (PRD pen.options.no_restyle).
 */

import { useCallback, useState } from 'react';

import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness,
} from '../../shared/config';

export interface PenOptions {
  color: PenColor;
  thickness: PenThickness;
  setColor(color: PenColor): void;
  setThickness(thickness: PenThickness): void;
}

export function usePenOptions(): PenOptions {
  const [color, setColorState] = useState<PenColor>(DEFAULT_PEN_COLOR);
  const [thickness, setThicknessState] = useState<PenThickness>(DEFAULT_PEN_THICKNESS);

  // A colour or a weight the palette does not have is ignored rather than stored: the
  // board must never be about to draw a stroke it cannot draw.
  const setColor = useCallback((next: PenColor) => {
    if (!Object.hasOwn(PEN_COLORS, next)) return;
    setColorState(next);
  }, []);

  const setThickness = useCallback((next: PenThickness) => {
    if (!Object.hasOwn(PEN_THICKNESS_WORLD, next)) return;
    setThicknessState(next);
  }, []);

  return { color, thickness, setColor, setThickness };
}
