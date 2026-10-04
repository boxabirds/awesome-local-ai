/**
 * Session-only pen options state (story 11).
 * Colour and thickness are remembered until the page is reloaded.
 */
import { useState } from 'react';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
} from '../../shared/config';
import type { PenColor, PenThickness } from '../../shared/objects/stroke';

export interface PenOptions {
  color: PenColor;
  thickness: PenThickness;
  setColor(c: PenColor): void;
  setThickness(t: PenThickness): void;
}

export function usePenOptions(): PenOptions {
  const [color, setColor] = useState<PenColor>(DEFAULT_PEN_COLOR);
  const [thickness, setThickness] = useState<PenThickness>(DEFAULT_PEN_THICKNESS);

  return { color, thickness, setColor, setThickness };
}
