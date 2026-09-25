import { useCallback, useState } from 'react';
import { DEFAULT_PEN_COLOR, DEFAULT_PEN_THICKNESS } from '../../shared/config';
import { isPenColor, isPenThickness, type PenColor, type PenThickness } from '../../shared/objects/stroke';

/**
 * The Pen tool's colour and thickness (pen.options): session state only, remembered while switching tools and
 * reset by a page reload. Changing them never touches strokes already drawn.
 */
export function usePenOptions(): {
  color: PenColor;
  thickness: PenThickness;
  setColor(c: PenColor): void;
  setThickness(t: PenThickness): void;
} {
  const [color, setColorState] = useState<PenColor>(DEFAULT_PEN_COLOR);
  const [thickness, setThicknessState] = useState<PenThickness>(DEFAULT_PEN_THICKNESS);
  const setColor = useCallback((c: PenColor) => {
    if (isPenColor(c)) setColorState(c);
  }, []);
  const setThickness = useCallback((t: PenThickness) => {
    if (isPenThickness(t)) setThicknessState(t);
  }, []);
  return { color, thickness, setColor, setThickness };
}
