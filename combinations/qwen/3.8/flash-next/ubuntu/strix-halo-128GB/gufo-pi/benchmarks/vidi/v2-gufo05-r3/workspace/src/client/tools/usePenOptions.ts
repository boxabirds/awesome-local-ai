/**
 * The Pen tool's colour and thickness choices (`pen.options`).
 *
 * Session state, deliberately: the PRD says a choice holds "until the page is
 * reloaded", so it is React state and nothing persisted. Existing strokes carry
 * their own colour and thickness in the document and are never restyled from
 * here — this hook only decides what the *next* stroke is drawn with.
 */
import { useCallback, useMemo, useState } from 'react';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  type PenColor,
  type PenThickness,
} from '../../shared/config';

export interface PenOptionsApi {
  color: PenColor;
  thickness: PenThickness;
  setColor(c: PenColor): void;
  setThickness(t: PenThickness): void;
}

export function usePenOptions(): PenOptionsApi {
  const [color, setColor] = useState<PenColor>(DEFAULT_PEN_COLOR);
  const [thickness, setThickness] = useState<PenThickness>(DEFAULT_PEN_THICKNESS);
  const setColorStable = useCallback((next: PenColor) => setColor(next), []);
  const setThicknessStable = useCallback((next: PenThickness) => setThickness(next), []);
  return useMemo(
    () => ({ color, thickness, setColor: setColorStable, setThickness: setThicknessStable }),
    [color, thickness, setColorStable, setThicknessStable],
  );
}
