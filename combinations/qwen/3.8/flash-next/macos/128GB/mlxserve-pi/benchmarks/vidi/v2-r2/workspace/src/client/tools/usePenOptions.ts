// The Pen tool's two choices (story 11): the colour and the thickness the next
// stroke is drawn with.
//
// Both are state of the *screen*, not of the document - the same rule every tool in
// stories 9-12 holds to. Nobody else is told what thickness this person picked, it
// is written nowhere, and a reload starts from the defaults again. What it does
// remember is the choice for the rest of this visit: draw six strokes without
// touching the toolbar and all six are the same line, which is what "session state"
// is for.
//
// A stroke already on the board is never restyled by a change here: the colour and
// thickness are stored on the stroke when it is drawn, so the person who draws a
// red line after a black one does not repaint the black one.

import { useCallback, useState } from 'react';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  PEN_COLOR_KEYS,
  PEN_THICKNESS_KEYS,
  type PenColor,
  type PenThickness,
} from '../../shared/config';

export interface PenOptions {
  /** The colour the next stroke is drawn in. */
  color: PenColor;
  /** The thickness the next stroke is drawn with. */
  thickness: PenThickness;
  /** Ignored for a colour this build has no pen for. */
  setColor(color: PenColor): void;
  /** Ignored for a thickness this build has no pen for. */
  setThickness(thickness: PenThickness): void;
}

export function usePenOptions(): PenOptions {
  const [color, setColorState] = useState<PenColor>(DEFAULT_PEN_COLOR);
  const [thickness, setThicknessState] = useState<PenThickness>(DEFAULT_PEN_THICKNESS);

  const setColor = useCallback(
    (next: PenColor): void => {
      if (PEN_COLOR_KEYS.includes(next)) setColorState(next);
    },
    [],
  );
  const setThickness = useCallback(
    (next: PenThickness): void => {
      if (PEN_THICKNESS_KEYS.includes(next)) setThicknessState(next);
    },
    [],
  );

  return { color, thickness, setColor, setThickness };
}
