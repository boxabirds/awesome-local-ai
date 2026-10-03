/**
 * The Pen tool's current settings (`pen.tool_ui`, `pen.session`).
 *
 * The colour and thickness the pen will draw in are a per-session choice: they start at the
 * defaults, change when a swatch is picked, and are remembered across every stroke and every
 * re-arm of the tool for as long as the page lives. They are deliberately *not* written to the
 * document or to storage — reload the page and they are back to the defaults (`pen.session`).
 */
import { useCallback, useState } from 'react';

import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  type PenColor,
  type PenThickness,
} from '../../shared/config';

export interface PenOptions {
  color: PenColor;
  thickness: PenThickness;
  setColor(color: PenColor): void;
  setThickness(thickness: PenThickness): void;
}

export function usePenOptions(): PenOptions {
  const [color, setColor] = useState<PenColor>(DEFAULT_PEN_COLOR);
  const [thickness, setThickness] = useState<PenThickness>(DEFAULT_PEN_THICKNESS);
  // useCallback only to keep the object's shape stable across renders; the setters already are.
  const rememberColor = useCallback((next: PenColor) => setColor(next), []);
  const rememberThickness = useCallback((next: PenThickness) => setThickness(next), []);
  return { color, thickness, setColor: rememberColor, setThickness: rememberThickness };
}
