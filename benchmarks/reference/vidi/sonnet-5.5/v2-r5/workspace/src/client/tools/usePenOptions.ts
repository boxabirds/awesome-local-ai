import { useState } from 'react';
import { DEFAULT_PEN_COLOR, DEFAULT_PEN_THICKNESS } from '../../shared/config';
import type { PenColor, PenThickness } from '../../shared/objects/stroke';

/** Session-only pen choices: kept until the page is reloaded, never persisted or shared. */
export function usePenOptions(): {
  color: PenColor; thickness: PenThickness; setColor(c: PenColor): void; setThickness(t: PenThickness): void;
} {
  const [color, setColor] = useState<PenColor>(DEFAULT_PEN_COLOR);
  const [thickness, setThickness] = useState<PenThickness>(DEFAULT_PEN_THICKNESS);
  return { color, thickness, setColor, setThickness };
}
