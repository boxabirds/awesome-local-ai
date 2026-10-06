/**
 * The pen's colour and thickness, for as long as this page is open (`pen.options`).
 *
 * Two settings, held in exactly one place, because the pen is the rare tool whose options are
 * *not* about the object being made: a stroke is born with its colour and thickness and never
 * changes them, so there is nothing to read back. The pen toolbar shows these, the Pen tool
 * draws with these, and choosing between them does not restyle a single thing already on the
 * board — which is what makes it safe to hand the setter straight to a swatch.
 *
 * They are React state, and that is the whole of the persistence: the PRD's promise is "until
 * the page is reloaded", so the values are deliberately *not* in the document (a colleague must
 * not inherit your red), not in `localStorage` (a refresh is meant to put the pen back to black
 * and medium) and not in the active tool's state, which belongs to `useActiveTool` and knows
 * nothing about what a tool draws with.
 */

import { useCallback, useState } from 'react';
import { DEFAULT_PEN_COLOR, DEFAULT_PEN_THICKNESS } from '../../shared/config';
import { isPenColor, isPenThickness, type PenColor, type PenThickness } from '../../shared/objects/stroke';

export interface PenOptions {
  color: PenColor;
  thickness: PenThickness;
  /** The colour the next stroke is drawn in. A name this build has no ink for is ignored. */
  setColor(color: PenColor): void;
  /** The thickness the next stroke is drawn at. A name this build cannot measure is ignored. */
  setThickness(thickness: PenThickness): void;
}

/** The pen's current colour and thickness, and the only two ways to change them. */
export function usePenOptions(): PenOptions {
  const [color, setColorState] = useState<PenColor>(DEFAULT_PEN_COLOR);
  const [thickness, setThicknessState] = useState<PenThickness>(DEFAULT_PEN_THICKNESS);

  // Validated here rather than trusted, so a caller cannot put the pen out of ink: a colour
  // outside `PEN_COLORS` would draw a stroke in `undefined`, which is a line nobody can see.
  const setColor = useCallback((next: PenColor) => {
    if (isPenColor(next)) setColorState(next);
  }, []);
  const setThickness = useCallback((next: PenThickness) => {
    if (isPenThickness(next)) setThicknessState(next);
  }, []);

  return { color, thickness, setColor, setThickness };
}
