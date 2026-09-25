/**
 * The Pen tool's colour and thickness (anchor: pen.options). Session only: kept in memory
 * for this page (also across boards opened in it) and never persisted, so a reload goes
 * back to DEFAULT_PEN_COLOR / DEFAULT_PEN_THICKNESS. Changing them only affects strokes
 * drawn afterwards.
 */
import { useCallback, useState } from 'react';
import { DEFAULT_PEN_COLOR, DEFAULT_PEN_THICKNESS } from '../../shared/config';
import type { PenColor, PenThickness } from '../../shared/objects/stroke';

const session: { color: PenColor; thickness: PenThickness } = {
  color: DEFAULT_PEN_COLOR,
  thickness: DEFAULT_PEN_THICKNESS,
};

/** Test hook: back to the defaults, as after a page reload. */
export function resetPenOptions(): void {
  session.color = DEFAULT_PEN_COLOR;
  session.thickness = DEFAULT_PEN_THICKNESS;
}

export function usePenOptions(): {
  color: PenColor;
  thickness: PenThickness;
  setColor(c: PenColor): void;
  setThickness(t: PenThickness): void;
} {
  const [color, setColorState] = useState<PenColor>(session.color);
  const [thickness, setThicknessState] = useState<PenThickness>(session.thickness);
  const setColor = useCallback((c: PenColor) => {
    session.color = c;
    setColorState(c);
  }, []);
  const setThickness = useCallback((t: PenThickness) => {
    session.thickness = t;
    setThicknessState(t);
  }, []);
  return { color, thickness, setColor, setThickness };
}
