/**
 * Pen options (story 11, pen.options): session-only colour and thickness
 * state. Defaults DEFAULT_PEN_COLOR / DEFAULT_PEN_THICKNESS; the choices are
 * remembered until the page is reloaded (never persisted) and never restyle
 * strokes already drawn.
 */
import { useState } from 'react';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  type PenColor,
  type PenThickness,
} from '../../shared/config';

export function usePenOptions(): {
  color: PenColor;
  thickness: PenThickness;
  setColor(c: PenColor): void;
  setThickness(t: PenThickness): void;
} {
  const [color, setColor] = useState<PenColor>(DEFAULT_PEN_COLOR);
  const [thickness, setThickness] = useState<PenThickness>(DEFAULT_PEN_THICKNESS);
  return { color, thickness, setColor, setThickness };
}
