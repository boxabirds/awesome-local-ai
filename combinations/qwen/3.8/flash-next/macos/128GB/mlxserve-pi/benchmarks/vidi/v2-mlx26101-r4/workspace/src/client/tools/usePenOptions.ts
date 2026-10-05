/**
 * The pen's two settings: which ink, and which nib.
 *
 * Session state, in React, and deliberately nothing more than that. It is *not* written to the document (a
 * stroke stores the names it was drawn with, and never reads anybody's current choice again), it is *not*
 * saved to `localStorage` (the choice is about the stroke about to be drawn, not about this board), and it is
 * not shared (what somebody else's pen is filled with is none of this person's business). A reload brings the
 * defaults back, which is what `pen.options` asks for and what a person who changed the ink for one annotation
 * expects: the pen goes back to black, the drawing stays purple.
 *
 * The setters check the name they are handed rather than trusting the toolbar, for the same reason
 * `setShapeKind` does: a colour that is not one of the six would be a pen that draws nothing, and a component
 * that lets a value in through a prop cannot promise that the value came from the six.
 */
import { useCallback, useState } from 'react';

import { DEFAULT_PEN_COLOR, DEFAULT_PEN_THICKNESS, isPenColor, isPenThickness } from '../../shared/config';
import type { PenColor, PenThickness } from '../../shared/config';

export interface PenOptionsState {
  /** The ink the next stroke will be drawn in. */
  color: PenColor;
  /** The nib the next stroke will be drawn with. */
  thickness: PenThickness;
  /** Fill the pen with one of the six inks. A name outside the six is not a colour and is not taken. */
  setColor(color: PenColor): void;
  /** Fit one of the three nibs. A name outside the three is not a width and is not taken. */
  setThickness(thickness: PenThickness): void;
}

export function usePenOptions(): PenOptionsState {
  const [color, setColorState] = useState<PenColor>(DEFAULT_PEN_COLOR);
  const [thickness, setThicknessState] = useState<PenThickness>(DEFAULT_PEN_THICKNESS);

  const setColor = useCallback((wanted: PenColor): void => {
    if (!isPenColor(wanted)) return;
    setColorState(wanted);
  }, []);

  const setThickness = useCallback((wanted: PenThickness): void => {
    if (!isPenThickness(wanted)) return;
    setThicknessState(wanted);
  }, []);

  return { color, thickness, setColor, setThickness };
}
