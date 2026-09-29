/**
 * Story 11: pen options state (pen.options).
 *
 * Local React state only — no persistence (a new session starts black/medium,
 * pen.options). The values are passed to PenToolbar (display) and PenTool
 * (drawing); both read them from this single hook.
 */
import { useCallback, useState } from 'react';
import { DEFAULT_PEN_COLOR, DEFAULT_PEN_THICKNESS } from 'src/shared/config';
import type { PenColor, PenThickness } from 'src/shared/objects/stroke';

export interface PenOptions {
  color: PenColor;
  thickness: PenThickness;
  setColor: (c: PenColor) => void;
  setThickness: (t: PenThickness) => void;
}

export function usePenOptions(): PenOptions {
  const [color, setColorState] = useState<PenColor>(DEFAULT_PEN_COLOR);
  const [thickness, setThicknessState] = useState<PenThickness>(DEFAULT_PEN_THICKNESS);
  const setColor = useCallback((c: PenColor) => setColorState(c), []);
  const setThickness = useCallback((t: PenThickness) => setThicknessState(t), []);
  return { color, thickness, setColor, setThickness };
}
