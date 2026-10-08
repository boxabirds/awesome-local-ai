// usePenOptions (story 11, pen.options): the pen's session-only colour and
// thickness choice. Defaults to DEFAULT_PEN_COLOR / DEFAULT_PEN_THICKNESS,
// is remembered for the life of the mounted board (until the page is
// reloaded) and is never persisted to the document. Changing the options
// never restyles existing strokes: they keep their stored colour and
// thickness.

import { useState } from 'react';
import { DEFAULT_PEN_COLOR, DEFAULT_PEN_THICKNESS } from '../../shared/config';
import type { PenColor, PenThickness } from '../../shared/objects/stroke';

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
