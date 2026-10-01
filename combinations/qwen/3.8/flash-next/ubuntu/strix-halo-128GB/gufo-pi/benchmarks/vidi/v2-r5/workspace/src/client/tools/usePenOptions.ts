import { useState } from 'react';
import {
  type PenColor,
  type PenThickness,
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
} from '../../shared/config';

export interface UsePenOptionsResult {
  color: PenColor;
  thickness: PenThickness;
  setColor(c: PenColor): void;
  setThickness(t: PenThickness): void;
}

/**
 * Session-only pen options (colour and thickness). Not persisted across page reloads.
 */
export function usePenOptions(): UsePenOptionsResult {
  const [color, setColor] = useState<PenColor>(DEFAULT_PEN_COLOR);
  const [thickness, setThickness] = useState<PenThickness>(DEFAULT_PEN_THICKNESS);

  return { color, thickness, setColor, setThickness };
}
