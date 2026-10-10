// Session-only pen options (pen.options): the chosen colour and thickness are
// kept here until the page reloads. Existing strokes store their own colour
// and thickness, so changing these never restyles them.

import { useCallback, useState } from 'react';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  type PenColor,
  type PenThickness,
} from '../../shared/config';

export type { PenColor, PenThickness };

export interface PenOptions {
  color: PenColor;
  thickness: PenThickness;
  setColor(color: PenColor): void;
  setThickness(thickness: PenThickness): void;
}

export function usePenOptions(): PenOptions {
  const [color, setColorState] = useState<PenColor>(DEFAULT_PEN_COLOR);
  const [thickness, setThicknessState] = useState<PenThickness>(DEFAULT_PEN_THICKNESS);
  const setColor = useCallback((next: PenColor) => setColorState(next), []);
  const setThickness = useCallback((next: PenThickness) => setThicknessState(next), []);
  return { color, thickness, setColor, setThickness };
}
