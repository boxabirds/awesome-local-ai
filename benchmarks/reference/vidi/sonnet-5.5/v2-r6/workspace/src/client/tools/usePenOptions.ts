import { useState } from 'react';
import {
  DEFAULT_PEN_COLOR, DEFAULT_PEN_THICKNESS, type PenColor, type PenThickness,
} from '../../shared/config';

/** The pen's colour and thickness for this page load (not persisted, so a reload goes back to the defaults). */
export function usePenOptions(): {
  color: PenColor; thickness: PenThickness; setColor(c: PenColor): void; setThickness(t: PenThickness): void;
} {
  const [color, setColor] = useState<PenColor>(DEFAULT_PEN_COLOR);
  const [thickness, setThickness] = useState<PenThickness>(DEFAULT_PEN_THICKNESS);
  return { color, thickness, setColor, setThickness };
}
