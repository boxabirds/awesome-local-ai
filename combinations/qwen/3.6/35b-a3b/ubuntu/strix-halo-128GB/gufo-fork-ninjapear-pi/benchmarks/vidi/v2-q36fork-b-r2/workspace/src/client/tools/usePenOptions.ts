import * as React from 'react';
import { PEN_COLORS, PEN_THICKNESS_WORLD, DEFAULT_PEN_COLOR, DEFAULT_PEN_THICKNESS } from '../../shared/config';
import type { PenColor, PenThickness } from '../../shared/objects/stroke';

/**
 * Session-only pen options (colour and thickness).
 * Choices persist until page reload; they are NOT written to Y.Doc.
 */
export function usePenOptions(): {
  color: PenColor;
  thickness: PenThickness;
  setColor(c: PenColor): void;
  setThickness(t: PenThickness): void;
} {
  const [color, setColorInternal] = React.useState<PenColor>(DEFAULT_PEN_COLOR);
  const [thickness, setThicknessInternal] = React.useState<PenThickness>(DEFAULT_PEN_THICKNESS);

  const setColor = React.useCallback((c: PenColor) => {
    setColorInternal(c);
  }, []);

  const setThickness = React.useCallback((t: PenThickness) => {
    setThicknessInternal(t);
  }, []);

  return { color, thickness, setColor, setThickness };
}
