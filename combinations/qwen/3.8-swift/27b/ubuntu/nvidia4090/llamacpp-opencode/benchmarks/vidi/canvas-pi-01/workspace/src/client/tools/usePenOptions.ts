// Pen options (see spec: pen.options): the current pen colour and thickness.
//
// Session-only state (the design keeps pen options out of the document),
// shared by the Pen toolbar (swatch/thickness buttons) and the Pen tool
// (stroke colour + preview rendering). Defaults: black, medium.

import { useState } from 'react';
import { DEFAULT_PEN_COLOR, DEFAULT_PEN_THICKNESS } from '../../shared/config';
import type { PenColor, PenThickness } from '../../shared/objects/stroke';

export interface PenOptions {
  color: PenColor;
  thickness: PenThickness;
  setColor(color: PenColor): void;
  setThickness(thickness: PenThickness): void;
}

/** The pen options state hook (see spec: pen.options). */
export function usePenOptions(): PenOptions {
  const [color, setColor] = useState<PenColor>(DEFAULT_PEN_COLOR);
  const [thickness, setThickness] = useState<PenThickness>(DEFAULT_PEN_THICKNESS);
  return { color, thickness, setColor, setThickness };
}
