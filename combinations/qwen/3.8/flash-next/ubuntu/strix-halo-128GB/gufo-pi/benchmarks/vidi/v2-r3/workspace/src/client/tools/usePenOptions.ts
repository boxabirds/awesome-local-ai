/**
 * usePenOptions (story 11): session-only colour and thickness state for the pen tool.
 */
import { useState, useCallback } from 'react';
import type { PenColor, PenThickness } from '../../shared/config';
import { DEFAULT_PEN_COLOR, DEFAULT_PEN_THICKNESS } from '../../shared/config';

export interface UsePenOptionsResult {
  color: PenColor;
  thickness: PenThickness;
  setColor(c: PenColor): void;
  setThickness(t: PenThickness): void;
}

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
