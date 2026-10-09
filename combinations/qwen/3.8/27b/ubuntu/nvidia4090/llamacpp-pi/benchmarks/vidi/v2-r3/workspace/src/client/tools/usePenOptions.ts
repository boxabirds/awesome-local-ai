import { useState } from 'react';
import { DEFAULT_PEN_COLOR, DEFAULT_PEN_THICKNESS } from '../../shared/config';
import type { PenColor, PenThickness } from '../../shared/objects/stroke';

/**
 * Story 11 (pen.options): the pen's colour and thickness.
 *
 * Session state only: remembered until the page is reloaded, never persisted
 * in the shared doc, and only ever applied to strokes drawn AFTER a change —
 * already-drawn strokes keep their saved colour and thickness.
 */
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
