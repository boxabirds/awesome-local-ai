// What the next stroke looks like (`pen.options`).
//
// The colour and the thickness of a freehand line are decided *while drawing*, which makes
// them neither a document field nor a preference: they are what this screen is going to do
// next. So they live here, in local state, and nowhere else:
//
//   - they are never written to the shared document, because a stroke keeps the colour and
//     thickness it was made with and nothing that already exists is ever restyled;
//   - they are never saved, because the PRD's promise is that the choice holds "for the rest
//     of the session" — a page reload is a new session, and comes up black and medium;
//   - they are not per-stroke state either: the same two values are handed to every stroke
//     this tool makes until somebody clicks a different swatch.
//
// An unknown colour or thickness is refused rather than fallen back to, so that a
// `setColor('pink')` cannot put a word in the tool that the model would then reject.
//
// Spec: spec/stories/011-sketch-freehand-with-a-pen/design.md (pen.tool)
import { useCallback, useMemo, useState } from 'react';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness,
} from '../../shared/config';

export interface PenOptions {
  /** What the next stroke is drawn in. */
  color: PenColor;
  /** How thick the next stroke is. */
  thickness: PenThickness;
  setColor(color: PenColor): void;
  setThickness(thickness: PenThickness): void;
}

export function usePenOptions(): PenOptions {
  const [color, setColorState] = useState<PenColor>(DEFAULT_PEN_COLOR);
  const [thickness, setThicknessState] = useState<PenThickness>(DEFAULT_PEN_THICKNESS);

  const setColor = useCallback((next: PenColor): void => {
    // The toolbar offers the palette and nothing else; a colour outside it is not a colour.
    if (!Object.prototype.hasOwnProperty.call(PEN_COLORS, next)) return;
    setColorState(next);
  }, []);

  const setThickness = useCallback((next: PenThickness): void => {
    if (!Object.prototype.hasOwnProperty.call(PEN_THICKNESS_WORLD, next)) return;
    setThicknessState(next);
  }, []);

  return useMemo(
    () => ({ color, thickness, setColor, setThickness }),
    [color, thickness, setColor, setThickness],
  );
}
