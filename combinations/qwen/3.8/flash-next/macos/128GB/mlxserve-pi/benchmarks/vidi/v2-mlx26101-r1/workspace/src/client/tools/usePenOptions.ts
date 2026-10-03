// The pen this person is holding: which ink, and how thick a nib (story 11, pen.options).
//
// Two settings, one tab, one visit. They are React state and deliberately not persisted: the PRD
// says a choice is remembered "until the page is reloaded", which is exactly the lifetime of a
// component's state and nothing longer. Reaching for localStorage here would be a second, private
// copy of a board setting that another tab, another person on the same machine, or the same person
// tomorrow might not want — and it would be a thing this story has to test and no one asked for.
//
// Like the active tool and the shape kind, these are never written to the shared document: what
// colour I am drawing in is not a fact about the board, and it must never appear on anyone
// else's screen.

import { useCallback, useState } from 'react';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness,
} from '../../shared/config';

export interface PenOptionsApi {
  /** The colour the next stroke is drawn in. */
  color: PenColor;
  /** The nib the next stroke is drawn with. */
  thickness: PenThickness;
  /**
   * Draw in `color` from now on. A colour the board does not have is ignored rather than
   * remembered: the strokes already drawn keep theirs whatever happens (pen.options), and a
   * pen full of an ink nobody has is a pen that writes nothing.
   */
  setColor(color: PenColor): void;
  /** The same, for the nib. */
  setThickness(thickness: PenThickness): void;
}

/** The pen's colour and thickness, for as long as this tab holds the board. */
export function usePenOptions(): PenOptionsApi {
  const [color, setColorState] = useState<PenColor>(DEFAULT_PEN_COLOR);
  const [thickness, setThicknessState] = useState<PenThickness>(DEFAULT_PEN_THICKNESS);

  const setColor = useCallback((next: PenColor): void => {
    if (typeof next !== 'string' || !(next in PEN_COLORS)) return;
    setColorState(next);
  }, []);

  const setThickness = useCallback((next: PenThickness): void => {
    if (typeof next !== 'string' || !(next in PEN_THICKNESS_WORLD)) return;
    setThicknessState(next);
  }, []);

  return { color, thickness, setColor, setThickness };
}
