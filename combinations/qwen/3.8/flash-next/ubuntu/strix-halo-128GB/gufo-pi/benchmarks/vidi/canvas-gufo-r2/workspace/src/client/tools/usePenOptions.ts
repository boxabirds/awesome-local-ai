/**
 * Session-only pen options (story 11).
 * Colour and thickness are remembered until the page is reloaded (not persisted).
 */
import { useCallback, useState } from 'react';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  type PenColor,
  type PenThickness,
} from '../../shared/config';

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
