import { useCallback, useState } from 'react';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  isPenColor,
  isPenThickness,
  type PenColor,
  type PenThickness,
} from '../../shared/config';

/**
 * What the pen is set to draw with, and the two ways to change it (story 11).
 *
 * Both choices live in this tab and this page load, and nowhere else. They are not written to the
 * document, because they are not facts about the board: what a stroke was drawn with is stamped into
 * the stroke at the moment it is committed, and the six strokes already on the board do not change
 * colour because somebody felt like red. And they are not remembered between loads either - the PRD's
 * word is *until the page is reloaded*, which is the sentence a piece of localStorage would break.
 *
 * The state is in a hook rather than in the toolbar that shows it because two components need the same
 * answer at once: the toolbar prints which swatch is pressed, and the tool needs the value at the
 * instant the pointer is lifted, which is a moment the toolbar is not standing next to.
 */
export interface PenOptions {
  color: PenColor;
  thickness: PenThickness;
  setColor(color: PenColor): void;
  setThickness(thickness: PenThickness): void;
}

export function usePenOptions(): PenOptions {
  const [color, setColorState] = useState<PenColor>(DEFAULT_PEN_COLOR);
  const [thickness, setThicknessState] = useState<PenThickness>(DEFAULT_PEN_THICKNESS);

  const setColor = useCallback((wanted: PenColor): void => {
    // A colour the pen does not have leaves the pen exactly as it was. The set of colours the pen has
    // is a thing the product decides (config), and a caller that hands over something outside it - a
    // colour name from a URL, a sticky note's yellow - would otherwise draw a line in `undefined`.
    if (isPenColor(wanted)) {
      setColorState(wanted);
    }
  }, []);

  const setThickness = useCallback((wanted: PenThickness): void => {
    if (isPenThickness(wanted)) {
      setThicknessState(wanted);
    }
  }, []);

  return { color, thickness, setColor, setThickness };
}
