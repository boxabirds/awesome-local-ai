// The pen's live options (story 11 `pen.ui`): the colour and thickness the next stroke
// is drawn with.
//
// Deliberately not a `useLocalOptions` store like the shape's: pen options are session
// state and nothing else (pen.options). They are not written to the document, not kept
// between sessions, and not shared — so they cost no localStorage read on mount, no
// validation and no migration. A reload, a new board and a new tab all start the pen at
// `DEFAULT_PEN_COLOR` and `DEFAULT_PEN_THICKNESS`, which a test can assert by loading the
// page and looking at what is pressed.
//
// The value is a plain object built on every render, so a caller that memoises its own
// callbacks is not defeated by it; the setters are stable.

import { useCallback, useState } from 'react';
import { DEFAULT_PEN_COLOR, DEFAULT_PEN_THICKNESS } from '../../shared/config.ts';
import type { PenColor, PenThickness } from '../../shared/objects/stroke.ts';

export interface PenOptionsValue {
  color: PenColor;
  thickness: PenThickness;
  setColor(c: PenColor): void;
  setThickness(t: PenThickness): void;
}

/** The pen's colour and thickness, for as long as this board is open. */
export function usePenOptions(): PenOptionsValue {
  const [color, setColorState] = useState<PenColor>(DEFAULT_PEN_COLOR);
  const [thickness, setThicknessState] = useState<PenThickness>(DEFAULT_PEN_THICKNESS);
  const setColor = useCallback((c: PenColor) => setColorState(c), []);
  const setThickness = useCallback((t: PenThickness) => setThicknessState(t), []);
  return { color, thickness, setColor, setThickness };
}
