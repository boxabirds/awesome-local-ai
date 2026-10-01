import { useCallback, useState } from 'react';
import { DEFAULT_PEN_COLOR, DEFAULT_PEN_THICKNESS } from '../../shared/config';
import type { PenColor, PenThickness } from '../../shared/config';

/** Pen colour and thickness for this page load only (not persisted, never applied to existing strokes). */
export function usePenOptions(): { color: PenColor; thickness: PenThickness; setColor(c: PenColor): void; setThickness(t: PenThickness): void } {
  const [color, setColorState] = useState<PenColor>(DEFAULT_PEN_COLOR);
  const [thickness, setThicknessState] = useState<PenThickness>(DEFAULT_PEN_THICKNESS);
  const setColor = useCallback((c: PenColor) => setColorState(c), []);
  const setThickness = useCallback((t: PenThickness) => setThicknessState(t), []);
  return { color, thickness, setColor, setThickness };
}
