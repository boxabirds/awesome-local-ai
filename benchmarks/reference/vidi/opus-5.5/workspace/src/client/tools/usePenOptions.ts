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
  setColor(c: PenColor): void;
  setThickness(t: PenThickness): void;
}

/**
 * The pen's colour and thickness (pen.options): session state only, kept while the board is
 * open (across tool switches) and back to the defaults after a reload. Changing them never
 * touches strokes already drawn. Unknown names are ignored.
 */
export function usePenOptions(): PenOptions {
  const [color, setColorState] = useState<PenColor>(DEFAULT_PEN_COLOR);
  const [thickness, setThicknessState] = useState<PenThickness>(DEFAULT_PEN_THICKNESS);
  const setColor = useCallback((c: PenColor) => {
    if (Object.prototype.hasOwnProperty.call(PEN_COLORS, c)) setColorState(c);
  }, []);
  const setThickness = useCallback((t: PenThickness) => {
    if (Object.prototype.hasOwnProperty.call(PEN_THICKNESS_WORLD, t)) setThicknessState(t);
  }, []);
  return { color, thickness, setColor, setThickness };
}
