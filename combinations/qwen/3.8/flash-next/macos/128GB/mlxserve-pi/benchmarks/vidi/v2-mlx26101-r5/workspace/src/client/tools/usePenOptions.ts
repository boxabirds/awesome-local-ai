/**
 * Which pen this person is drawing with (story 11).
 *
 * Two pieces of session state, and the interesting thing about them is what they are *not*: not in the
 * document, not in `localStorage`, not on the server. The design calls this `pen.options.session_only`,
 * and the reason is that a colour is a thing a person is doing rather than a thing a board is — nobody
 * else's screen has an interest in which pen this one is holding, and a preference saved to a disk is a
 * preference that has to be argued with when somebody wants to draw something in red for once.
 *
 * So it is `useState`, which means exactly two things. The choice stands until the page is reloaded: draw
 * six strokes in purple, reload, and the pen is black again. And it is *behind* the strokes rather than
 * under them — picking a new colour changes the next stroke and never the last one, because the last one
 * already has its colour written into it, in the only place a finished stroke's colour has ever been kept.
 *
 * One hook shared by the toolbar and the tool, because both of them have to be talking about the same pen:
 * the buttons show what is chosen, and the drag draws with it. That is the only reason it is a hook and not
 * two pieces of state in the board with two props threaded through, which is how the Shape tool's kind is
 * carried and costs the board four props to say the same thing.
 */

import { useCallback, useMemo, useState } from 'react';

import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  type PenColor,
  type PenThickness,
} from '../../shared/config';
import { isPenColor, isPenThickness } from '../../shared/objects/stroke';

/** What the pen is holding, and the two ways to change it. */
export interface PenOptions {
  /** Which of the six colours the next stroke is drawn in. */
  color: PenColor;
  /** Which of the three thicknesses the next stroke is drawn with. */
  thickness: PenThickness;
  /** Draws the next stroke in `color`. A colour this build has no ink for changes nothing. */
  setColor(color: PenColor): void;
  /** Draws the next stroke at `thickness`. A thickness this build cannot measure changes nothing. */
  setThickness(thickness: PenThickness): void;
}

export function usePenOptions(): PenOptions {
  const [color, setColorState] = useState<PenColor>(DEFAULT_PEN_COLOR);
  const [thickness, setThicknessState] = useState<PenThickness>(DEFAULT_PEN_THICKNESS);

  const setColor = useCallback((next: PenColor) => {
    // A colour the buttons should never have offered is refused rather than remembered: a tool whose
    // swatch says "red" and draws in black is a tool that has lied, and the lie would last until the page
    // was reloaded — which is the only cure a session-only setting has.
    if (!isPenColor(next)) return;
    setColorState(next);
  }, []);

  const setThickness = useCallback((next: PenThickness) => {
    if (!isPenThickness(next)) return;
    setThicknessState(next);
  }, []);

  return useMemo(() => ({ color, thickness, setColor, setThickness }), [color, thickness, setColor, setThickness]);
}
