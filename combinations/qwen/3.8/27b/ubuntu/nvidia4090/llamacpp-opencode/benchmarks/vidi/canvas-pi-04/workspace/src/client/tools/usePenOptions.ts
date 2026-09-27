// Story 11: the pen's colour and thickness (anchor: pen.options).
//
// Per-client session state (not persisted, and not in the shared doc): the
// choice is remembered until the page is reloaded (pen.options) and never
// touches strokes already drawn. Defaults to the product settings
// (DEFAULT_PEN_COLOR, DEFAULT_PEN_THICKNESS).

import { useCallback, useState } from 'react';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  type PenColor,
  type PenThickness,
} from '../../shared/config';

export interface PenOptions {
  color: PenColor;
  thickness: PenThickness;
  setColor(color: PenColor): void;
  setThickness(thickness: PenThickness): void;
}

export function usePenOptions(): PenOptions {
  const [color, setColor] = useState<PenColor>(DEFAULT_PEN_COLOR);
  const [thickness, setThickness] = useState<PenThickness>(DEFAULT_PEN_THICKNESS);
  return { color, thickness, setColor, setThickness };
}
