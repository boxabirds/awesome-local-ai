/**
 * Story 11: session-only pen options (colour and thickness).
 *
 * Held in React state for the life of the page: the choices are remembered
 * until the page is reloaded (PRD pen.options) and are never persisted.
 * Changing them never restyles strokes already drawn.
 */
import { useState, useCallback } from 'react';
import { DEFAULT_PEN_COLOR, DEFAULT_PEN_THICKNESS } from '@shared/config';
import type { PenColor, PenThickness } from '@shared/objects/stroke';

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
