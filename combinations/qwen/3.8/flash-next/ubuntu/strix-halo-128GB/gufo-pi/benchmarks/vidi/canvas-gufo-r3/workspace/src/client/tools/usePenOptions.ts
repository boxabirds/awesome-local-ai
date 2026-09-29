import { useState, useCallback } from 'react';
import { DEFAULT_PEN_COLOR, DEFAULT_PEN_THICKNESS, type PenColor, type PenThickness } from '@shared/config';

export interface UsePenOptionsResult {
  color: PenColor;
  thickness: PenThickness;
  setColor(c: PenColor): void;
  setThickness(t: PenThickness): void;
}

/**
 * Session-only (not persisted) pen colour and thickness state.
 * Defaults: DEFAULT_PEN_COLOR and DEFAULT_PEN_THICKNESS.
 */
export function usePenOptions(): UsePenOptionsResult {
  const [color, setColorState] = useState<PenColor>(DEFAULT_PEN_COLOR);
  const [thickness, setThicknessState] = useState<PenThickness>(DEFAULT_PEN_THICKNESS);

  const setColor = useCallback((c: PenColor) => {
    setColorState(c);
  }, []);

  const setThickness = useCallback((t: PenThickness) => {
    setThicknessState(t);
  }, []);

  return { color, thickness, setColor, setThickness };
}
