/**
 * Pen options hook (story 11). Session-only colour/thickness state: the
 * choice is remembered until the page is reloaded and is used for every
 * subsequent stroke; existing strokes keep their stored options
 * (pen.options).
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
  setColor: (c: PenColor) => void;
  setThickness: (t: PenThickness) => void;
}

export function usePenOptions(): PenOptions {
  const [color, setColor] = useState<PenColor>(DEFAULT_PEN_COLOR);
  const [thickness, setThickness] = useState<PenThickness>(DEFAULT_PEN_THICKNESS);

  const setColorCb = useCallback((c: PenColor) => setColor(c), []);
  const setThicknessCb = useCallback((t: PenThickness) => setThickness(t), []);

  return { color, thickness, setColor: setColorCb, setThickness: setThicknessCb };
}
