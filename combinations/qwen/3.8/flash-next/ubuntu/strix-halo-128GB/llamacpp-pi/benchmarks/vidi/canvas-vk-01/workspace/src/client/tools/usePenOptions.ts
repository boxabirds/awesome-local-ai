import { useCallback, useState } from 'react';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  type PenColor,
  type PenThickness,
} from '../../shared/config';

/**
 * Session-only colour and thickness for the Pen tool.
 * Choices persist while the page is open but are never saved to the doc or
 * localStorage — they reset on reload (`pen.options`).
 */
export function usePenOptions(): {
  color: PenColor;
  thickness: PenThickness;
  setColor(c: PenColor): void;
  setThickness(t: PenThickness): void;
} {
  const [color, setColorState] = useState<PenColor>(DEFAULT_PEN_COLOR);
  const [thickness, setThicknessState] = useState<PenThickness>(DEFAULT_PEN_THICKNESS);

  const setColor = useCallback((c: PenColor) => setColorState(c), []);
  const setThickness = useCallback((t: PenThickness) => setThicknessState(t), []);

  return { color, thickness, setColor, setThickness };
}
