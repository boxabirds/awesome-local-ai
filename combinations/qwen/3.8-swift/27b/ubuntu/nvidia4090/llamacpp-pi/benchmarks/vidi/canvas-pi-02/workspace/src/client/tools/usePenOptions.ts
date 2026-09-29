// Pen colour/thickness state (story 11, pen.options): session-only React
// state with the DEFAULT_PEN_COLOR / DEFAULT_PEN_THICKNESS defaults. The
// choices persist until the page is reloaded (no storage) and NEVER touch
// strokes already drawn — existing strokes keep the colour/thickness they
// were created with.

import { useCallback, useState } from 'react';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
} from '../../shared/config';
import type { PenColor, PenThickness } from '../../shared/objects/stroke';

export interface PenOptionsApi {
  readonly color: PenColor;
  readonly thickness: PenThickness;
  /** Sets the pen colour (unknown names are ignored). */
  setColor(c: PenColor): void;
  /** Sets the pen thickness (unknown names are ignored). */
  setThickness(t: PenThickness): void;
}

export function usePenOptions(): PenOptionsApi {
  const [color, setColorState] = useState<PenColor>(DEFAULT_PEN_COLOR);
  const [thickness, setThicknessState] = useState<PenThickness>(DEFAULT_PEN_THICKNESS);

  const setColor = useCallback((c: PenColor): void => {
    if (typeof c === 'string' && c in PEN_COLORS) setColorState(c);
  }, []);

  const setThickness = useCallback((t: PenThickness): void => {
    if (typeof t === 'string' && t in PEN_THICKNESS_WORLD) setThicknessState(t);
  }, []);

  return { color, thickness, setColor, setThickness };
}
