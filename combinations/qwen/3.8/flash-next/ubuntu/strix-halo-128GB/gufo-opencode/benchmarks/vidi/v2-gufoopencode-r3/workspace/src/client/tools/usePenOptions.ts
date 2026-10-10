import { useCallback, useState } from 'react';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  type PenColor,
  type PenThickness
} from '../../shared/config';

export interface PenOptions {
  color: PenColor;
  thickness: PenThickness;
  setColor(c: PenColor): void;
  setThickness(t: PenThickness): void;
}

// The current pen choices, held only in this tab's memory: used by every
// later stroke until the page is reloaded, never written to the document.
export function usePenOptions(): PenOptions {
  const [color, setColor] = useState<PenColor>(DEFAULT_PEN_COLOR);
  const [thickness, setThickness] = useState<PenThickness>(DEFAULT_PEN_THICKNESS);
  return {
    color,
    thickness,
    setColor: useCallback((c: PenColor) => setColor(c), []),
    setThickness: useCallback((t: PenThickness) => setThickness(t), [])
  };
}
