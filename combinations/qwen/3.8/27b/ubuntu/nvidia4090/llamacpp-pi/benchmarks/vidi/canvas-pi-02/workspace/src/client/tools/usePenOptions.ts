import { useCallback, useState } from 'react';
import { DEFAULT_PEN_COLOR, DEFAULT_PEN_THICKNESS } from '../../shared/config';
import type { PenColor, PenThickness } from '../../shared/config';

/**
 * Pen options (story 11, pen.tool).
 *
 * The pen's current colour and thickness live in React state for the
 * session: they default to black / medium and are remembered until the page
 * is reloaded (never persisted to the board doc — the options belong to the
 * pen, not to a stroke).
 */
export interface PenOptions {
  color: PenColor;
  thickness: PenThickness;
  setColor: (c: PenColor) => void;
  setThickness: (t: PenThickness) => void;
}

export function usePenOptions(): PenOptions {
  const [color, setColorState] = useState<PenColor>(DEFAULT_PEN_COLOR);
  const [thickness, setThicknessState] = useState<PenThickness>(DEFAULT_PEN_THICKNESS);

  const setColor = useCallback((c: PenColor) => setColorState(c), []);
  const setThickness = useCallback((t: PenThickness) => setThicknessState(t), []);

  return { color, thickness, setColor, setThickness };
}
