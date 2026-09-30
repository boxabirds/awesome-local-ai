/**
 * Pen options: session-only colour and thickness state.
 * Not persisted — resets on page reload.
 */

import { useState } from 'react';

import { DEFAULT_PEN_COLOR, DEFAULT_PEN_THICKNESS, type PenColor, type PenThickness } from '../../shared/config';

export interface UsePenOptionsResult {
  color: PenColor;
  thickness: PenThickness;
  setColor(c: PenColor): void;
  setThickness(t: PenThickness): void;
}

export function usePenOptions(): UsePenOptionsResult {
  const [color, setColor] = useState<PenColor>(DEFAULT_PEN_COLOR);
  const [thickness, setThickness] = useState<PenThickness>(DEFAULT_PEN_THICKNESS);

  return { color, thickness, setColor, setThickness };
}
