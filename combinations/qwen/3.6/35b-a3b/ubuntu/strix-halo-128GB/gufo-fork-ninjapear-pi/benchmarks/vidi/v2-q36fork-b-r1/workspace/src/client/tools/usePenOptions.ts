import { useState, useCallback } from 'react';
import { PEN_COLORS, PEN_THICKNESS_WORLD, DEFAULT_PEN_COLOR, DEFAULT_PEN_THICKNESS } from '@/shared/config';
import type { PenColor, PenThickness } from '@/shared/config';

export function usePenOptions() {
  const [color, setColor] = useState<PenColor>(DEFAULT_PEN_COLOR);
  const [thickness, setThickness] = useState<PenThickness>(DEFAULT_PEN_THICKNESS);

  const setColorImpl = useCallback((c: PenColor) => {
    if (!(c in PEN_COLORS)) return;
    setColor(c);
  }, []);

  const setThicknessImpl = useCallback((t: PenThickness) => {
    if (!(t in PEN_THICKNESS_WORLD)) return;
    setThickness(t);
  }, []);

  return { color, thickness, setColor: setColorImpl, setThickness: setThicknessImpl };
}
